/**
 * ConfigManager 단위 테스트
 * 4-소스 설정 병합, 검증, 환경변수 변환
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../src/components/config-manager.js";
import { DEFAULT_CONFIG } from "../../src/types/config.js";
import { ConfigError, ConfigValidationError } from "../../src/types/errors.js";

// fs 모듈 모킹
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fs from "node:fs/promises";

const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir);

describe("ConfigManager", () => {
  let manager: ConfigManager;
  const originalEnv = process.env;

  beforeEach(() => {
    manager = new ConfigManager();
    vi.clearAllMocks();
    // 환경변수 격리
    process.env = { ...originalEnv };
    // 기본: 파일 없음
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── load() - 기본값 ──

  describe("load() - 기본값", () => {
    it("설정 파일 없으면 기본값 반환", async () => {
      const config = await manager.load();
      expect(config.value).toEqual(DEFAULT_CONFIG);
    });

    it("모든 소스가 default로 표시됨", async () => {
      const config = await manager.load();
      for (const source of Object.values(config.sources)) {
        expect(source).toBe("default");
      }
    });
  });

  // ── load() - 소스 우선순위 ──

  describe("load() - 소스 우선순위", () => {
    it("글로벌 설정이 기본값을 덮어씀", async () => {
      // 글로벌 설정 파일 모킹
      mockReadFile.mockImplementation(async (filePath) => {
        if (String(filePath).includes(".dev-agent/config.json")) {
          return JSON.stringify({ maxIterations: 10 });
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const config = await manager.load();
      expect(config.value.maxIterations).toBe(10);
      expect(config.sources.maxIterations).toBe("global");
      // 변경하지 않은 값은 기본값
      expect(config.sources.logLevel).toBe("default");
    });

    it("프로젝트 설정이 글로벌 설정을 덮어씀", async () => {
      mockReadFile.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.includes(".dev-agent/config.json")) {
          return JSON.stringify({ maxIterations: 10, branchPrefix: "global-ai" });
        }
        if (p.includes(".dev-agent.json")) {
          return JSON.stringify({ maxIterations: 3 });
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const config = await manager.load("/some/project");
      expect(config.value.maxIterations).toBe(3);
      expect(config.sources.maxIterations).toBe("project");
      expect(config.value.branchPrefix).toBe("global-ai");
      expect(config.sources.branchPrefix).toBe("global");
    });

    it("환경변수가 프로젝트 설정을 덮어씀", async () => {
      mockReadFile.mockImplementation(async (filePath) => {
        if (String(filePath).includes(".dev-agent.json")) {
          return JSON.stringify({ maxIterations: 3 });
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      process.env["DEV_AGENT_MAX_ITERATIONS"] = "7";

      const config = await manager.load("/some/project");
      expect(config.value.maxIterations).toBe(7);
      expect(config.sources.maxIterations).toBe("env");
    });

    it("CLI 오버라이드가 최고 우선순위", async () => {
      process.env["DEV_AGENT_MAX_ITERATIONS"] = "7";

      const config = await manager.load(undefined, { maxIterations: 15 });
      expect(config.value.maxIterations).toBe(15);
      expect(config.sources.maxIterations).toBe("cli");
    });
  });

  // ── load() - 검증 ──

  describe("load() - 검증", () => {
    it("잘못된 maxIterations 값이면 ConfigValidationError", async () => {
      await expect(
        manager.load(undefined, { maxIterations: 0 }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("maxIterations 21이면 ConfigValidationError", async () => {
      await expect(
        manager.load(undefined, { maxIterations: 21 }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("잘못된 logLevel이면 ConfigValidationError", async () => {
      await expect(
        manager.load(undefined, { logLevel: "verbose" as any }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("잘못된 branchPrefix이면 ConfigValidationError", async () => {
      await expect(
        manager.load(undefined, { branchPrefix: "UPPER_CASE" }),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("claudeTimeout 범위 밖이면 ConfigValidationError", async () => {
      await expect(
        manager.load(undefined, { claudeTimeout: 1000 }),
      ).rejects.toThrow(ConfigValidationError);
    });
  });

  // ── load() - 파일 파싱 에러 ──

  describe("load() - 파일 에러", () => {
    it("잘못된 JSON 파일이면 ConfigError", async () => {
      mockReadFile.mockImplementation(async (filePath) => {
        if (String(filePath).includes(".dev-agent/config.json")) {
          return "{ invalid json }}}";
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      await expect(manager.load()).rejects.toThrow(ConfigError);
    });
  });

  // ── setGlobal() ──

  describe("setGlobal()", () => {
    it("유효한 키와 값 저장 성공", async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await manager.setGlobal("maxIterations", 10);

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.maxIterations).toBe(10);
    });

    it("알 수 없는 키이면 ConfigError", async () => {
      await expect(
        manager.setGlobal("unknownKey" as any, "value"),
      ).rejects.toThrow(ConfigError);
    });

    it("검증 실패하면 ConfigValidationError", async () => {
      await expect(
        manager.setGlobal("maxIterations", 999),
      ).rejects.toThrow(ConfigValidationError);
    });

    it("기존 파일이 있으면 병합", async () => {
      mockReadFile.mockImplementation(async (filePath) => {
        if (String(filePath).includes("config.json")) {
          return JSON.stringify({ branchPrefix: "existing" });
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await manager.setGlobal("maxIterations", 8);

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.maxIterations).toBe(8);
      expect(writtenContent.branchPrefix).toBe("existing");
    });
  });

  // ── 환경변수 변환 ──

  describe("환경변수 변환", () => {
    it("DEV_AGENT_MAX_ITERATIONS → number", async () => {
      process.env["DEV_AGENT_MAX_ITERATIONS"] = "8";
      const config = await manager.load();
      expect(config.value.maxIterations).toBe(8);
      expect(typeof config.value.maxIterations).toBe("number");
    });

    it("DEV_AGENT_LOG_LEVEL → string", async () => {
      process.env["DEV_AGENT_LOG_LEVEL"] = "debug";
      const config = await manager.load();
      expect(config.value.logLevel).toBe("debug");
    });

    it("DEV_AGENT_BRANCH_PREFIX → string", async () => {
      process.env["DEV_AGENT_BRANCH_PREFIX"] = "custom";
      const config = await manager.load();
      expect(config.value.branchPrefix).toBe("custom");
    });
  });

  // ── get() / show() ──

  describe("get() / show()", () => {
    it("get()은 특정 키의 값과 출처 반환", async () => {
      const result = await manager.get("maxIterations");
      expect(result.value).toBe(DEFAULT_CONFIG.maxIterations);
      expect(result.source).toBe("default");
    });

    it("show()는 load()와 동일한 결과", async () => {
      const loadResult = await manager.load();
      const showResult = await manager.show();
      expect(showResult.value).toEqual(loadResult.value);
    });
  });
});
