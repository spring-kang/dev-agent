/**
 * PipelineService stage 분기 단위 테스트
 *
 * 검증 항목:
 *   PS-STAGE-01: stage="plan-only" → Implementation/Review 미실행, placeholder 반환
 *   PS-STAGE-02: stage="build-only" + 산출물 누락 → PipelineServiceError
 *   PS-STAGE-02a: stage="build-only" + 산출물 존재 → Implementation/Review 진입
 *   PS-STAGE-03: executePlanOnly() → state.artifacts 저장 + planResult 반환
 *   PS-STAGE-04: stage="full" (기본) → Planning + Implementation + Review 전부 실행
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PipelineService } from "../../../src/services/pipeline.service.js";
import { PipelineServiceError } from "../../../src/types/errors.js";
import type {
  CycleContext,
  WorkflowState,
  WorkflowArtifacts,
} from "../../../src/types/workflow.js";
import type { ClaudeAgent } from "../../../src/components/claude-agent.js";
import type { CodexAgent } from "../../../src/components/codex-agent.js";
import type { GitManager } from "../../../src/components/git-manager.js";
import type { ReviewEngine } from "../../../src/components/review-engine.js";
import type { StateManager } from "../../../src/components/state-manager.js";
import type { Logger } from "../../../src/components/logger.js";

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

function createState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    workflowId: "wf-test-001",
    projectPath: "/proj",
    projectName: "proj",
    taskDescription: "테스트",
    status: "running",
    currentPhase: "planning",
    currentCycle: 1,
    maxIterations: 5,
    branchName: "ai/test",
    artifacts: {},
    reviewHistory: [],
    startedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createContext(
  overrides: Partial<CycleContext> = {},
): CycleContext {
  return {
    workflowId: "wf-test-001",
    cycleNumber: 1,
    projectPath: "/proj",
    taskDescription: "테스트",
    artifacts: {},
    ...overrides,
  } as CycleContext;
}

interface Mocks {
  claudeAgent: ClaudeAgent;
  codexAgent: CodexAgent;
  gitManager: GitManager;
  reviewEngine: ReviewEngine;
  stateManager: StateManager;
  emitter: EventEmitter;
  logger: Logger;
}

function createMocks(): Mocks {
  const claudeAgent = {
    plan: vi.fn().mockResolvedValue({
      requirementsPath: "/req.md",
      implementationSpecPath: "/spec.md",
      testScenariosPath: "/tests.md",
      summary: "planned",
    }),
    review: vi.fn().mockResolvedValue("REVIEW_RAW"),
  } as unknown as ClaudeAgent;

  const codexAgent = {
    implement: vi.fn().mockResolvedValue({
      changedFiles: ["src/a.ts"],
      suggestedCommitMessage: "feat: a",
    }),
  } as unknown as CodexAgent;

  const gitManager = {
    commit: vi.fn().mockResolvedValue("deadbeef"),
  } as unknown as GitManager;

  const reviewEngine = {
    evaluate: vi.fn().mockReturnValue({
      status: "APPROVED",
      checks: [],
      findings: [],
      summary: "ok",
    }),
    recommendReworkScope: vi.fn().mockReturnValue("FULL"),
  } as unknown as ReviewEngine;

  const stateManager = {
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as StateManager;

  return {
    claudeAgent,
    codexAgent,
    gitManager,
    reviewEngine,
    stateManager,
    emitter: new EventEmitter(),
    logger: createMockLogger(),
  };
}

function createService(m: Mocks): PipelineService {
  return new PipelineService(
    m.claudeAgent,
    m.codexAgent,
    m.gitManager,
    m.reviewEngine,
    m.stateManager,
    m.emitter,
    m.logger,
  );
}

describe("PipelineService — stage 분기", () => {
  let m: Mocks;
  let svc: PipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    m = createMocks();
    svc = createService(m);
  });

  // PS-STAGE-01
  it("[PS-STAGE-01] stage='plan-only' → Implementation/Review 미실행, placeholder 반환", async () => {
    const state = createState();
    const ctx = createContext({ stage: "plan-only" });

    const result = await svc.executeCycle(ctx, state);

    expect(m.claudeAgent.plan).toHaveBeenCalledOnce();
    expect(m.codexAgent.implement).not.toHaveBeenCalled();
    expect(m.gitManager.commit).not.toHaveBeenCalled();
    expect(m.claudeAgent.review).not.toHaveBeenCalled();

    expect(result.commitSHA).toBe("");
    expect(result.reviewResult.summary).toContain("plan-only");
    expect(result.artifacts.requirementsPath).toBe("/req.md");
  });

  // PS-STAGE-02
  it("[PS-STAGE-02] stage='build-only' + 산출물 누락 → PipelineServiceError", async () => {
    const state = createState();
    const ctx = createContext({ stage: "build-only", artifacts: {} });

    await expect(svc.executeCycle(ctx, state)).rejects.toThrow(
      PipelineServiceError,
    );
    await expect(svc.executeCycle(ctx, state)).rejects.toThrow(
      /기획 산출물/,
    );
  });

  // PS-STAGE-02a
  it("[PS-STAGE-02a] stage='build-only' + 산출물 존재 → Planning 스킵, Implementation/Review 실행", async () => {
    const artifacts: WorkflowArtifacts = {
      requirementsPath: "/req.md",
      implementationSpecPath: "/spec.md",
      testScenariosPath: "/tests.md",
    };
    const state = createState({ artifacts });
    const ctx = createContext({ stage: "build-only", artifacts });

    const result = await svc.executeCycle(ctx, state);

    expect(m.claudeAgent.plan).not.toHaveBeenCalled();
    expect(m.codexAgent.implement).toHaveBeenCalledOnce();
    expect(m.gitManager.commit).toHaveBeenCalledOnce();
    expect(m.claudeAgent.review).toHaveBeenCalledOnce();

    expect(result.commitSHA).toBe("deadbeef");
    expect(result.changedFiles).toEqual(["src/a.ts"]);
  });

  // PS-STAGE-03
  it("[PS-STAGE-03] executePlanOnly() → state.artifacts 저장 + planResult 반환", async () => {
    const state = createState();
    const ctx = createContext();

    const result = await svc.executePlanOnly(ctx, state);

    expect(m.claudeAgent.plan).toHaveBeenCalledOnce();
    expect(m.codexAgent.implement).not.toHaveBeenCalled();
    expect(m.stateManager.save).toHaveBeenCalled();
    expect(result.planResult.requirementsPath).toBe("/req.md");
    expect(state.artifacts.requirementsPath).toBe("/req.md");
  });

  // PS-STAGE-04
  it("[PS-STAGE-04] stage 미지정 (full) → Planning + Implementation + Review 전부 실행", async () => {
    const state = createState();
    const ctx = createContext();

    const result = await svc.executeCycle(ctx, state);

    expect(m.claudeAgent.plan).toHaveBeenCalledOnce();
    expect(m.codexAgent.implement).toHaveBeenCalledOnce();
    expect(m.gitManager.commit).toHaveBeenCalledOnce();
    expect(m.claudeAgent.review).toHaveBeenCalledOnce();
    expect(m.reviewEngine.evaluate).toHaveBeenCalledOnce();
    expect(result.commitSHA).toBe("deadbeef");
  });

  it("[PS-STAGE-04a] CHANGES_REQUESTED → recommendReworkScope 호출", async () => {
    (m.reviewEngine.evaluate as ReturnType<typeof vi.fn>).mockReturnValue({
      status: "CHANGES_REQUESTED",
      checks: [],
      findings: [],
      summary: "needs work",
    });

    const state = createState();
    const ctx = createContext();
    await svc.executeCycle(ctx, state);

    expect(m.reviewEngine.recommendReworkScope).toHaveBeenCalledOnce();
  });

  it("executeBuildOnly() 위임 → executeCycle({stage:'build-only'}) 와 동등", async () => {
    const artifacts: WorkflowArtifacts = {
      requirementsPath: "/req.md",
      implementationSpecPath: "/spec.md",
      testScenariosPath: "/tests.md",
    };
    const state = createState({ artifacts });
    const ctx = createContext({ artifacts });

    const result = await svc.executeBuildOnly(ctx, state);

    expect(m.claudeAgent.plan).not.toHaveBeenCalled();
    expect(m.codexAgent.implement).toHaveBeenCalledOnce();
    expect(result.commitSHA).toBe("deadbeef");
  });
});
