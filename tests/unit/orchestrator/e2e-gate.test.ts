/**
 * Orchestrator.runE2eGate 단위 테스트
 *
 * E2E 게이트의 분기 동작을 검증한다(외부 spawn 없이 E2eVerifier 를 모킹):
 *  - e2eEnabled=false 또는 verifier 미주입 → 게이트 스킵(null)
 *  - 검증 통과 → null + state.e2e(passed:true) 기록
 *  - 검증 실패 → CHANGES_REQUESTED 피드백 + state.e2e(passed:false)
 *  - 실행 오류(throw) → CHANGES_REQUESTED 피드백 + state.e2e(passed:false)
 *
 * runE2eGate 는 private 이므로 테스트에서 캐스팅으로 호출한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Orchestrator } from "../../../src/orchestrator/orchestrator.js";
import { E2eExecutionError } from "../../../src/components/e2e-verifier.js";
import type { E2eVerifier } from "../../../src/components/e2e-verifier.js";
import type { PipelineService } from "../../../src/services/pipeline.service.js";
import type { GitService } from "../../../src/services/git.service.js";
import type { StateManager } from "../../../src/components/state-manager.js";
import type { ReviewEngine } from "../../../src/components/review-engine.js";
import type { Logger } from "../../../src/components/logger.js";
import type { E2eResult } from "../../../src/types/e2e.js";
import type { WorkflowRequest, WorkflowState } from "../../../src/types/workflow.js";
import { DEFAULT_CONFIG } from "../../../src/types/config.js";

function createLogger(): Logger {
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

function createOrchestrator(verifier?: E2eVerifier): Orchestrator {
  return new Orchestrator(
    {} as PipelineService,
    {} as GitService,
    { save: vi.fn().mockResolvedValue(undefined) } as unknown as StateManager,
    {} as ReviewEngine,
    new EventEmitter(),
    createLogger(),
    verifier,
  );
}

function createVerifier(behavior: {
  result?: E2eResult;
  throws?: Error;
}): { verifier: E2eVerifier; verify: ReturnType<typeof vi.fn> } {
  const verify = behavior.throws
    ? vi.fn().mockRejectedValue(behavior.throws)
    : vi.fn().mockResolvedValue(behavior.result);
  return { verifier: { verify } as unknown as E2eVerifier, verify };
}

function e2eResult(overrides: Partial<E2eResult> = {}): E2eResult {
  return {
    passed: true,
    exitCode: 0,
    timedOut: false,
    stdout: "",
    stderr: "",
    duration: 1500,
    ...overrides,
  };
}

function request(overrides: Partial<WorkflowRequest["config"]> = {}): WorkflowRequest {
  return {
    projectPath: "/repo/app",
    taskDescription: "task",
    config: { ...DEFAULT_CONFIG, e2eEnabled: true, e2eUrl: "http://localhost:3000", ...overrides },
  };
}

function state(): WorkflowState {
  return {
    workflowId: "wf-1",
    projectPath: "/repo/app",
    projectName: "app",
    taskDescription: "task",
    status: "running",
    currentPhase: "review",
    currentCycle: 1,
    maxIterations: 10,
    branchName: "feature/x",
    artifacts: {},
    reviewHistory: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// private 메서드 호출용 헬퍼
function runGate(
  orch: Orchestrator,
  req: WorkflowRequest,
  st: WorkflowState,
): Promise<import("../../../src/types/review.js").ReviewResult | null> {
  return (
    orch as unknown as {
      runE2eGate: (
        r: WorkflowRequest,
        s: WorkflowState,
      ) => Promise<import("../../../src/types/review.js").ReviewResult | null>;
    }
  ).runE2eGate(req, st);
}

describe("Orchestrator.runE2eGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("e2eEnabled=false → 게이트 스킵(null), verify 미호출", async () => {
    const { verifier, verify } = createVerifier({ result: e2eResult() });
    const orch = createOrchestrator(verifier);
    const st = state();

    const out = await runGate(orch, request({ e2eEnabled: false }), st);

    expect(out).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(st.e2e).toBeUndefined();
  });

  it("verifier 미주입 → 게이트 스킵(null)", async () => {
    const orch = createOrchestrator(undefined);
    const out = await runGate(orch, request(), state());
    expect(out).toBeNull();
  });

  it("검증 통과 → null 반환 + state.e2e(passed:true) 기록", async () => {
    const { verifier, verify } = createVerifier({
      result: e2eResult({ passed: true, duration: 2222 }),
    });
    const orch = createOrchestrator(verifier);
    const st = state();

    const out = await runGate(orch, request(), st);

    expect(out).toBeNull();
    expect(verify).toHaveBeenCalledOnce();
    expect(st.e2e).toEqual({
      passed: true,
      durationMs: 2222,
      command: DEFAULT_CONFIG.e2eCommand,
      url: "http://localhost:3000",
      exitCode: 0,
      timedOut: false,
    });
  });

  it("검증 실패 → CHANGES_REQUESTED + state.e2e(passed:false)", async () => {
    const { verifier } = createVerifier({
      result: e2eResult({ passed: false, exitCode: 1, stderr: "1 test failed" }),
    });
    const orch = createOrchestrator(verifier);
    const st = state();

    const out = await runGate(orch, request(), st);

    expect(out).not.toBeNull();
    expect(out?.status).toBe("CHANGES_REQUESTED");
    expect(out?.checks[0]?.name).toBe("tests");
    expect(st.e2e?.passed).toBe(false);
    expect(st.e2e?.exitCode).toBe(1);
  });

  it("실행 오류(throw) → CHANGES_REQUESTED + state.e2e(passed:false, exitCode:null)", async () => {
    const { verifier } = createVerifier({
      throws: new E2eExecutionError("E2E 명령 실행 실패: npx (ENOENT)"),
    });
    const orch = createOrchestrator(verifier);
    const st = state();

    const out = await runGate(orch, request(), st);

    expect(out?.status).toBe("CHANGES_REQUESTED");
    expect(out?.findings[0]?.description).toContain("ENOENT");
    expect(st.e2e).toMatchObject({ passed: false, exitCode: null, timedOut: false });
  });
});
