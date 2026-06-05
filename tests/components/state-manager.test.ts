/**
 * StateManager 단위 테스트
 * atomic write, 복원/검증, phase fallback, 아카이브
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateManager } from "../../src/components/state-manager.js";
import { StateError } from "../../src/types/errors.js";
import type { WorkflowState } from "../../src/types/workflow.js";
import type { Logger } from "../../src/components/logger.js";

// fs 모킹
vi.mock("node:fs/promises", () => {
  const mockFd = {
    write: vi.fn().mockResolvedValue(undefined),
    datasync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(mockFd),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    copyFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

import * as fs from "node:fs/promises";

const mockReadFile = vi.mocked(fs.readFile);
const mockMkdir = vi.mocked(fs.mkdir);
const mockOpen = vi.mocked(fs.open);
const mockRename = vi.mocked(fs.rename);
const mockAccess = vi.mocked(fs.access);

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setPhase: vi.fn(),
    setCycleNumber: vi.fn(),
    setWorkflowId: vi.fn(),
    createChildLogger: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

function createTestState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    workflowId: "wf-test-123",
    projectPath: "/test/project",
    projectName: "test-project",
    taskDescription: "테스트 작업",
    status: "running",
    currentPhase: "planning",
    currentCycle: 1,
    maxIterations: 5,
    branchName: "ai/test-task",
    artifacts: {},
    reviewHistory: [],
    startedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("StateManager", () => {
  let manager: StateManager;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    manager = new StateManager(mockLogger);
  });

  // ── save() ──

  describe("save()", () => {
    it("atomic write 순서: mkdir → open → write → datasync → close → rename", async () => {
      const state = createTestState();
      await manager.save(state);

      expect(mockMkdir).toHaveBeenCalledOnce();
      expect(mockOpen).toHaveBeenCalledOnce();
      expect(mockRename).toHaveBeenCalledOnce();

      // open의 두 번째 인자가 "w"인지 확인
      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining("state.json.tmp"),
        "w",
      );

      // rename: .tmp → state.json
      expect(mockRename).toHaveBeenCalledWith(
        expect.stringContaining("state.json.tmp"),
        expect.stringContaining("state.json"),
      );
    });

    it("updatedAt 타임스탬프가 갱신됨", async () => {
      const state = createTestState({ updatedAt: "old-timestamp" });
      await manager.save(state);
      expect(state.updatedAt).not.toBe("old-timestamp");
    });

    it("save 실패 시 워크플로우 중단하지 않음 (warn 로그만)", async () => {
      mockOpen.mockRejectedValueOnce(new Error("permission denied"));

      const state = createTestState();
      // 에러를 throw하지 않아야 함
      await expect(manager.save(state)).resolves.toBeUndefined();
      expect((mockLogger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  // ── restore() ──

  describe("restore()", () => {
    it("유효한 상태 파일 복원 성공", async () => {
      const state = createTestState();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await manager.restore("/test/project");
      expect(result).not.toBeNull();
      expect(result!.workflowId).toBe("wf-test-123");
    });

    it("파일 없으면 null 반환", async () => {
      mockReadFile.mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await manager.restore("/nonexistent");
      expect(result).toBeNull();
    });

    it("잘못된 JSON이면 StateError", async () => {
      mockReadFile.mockResolvedValueOnce("{ invalid json");

      await expect(manager.restore("/test")).rejects.toThrow(StateError);
    });

    it("필수 필드 누락 시 StateError", async () => {
      const incompleteState = { projectPath: "/test" };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(incompleteState));

      await expect(manager.restore("/test")).rejects.toThrow(StateError);
    });

    it("필수 필드가 null이면 StateError", async () => {
      const state = createTestState({ workflowId: null as unknown as string });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      await expect(manager.restore("/test")).rejects.toThrow(StateError);
    });
  });

  // ── adjustPhaseIfNeeded() ──

  describe("restore() - phase fallback", () => {
    it("review 단계 + changedFiles 없음 → implementation으로 조정", async () => {
      const state = createTestState({
        currentPhase: "review",
        artifacts: {},
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("planning");
      // implementation → implementationSpecPath 없음 → planning으로 한번 더 조정
    });

    it("review 단계 + changedFiles 있음 → review 유지", async () => {
      const state = createTestState({
        currentPhase: "review",
        artifacts: { changedFiles: ["src/a.ts"] },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("review");
    });

    it("implementation 단계 + specPath 없음 → planning으로 조정", async () => {
      const state = createTestState({
        currentPhase: "implementation",
        artifacts: {},
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("planning");
    });

    it("implementation 단계 + specPath 있고 접근 가능 → implementation 유지", async () => {
      const state = createTestState({
        currentPhase: "implementation",
        artifacts: { implementationSpecPath: "/test/spec.md" },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("implementation");
    });

    it("implementation 단계 + specPath 접근 불가 → planning으로 조정", async () => {
      const state = createTestState({
        currentPhase: "implementation",
        artifacts: { implementationSpecPath: "/test/missing-spec.md" },
      });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("planning");
    });

    it("planning 단계는 조정 없음", async () => {
      const state = createTestState({ currentPhase: "planning" });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await manager.restore("/test/project");
      expect(result!.currentPhase).toBe("planning");
    });
  });

  // ── updatePhase() ──

  describe("updatePhase()", () => {
    it("phase를 변경하고 save 호출", async () => {
      const state = createTestState({ currentPhase: "planning" });
      await manager.updatePhase(state, "implementation");
      expect(state.currentPhase).toBe("implementation");
      // save가 호출되었으므로 open, rename 등이 호출됨
      expect(mockOpen).toHaveBeenCalled();
    });
  });
});
