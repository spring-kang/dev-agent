/**
 * StallDetector 단위 테스트
 * 순수 로직 - 외부 의존성 없음
 */
import { describe, it, expect } from "vitest";
import {
  StallDetector,
  feedbackFingerprint,
  NO_PROGRESS_STALL_THRESHOLD,
} from "../../../src/orchestrator/stall-detector.js";
import type { ReviewResult } from "../../../src/types/review.js";

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: "CHANGES_REQUESTED",
    checks: [
      { name: "build", passed: true, details: "ok" },
      { name: "tests", passed: false, details: "1건 실패" },
    ],
    findings: [
      {
        severity: "major",
        location: "src/foo.ts:10",
        description: "널 체크 누락",
        suggestion: "옵셔널 체이닝 사용",
      },
    ],
    summary: "테스트 실패",
    ...overrides,
  };
}

describe("feedbackFingerprint", () => {
  it("동일한 checks/findings면 동일한 지문 생성", () => {
    expect(feedbackFingerprint(review())).toBe(feedbackFingerprint(review()));
  });

  it("summary(자연어)만 다르면 지문은 동일", () => {
    const a = review({ summary: "표현 A" });
    const b = review({ summary: "완전히 다른 표현 B" });
    expect(feedbackFingerprint(a)).toBe(feedbackFingerprint(b));
  });

  it("checks/findings 순서가 달라도 지문은 동일 (정렬)", () => {
    const a = review({
      checks: [
        { name: "build", passed: true, details: "ok" },
        { name: "tests", passed: false, details: "1건 실패" },
      ],
    });
    const b = review({
      checks: [
        { name: "tests", passed: false, details: "1건 실패" },
        { name: "build", passed: true, details: "ok" },
      ],
    });
    expect(feedbackFingerprint(a)).toBe(feedbackFingerprint(b));
  });

  it("실패 체크가 달라지면 지문도 달라짐", () => {
    const a = review();
    const b = review({
      checks: [
        { name: "build", passed: false, details: "빌드 실패" },
        { name: "tests", passed: false, details: "1건 실패" },
      ],
    });
    expect(feedbackFingerprint(a)).not.toBe(feedbackFingerprint(b));
  });
});

describe("StallDetector", () => {
  it("기본 임계치는 NO_PROGRESS_STALL_THRESHOLD", () => {
    const detector = new StallDetector();
    // 무변경 1회: 아직 임계치 미달
    expect(detector.record(0, review())).toBe(false);
    expect(detector.count).toBe(1);
    // 무변경 2회 연속 → 정체 감지
    expect(detector.record(0, review())).toBe(true);
    expect(detector.count).toBe(NO_PROGRESS_STALL_THRESHOLD);
  });

  it("Codex 무변경(changedFiles=0)이 연속되면 정체로 판정", () => {
    const detector = new StallDetector(2);
    expect(detector.record(0, review({ summary: "1회차" }))).toBe(false);
    expect(detector.record(0, review({ summary: "2회차" }))).toBe(true);
  });

  it("변경이 있어도 직전과 동일 피드백이 연속되면 정체로 판정", () => {
    const detector = new StallDetector(2);
    // 첫 기록은 비교 대상(직전 지문)이 없어 진척으로 간주 → baseline 설정(카운터 0)
    expect(detector.record(3, review())).toBe(false);
    // 이후 동일 피드백이 반복될 때마다 무진척 카운트 증가
    expect(detector.record(3, review())).toBe(false); // 무진척 1
    expect(detector.record(3, review())).toBe(true); // 무진척 2 → 정체
  });

  it("진척(변경 있음 + 피드백 변화)이 있으면 카운터 리셋", () => {
    const detector = new StallDetector(2);
    detector.record(0, review({ summary: "a" })); // 무진척 1
    expect(detector.count).toBe(1);
    // 변경 발생 + 피드백도 달라짐 → 리셋
    const progressed = detector.record(2, review({
      checks: [{ name: "build", passed: false, details: "새 실패" }],
    }));
    expect(progressed).toBe(false);
    expect(detector.count).toBe(0);
  });

  it("정체 감지 후에도 진척이 생기면 다시 카운터가 0으로 복구", () => {
    const detector = new StallDetector(2);
    detector.record(0, review());
    expect(detector.record(0, review())).toBe(true); // 정체
    // 진척 발생
    const next = detector.record(5, review({
      findings: [
        {
          severity: "minor",
          location: "src/bar.ts:1",
          description: "새 발견",
          suggestion: "수정",
        },
      ],
    }));
    expect(next).toBe(false);
    expect(detector.count).toBe(0);
  });

  it("reset()은 연속 카운터를 0으로 만든다", () => {
    const detector = new StallDetector(2);
    detector.record(0, review());
    expect(detector.count).toBe(1);
    detector.reset();
    expect(detector.count).toBe(0);
  });

  it("임계치가 1 미만이거나 정수가 아니면 생성 시 예외", () => {
    expect(() => new StallDetector(0)).toThrow();
    expect(() => new StallDetector(-1)).toThrow();
    expect(() => new StallDetector(1.5)).toThrow();
  });

  it("임계치를 3으로 지정하면 무진척 3회 연속에서 감지", () => {
    const detector = new StallDetector(3);
    expect(detector.record(0, review())).toBe(false);
    expect(detector.record(0, review())).toBe(false);
    expect(detector.record(0, review())).toBe(true);
  });
});
