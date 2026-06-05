/**
 * Logger 단위 테스트
 * 로그 레벨 필터링, 민감 정보 마스킹, 메시지 truncation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger, type LogConfig } from "../../src/components/logger.js";

describe("Logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createLogger(overrides: Partial<LogConfig> = {}): Logger {
    return new Logger({
      level: "debug",
      noColor: true,
      ...overrides,
    });
  }

  // ── 로그 레벨 필터링 ──

  describe("로그 레벨 필터링", () => {
    it("level이 info이면 debug는 출력되지 않음", () => {
      const logger = createLogger({ level: "info" });
      logger.debug("디버그 메시지");
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it("level이 info이면 info는 출력됨", () => {
      const logger = createLogger({ level: "info" });
      logger.info("정보 메시지");
      expect(stdoutSpy).toHaveBeenCalledOnce();
    });

    it("level이 warn이면 info, debug는 출력되지 않음", () => {
      const logger = createLogger({ level: "warn" });
      logger.debug("디버그");
      logger.info("정보");
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it("level이 warn이면 warn은 출력됨", () => {
      const logger = createLogger({ level: "warn" });
      logger.warn("경고 메시지");
      expect(stdoutSpy).toHaveBeenCalledOnce();
    });

    it("level이 error이면 error만 출력됨", () => {
      const logger = createLogger({ level: "error" });
      logger.debug("디버그");
      logger.info("정보");
      logger.warn("경고");
      expect(stdoutSpy).not.toHaveBeenCalled();

      logger.error("에러 메시지");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it("level이 debug이면 모든 레벨 출력됨", () => {
      const logger = createLogger({ level: "debug" });
      logger.debug("디버그");
      logger.info("정보");
      logger.warn("경고");
      logger.error("에러");

      expect(stdoutSpy).toHaveBeenCalledTimes(3); // debug, info, warn
      expect(stderrSpy).toHaveBeenCalledTimes(1); // error
    });
  });

  // ── 출력 채널 ──

  describe("출력 채널", () => {
    it("error는 stderr로 출력", () => {
      const logger = createLogger();
      logger.error("에러입니다");
      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it("info, warn, debug는 stdout으로 출력", () => {
      const logger = createLogger();
      logger.info("정보");
      logger.warn("경고");
      logger.debug("디버그");
      expect(stdoutSpy).toHaveBeenCalledTimes(3);
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  // ── 메시지 truncation ──

  describe("메시지 truncation", () => {
    it("10,000자 이하 메시지는 그대로 출력", () => {
      const logger = createLogger();
      const msg = "a".repeat(10_000);
      logger.info(msg);
      const output = stdoutSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain(msg);
      expect(output).not.toContain("[truncated");
    });

    it("10,000자 초과 메시지는 잘림 + [truncated] 표시", () => {
      const logger = createLogger();
      const msg = "b".repeat(15_000);
      logger.info(msg);
      const output = stdoutSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("[truncated: 15000 chars]");
    });
  });

  // ── 자식 로거 ──

  describe("자식 로거", () => {
    it("createChildLogger는 새 Logger 인스턴스를 반환", () => {
      const parent = createLogger({ level: "warn" });
      const child = parent.createChildLogger("wf-123");
      expect(child).toBeInstanceOf(Logger);
    });

    it("자식 로거는 부모 level 설정을 상속", () => {
      const parent = createLogger({ level: "warn" });
      const child = parent.createChildLogger("wf-123");
      child.info("이건 안 나와야 함");
      expect(stdoutSpy).not.toHaveBeenCalled();
      child.warn("이건 나와야 함");
      expect(stdoutSpy).toHaveBeenCalledOnce();
    });
  });

  // ── Phase/Cycle 설정 ──

  describe("Phase/Cycle 설정", () => {
    it("setPhase 후 로그에 phase 라벨이 포함됨", () => {
      const logger = createLogger();
      logger.setPhase("planning");
      logger.info("계획 중");
      const output = stdoutSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("[planning]");
    });

    it("setCycleNumber는 에러 없이 동작", () => {
      const logger = createLogger();
      expect(() => logger.setCycleNumber(3)).not.toThrow();
    });

    it("setWorkflowId는 에러 없이 동작", () => {
      const logger = createLogger();
      expect(() => logger.setWorkflowId("wf-abc")).not.toThrow();
    });
  });

  // ── close() ──

  describe("close()", () => {
    it("파일 핸들이 없으면 에러 없이 완료", async () => {
      const logger = createLogger();
      await expect(logger.close()).resolves.toBeUndefined();
    });
  });
});
