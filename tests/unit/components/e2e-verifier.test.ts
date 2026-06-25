/**
 * E2eVerifier 순수 헬퍼 단위 테스트
 * - parseCommand: 명령 문자열 → argv 분해
 * - buildFeedbackFromFailure: 실패 결과 → 합성 ReviewResult(CHANGES_REQUESTED)
 * (verify() 의 spawn 동작은 외부 프로세스 의존이라 단위테스트 대상에서 제외)
 */
import { describe, it, expect } from "vitest";
import { E2eVerifier, E2eExecutionError } from "../../../src/components/e2e-verifier.js";
import type { E2eResult } from "../../../src/types/e2e.js";

function result(overrides: Partial<E2eResult> = {}): E2eResult {
  return {
    passed: false,
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "",
    duration: 1234,
    ...overrides,
  };
}

describe("E2eVerifier.parseCommand", () => {
  it("공백 기준으로 file/args 분해", () => {
    expect(E2eVerifier.parseCommand("npx playwright test")).toEqual({
      file: "npx",
      args: ["playwright", "test"],
    });
  });

  it("연속 공백/양끝 공백을 정규화", () => {
    expect(E2eVerifier.parseCommand("  pnpm   e2e --project=web  ")).toEqual({
      file: "pnpm",
      args: ["e2e", "--project=web"],
    });
  });

  it("단일 토큰도 처리", () => {
    expect(E2eVerifier.parseCommand("playwright")).toEqual({
      file: "playwright",
      args: [],
    });
  });

  it("빈 명령은 E2eExecutionError", () => {
    expect(() => E2eVerifier.parseCommand("   ")).toThrow(E2eExecutionError);
  });
});

describe("E2eVerifier.buildFeedbackFromFailure", () => {
  it("실패 결과를 CHANGES_REQUESTED 피드백으로 변환", () => {
    const fb = E2eVerifier.buildFeedbackFromFailure(
      result({ exitCode: 1, stderr: "1 test failed" }),
      "http://localhost:3000",
    );
    expect(fb.status).toBe("CHANGES_REQUESTED");
    expect(fb.recommendation).toBe("partial");
    expect(fb.checks[0]?.name).toBe("tests");
    expect(fb.checks[0]?.passed).toBe(false);
    expect(fb.findings[0]?.severity).toBe("critical");
    expect(fb.findings[0]?.location).toBe("http://localhost:3000");
    expect(fb.findings[0]?.description).toContain("1 test failed");
  });

  it("타임아웃이면 사유에 타임아웃 표기", () => {
    const fb = E2eVerifier.buildFeedbackFromFailure(
      result({ timedOut: true, exitCode: null, duration: 300000 }),
      "http://localhost:3000",
    );
    expect(fb.summary).toContain("타임아웃");
    expect(fb.checks[0]?.details).toContain("타임아웃");
  });

  it("URL 이 비어 있으면 location 폴백", () => {
    const fb = E2eVerifier.buildFeedbackFromFailure(result(), "");
    expect(fb.findings[0]?.location).toBe("(e2e)");
  });

  it("출력이 길면 말미만 포함(상한 적용)", () => {
    const huge = "X".repeat(10_000);
    const fb = E2eVerifier.buildFeedbackFromFailure(
      result({ stdout: huge }),
      "http://localhost:3000",
    );
    // 4000자 상한 + 헤더/라벨 일부만 포함 → 원본 전체보다 짧아야 한다
    expect(fb.findings[0]?.description.length).toBeLessThan(huge.length);
  });
});
