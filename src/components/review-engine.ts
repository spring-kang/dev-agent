/**
 * ReviewEngine (C-05) - 리뷰 결과 평가 (순수 도메인 로직)
 * NFR: 보수적 판정, 외부 의존 없음
 */

import type {
  ReviewResult,
  ReviewCheck,
  ReviewFinding,
  ReviewRawOutput,
  ReviewJsonOutput,
  ReviewCheckName,
} from "../types/review.js";
import {
  REVIEW_CHECK_NAMES,
  APPROVED_KEYWORDS,
  REJECTED_KEYWORDS,
  FULL_REWORK_CRITICAL_THRESHOLD,
} from "../types/review.js";

export class ReviewEngine {
  /**
   * 리뷰 원문을 구조화된 결과로 변환
   * BR-01: 모든 체크가 pass여야 APPROVED
   * BR-02: 파싱 실패 시 보수적 CHANGES_REQUESTED
   */
  evaluate(rawOutput: ReviewRawOutput): ReviewResult {
    // 1. JSON 파싱 시도
    const json = rawOutput.parsedJson ?? this.tryParseFromStdout(rawOutput.stdout);

    if (json) {
      return this.evaluateFromJson(json, rawOutput.stdout);
    }

    // 2. 텍스트 기반 fallback
    return this.evaluateFromText(rawOutput.stdout);
  }

  /**
   * 재작업 범위 추천
   * BR-03: critical >= 3 또는 design 실패 시 full
   */
  recommendReworkScope(result: ReviewResult): "partial" | "full" {
    // critical findings 3개 이상
    const criticalCount = result.findings.filter((f) => f.severity === "critical").length;
    if (criticalCount >= FULL_REWORK_CRITICAL_THRESHOLD) {
      return "full";
    }

    // design check 실패
    const designCheck = result.checks.find((c) => c.name === "design");
    if (designCheck && !designCheck.passed) {
      return "full";
    }

    return "partial";
  }

  // ── JSON 기반 평가 ──

  private evaluateFromJson(json: ReviewJsonOutput, rawStdout: string): ReviewResult {
    const checks = this.parseChecks(json.checks);
    const findings = this.parseFindings(json.findings);

    // BR-01: 모든 체크 항목이 passed=true여야 APPROVED
    const allPassed = checks.length > 0 && checks.every((c) => c.passed);
    const status = allPassed ? "APPROVED" : "CHANGES_REQUESTED";

    const result: ReviewResult = {
      status,
      checks,
      findings,
      summary: json.summary ?? rawStdout.slice(-500),
    };

    // 재작업 추천 추가
    if (status === "CHANGES_REQUESTED") {
      result.recommendation = this.recommendReworkScope(result);
    }

    return result;
  }

  private parseChecks(
    rawChecks?: Array<{ name?: string; passed?: boolean; details?: string }>,
  ): ReviewCheck[] {
    if (!rawChecks || !Array.isArray(rawChecks)) {
      return [];
    }

    return rawChecks
      .filter((c) => c.name && typeof c.passed === "boolean")
      .map((c) => ({
        name: c.name as ReviewCheckName,
        passed: c.passed!,
        details: c.details ?? "",
      }));
  }

  private parseFindings(
    rawFindings?: Array<{
      severity?: string;
      location?: string;
      description?: string;
      suggestion?: string;
    }>,
  ): ReviewFinding[] {
    if (!rawFindings || !Array.isArray(rawFindings)) {
      return [];
    }

    const validSeverities = ["critical", "major", "minor", "info"];

    return rawFindings
      .filter((f) => f.severity && validSeverities.includes(f.severity))
      .map((f) => ({
        severity: f.severity as ReviewFinding["severity"],
        location: f.location ?? "unknown",
        description: f.description ?? "",
        suggestion: f.suggestion ?? "",
      }));
  }

  // ── 텍스트 기반 평가 (fallback) ──

  private evaluateFromText(stdout: string): ReviewResult {
    if (!stdout || stdout.trim().length === 0) {
      // 빈 출력 → 보수적 CHANGES_REQUESTED
      return this.createDefaultResult("CHANGES_REQUESTED", "리뷰 출력이 비어있습니다");
    }

    const hasApproved = APPROVED_KEYWORDS.some((kw) =>
      stdout.toLowerCase().includes(kw.toLowerCase()),
    );
    const hasRejected = REJECTED_KEYWORDS.some((kw) =>
      stdout.toLowerCase().includes(kw.toLowerCase()),
    );

    // 둘 다 포함 → 보수적 CHANGES_REQUESTED
    if (hasApproved && hasRejected) {
      return this.createDefaultResult(
        "CHANGES_REQUESTED",
        "리뷰 출력에 APPROVED와 CHANGES_REQUESTED 키워드가 모두 포함되어 있습니다",
      );
    }

    // APPROVED만 포함
    if (hasApproved && !hasRejected) {
      return this.createDefaultResult("APPROVED", stdout.slice(-500));
    }

    // CHANGES_REQUESTED 포함 또는 둘 다 없음 → 보수적 CHANGES_REQUESTED
    return this.createDefaultResult(
      "CHANGES_REQUESTED",
      hasRejected ? stdout.slice(-500) : "리뷰 판정 키워드를 찾을 수 없습니다 (보수적 판정)",
    );
  }

  private createDefaultResult(
    status: "APPROVED" | "CHANGES_REQUESTED",
    summary: string,
  ): ReviewResult {
    const result: ReviewResult = {
      status,
      checks: [],
      findings: [],
      summary,
    };

    if (status === "CHANGES_REQUESTED") {
      result.recommendation = "partial";
    }

    return result;
  }

  // ── stdout에서 JSON 추출 시도 ──

  private tryParseFromStdout(stdout: string): ReviewJsonOutput | null {
    // 1. ```json ... ``` 블록
    const jsonBlockMatch = stdout.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
      try {
        return JSON.parse(jsonBlockMatch[1]) as ReviewJsonOutput;
      } catch {
        // 다음 방법
      }
    }

    // 2. { "status": ... } 패턴
    const objectMatch = stdout.match(/\{[\s\S]*?"status"\s*:[\s\S]*?\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]) as ReviewJsonOutput;
      } catch {
        // 다음 방법
      }
    }

    // 3. status 필드만 추출
    const statusMatch = stdout.match(/"status"\s*:\s*"(APPROVED|CHANGES_REQUESTED)"/);
    if (statusMatch?.[1]) {
      return { status: statusMatch[1] };
    }

    return null;
  }
}
