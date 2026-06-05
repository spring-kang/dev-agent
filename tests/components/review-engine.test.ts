/**
 * ReviewEngine 단위 테스트
 * 순수 도메인 로직 - 외부 의존성 없음
 */
import { describe, it, expect } from "vitest";
import { ReviewEngine } from "../../src/components/review-engine.js";
import type { ReviewRawOutput, ReviewJsonOutput } from "../../src/types/review.js";

function makeRawOutput(overrides: Partial<ReviewRawOutput> = {}): ReviewRawOutput {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    ...overrides,
  };
}

describe("ReviewEngine", () => {
  const engine = new ReviewEngine();

  // ── evaluate() - JSON 파싱 ──

  describe("evaluate() - JSON 기반 평가", () => {
    it("parsedJson이 있고 모든 체크가 통과하면 APPROVED 반환", () => {
      const raw = makeRawOutput({
        parsedJson: {
          status: "APPROVED",
          checks: [
            { name: "build", passed: true, details: "빌드 성공" },
            { name: "tests", passed: true, details: "전체 통과" },
            { name: "design", passed: true, details: "설계 적합" },
          ],
          findings: [],
          summary: "모든 항목 통과",
        },
      });

      const result = engine.evaluate(raw);
      expect(result.status).toBe("APPROVED");
      expect(result.checks).toHaveLength(3);
      expect(result.checks.every((c) => c.passed)).toBe(true);
      expect(result.recommendation).toBeUndefined();
    });

    it("하나라도 체크 실패 시 CHANGES_REQUESTED 반환", () => {
      const raw = makeRawOutput({
        parsedJson: {
          checks: [
            { name: "build", passed: true },
            { name: "tests", passed: false, details: "2건 실패" },
            { name: "design", passed: true },
          ],
          findings: [],
        },
      });

      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
      expect(result.recommendation).toBeDefined();
    });

    it("checks가 빈 배열이면 CHANGES_REQUESTED (보수적 판단)", () => {
      const raw = makeRawOutput({
        parsedJson: {
          checks: [],
          findings: [],
          summary: "리뷰 완료",
        },
      });

      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it("checks가 undefined이면 빈 배열로 처리 → CHANGES_REQUESTED", () => {
      const raw = makeRawOutput({
        parsedJson: {
          status: "APPROVED",
          summary: "체크 목록 없음",
        },
      });

      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
      expect(result.checks).toHaveLength(0);
    });

    it("findings에서 유효한 severity만 파싱", () => {
      const raw = makeRawOutput({
        parsedJson: {
          checks: [{ name: "build", passed: false }],
          findings: [
            { severity: "critical", location: "a.ts:1", description: "치명적 버그" },
            { severity: "invalid", location: "b.ts:2", description: "무시됨" },
            { severity: "minor", description: "사소한 문제" },
          ],
        },
      });

      const result = engine.evaluate(raw);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]!.severity).toBe("critical");
      expect(result.findings[1]!.severity).toBe("minor");
    });

    it("name이 없는 check 항목은 필터링", () => {
      const raw = makeRawOutput({
        parsedJson: {
          checks: [
            { name: "build", passed: true },
            { passed: true }, // name 없음
            { name: "tests", passed: true },
          ],
          findings: [],
        },
      });

      const result = engine.evaluate(raw);
      expect(result.checks).toHaveLength(2);
    });

    it("passed가 boolean이 아닌 check는 필터링", () => {
      const raw = makeRawOutput({
        parsedJson: {
          checks: [
            { name: "build", passed: true },
            { name: "tests", passed: "yes" as unknown as boolean },
          ],
          findings: [],
        },
      });

      const result = engine.evaluate(raw);
      expect(result.checks).toHaveLength(1);
    });

    it("summary가 없으면 stdout 마지막 500자 사용", () => {
      const longStdout = "x".repeat(600);
      const raw = makeRawOutput({
        stdout: longStdout,
        parsedJson: {
          checks: [{ name: "build", passed: true }],
          findings: [],
          // summary 없음
        },
      });

      const result = engine.evaluate(raw);
      expect(result.summary).toBe(longStdout.slice(-500));
    });
  });

  // ── evaluate() - stdout에서 JSON 추출 ──

  describe("evaluate() - stdout JSON 추출", () => {
    it("```json 블록에서 JSON 추출", () => {
      const stdout = `리뷰 결과입니다.
\`\`\`json
{
  "status": "APPROVED",
  "checks": [{"name": "build", "passed": true}],
  "findings": [],
  "summary": "통과"
}
\`\`\`
끝.`;

      const raw = makeRawOutput({ stdout });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("APPROVED");
      expect(result.checks).toHaveLength(1);
    });

    it('{ "status": ... } 패턴에서 JSON 추출 (checks 없으면 CHANGES_REQUESTED)', () => {
      // 패턴 매칭으로 status만 추출되면 checks가 비어서 CHANGES_REQUESTED
      const stdout = `Review complete. {"status": "APPROVED"}`;
      const raw = makeRawOutput({ stdout });
      const result = engine.evaluate(raw);
      // checks가 비어있으므로 보수적 CHANGES_REQUESTED
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it('"status": "APPROVED" 필드만 있는 경우 추출', () => {
      const stdout = `일부 텍스트... "status": "APPROVED" ...나머지`;
      const raw = makeRawOutput({ stdout });
      const result = engine.evaluate(raw);
      // checks가 없으므로 CHANGES_REQUESTED (빈 checks → allPassed=false)
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it('"status": "CHANGES_REQUESTED" 필드만 추출', () => {
      const stdout = `"status": "CHANGES_REQUESTED"`;
      const raw = makeRawOutput({ stdout });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
    });
  });

  // ── evaluate() - 텍스트 기반 fallback ──

  describe("evaluate() - 텍스트 기반 fallback", () => {
    it("빈 stdout → CHANGES_REQUESTED (보수적)", () => {
      const raw = makeRawOutput({ stdout: "" });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
      expect(result.summary).toContain("비어있습니다");
    });

    it("공백만 있는 stdout → CHANGES_REQUESTED", () => {
      const raw = makeRawOutput({ stdout: "   \n\t  " });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it("APPROVED 키워드만 포함 → APPROVED", () => {
      const raw = makeRawOutput({ stdout: "코드 리뷰 결과: APPROVED. 문제 없습니다." });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("APPROVED");
    });

    it("'all checks passed' 키워드 → APPROVED", () => {
      const raw = makeRawOutput({ stdout: "Review done. All checks passed." });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("APPROVED");
    });

    it("CHANGES_REQUESTED 키워드 포함 → CHANGES_REQUESTED", () => {
      const raw = makeRawOutput({ stdout: "CHANGES_REQUESTED: 수정 필요합니다." });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it("'failed' 키워드 포함 → CHANGES_REQUESTED", () => {
      const raw = makeRawOutput({ stdout: "Build failed. Please fix." });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
    });

    it("APPROVED + REJECTED 키워드 동시 포함 → CHANGES_REQUESTED (보수적)", () => {
      const raw = makeRawOutput({
        stdout: "Some tests APPROVED but build failed.",
      });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
      expect(result.summary).toContain("모두 포함");
    });

    it("판정 키워드 없음 → CHANGES_REQUESTED (보수적)", () => {
      const raw = makeRawOutput({
        stdout: "코드가 깔끔합니다. 잘 작성되었습니다.",
      });
      const result = engine.evaluate(raw);
      expect(result.status).toBe("CHANGES_REQUESTED");
      expect(result.summary).toContain("보수적 판정");
    });
  });

  // ── recommendReworkScope() ──

  describe("recommendReworkScope()", () => {
    it("critical findings 3개 이상 → full", () => {
      const result = engine.recommendReworkScope({
        status: "CHANGES_REQUESTED",
        checks: [],
        findings: [
          { severity: "critical", location: "a.ts", description: "1", suggestion: "" },
          { severity: "critical", location: "b.ts", description: "2", suggestion: "" },
          { severity: "critical", location: "c.ts", description: "3", suggestion: "" },
        ],
        summary: "",
      });

      expect(result).toBe("full");
    });

    it("critical 2개 → partial", () => {
      const result = engine.recommendReworkScope({
        status: "CHANGES_REQUESTED",
        checks: [],
        findings: [
          { severity: "critical", location: "a.ts", description: "1", suggestion: "" },
          { severity: "critical", location: "b.ts", description: "2", suggestion: "" },
        ],
        summary: "",
      });

      expect(result).toBe("partial");
    });

    it("design check 실패 → full", () => {
      const result = engine.recommendReworkScope({
        status: "CHANGES_REQUESTED",
        checks: [
          { name: "build", passed: true, details: "" },
          { name: "design", passed: false, details: "설계 문제" },
        ],
        findings: [],
        summary: "",
      });

      expect(result).toBe("full");
    });

    it("design 통과 + minor findings만 → partial", () => {
      const result = engine.recommendReworkScope({
        status: "CHANGES_REQUESTED",
        checks: [
          { name: "build", passed: false, details: "빌드 실패" },
          { name: "design", passed: true, details: "설계 OK" },
        ],
        findings: [
          { severity: "minor", location: "a.ts", description: "사소함", suggestion: "" },
        ],
        summary: "",
      });

      expect(result).toBe("partial");
    });

    it("빈 findings + design check 없음 → partial", () => {
      const result = engine.recommendReworkScope({
        status: "CHANGES_REQUESTED",
        checks: [{ name: "build", passed: false, details: "" }],
        findings: [],
        summary: "",
      });

      expect(result).toBe("partial");
    });
  });
});
