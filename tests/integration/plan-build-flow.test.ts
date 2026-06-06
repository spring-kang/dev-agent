/**
 * 통합 테스트 — plan → build 분리 흐름
 *
 * 시나리오:
 *   IT-01: plan-only → executePlanOnly 결과로 state.artifacts 채워짐
 *          → build-only → Planning 재실행 없이 Implementation/Review 진입
 *   IT-02: plan-only 실행 후 다시 plan-only → WorkspaceManager.archiveExisting=true 로 백업
 *   IT-03: plan 미실행 + build-only → PipelineServiceError (산출물 누락)
 *
 * 실제 파일시스템/Notion 호출은 모킹.
 * PipelineService 와 의존 컴포넌트는 모킹된 협력자로 실제 인스턴스화.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PipelineService } from "../../src/services/pipeline.service.js";
import { PipelineServiceError } from "../../src/types/errors.js";
import type {
  WorkflowState,
  WorkflowArtifacts,
  CycleContext,
} from "../../src/types/workflow.js";
import type { ClaudeAgent } from "../../src/components/claude-agent.js";
import type { CodexAgent } from "../../src/components/codex-agent.js";
import type { GitManager } from "../../src/components/git-manager.js";
import type { ReviewEngine } from "../../src/components/review-engine.js";
import type { StateManager } from "../../src/components/state-manager.js";
import type { Logger } from "../../src/components/logger.js";

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

function createState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    workflowId: "wf-int-001",
    projectPath: "/proj",
    projectName: "proj",
    taskDescription: "통합 시나리오 작업",
    status: "running",
    currentPhase: "planning",
    currentCycle: 1,
    maxIterations: 5,
    branchName: "",
    artifacts: {},
    reviewHistory: [],
    startedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createContext(
  state: WorkflowState,
  stage?: "full" | "plan-only" | "build-only",
): CycleContext {
  return {
    workflowId: state.workflowId,
    cycleNumber: 1,
    projectPath: state.projectPath,
    taskDescription: state.taskDescription,
    artifacts: state.artifacts,
    stage,
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

function buildMocks(): Mocks {
  return {
    claudeAgent: {
      plan: vi.fn().mockResolvedValue({
        requirementsPath: "/proj/.ai-workflow/current/artifacts/req.md",
        implementationSpecPath: "/proj/.ai-workflow/current/artifacts/spec.md",
        testScenariosPath: "/proj/.ai-workflow/current/artifacts/tests.md",
        summary: "planning ok",
      }),
      review: vi.fn().mockResolvedValue("REVIEW"),
    } as unknown as ClaudeAgent,
    codexAgent: {
      implement: vi.fn().mockResolvedValue({
        changedFiles: ["src/feature.ts"],
        suggestedCommitMessage: "feat: feature",
      }),
    } as unknown as CodexAgent,
    gitManager: {
      commit: vi.fn().mockResolvedValue("abc1234"),
    } as unknown as GitManager,
    reviewEngine: {
      evaluate: vi.fn().mockReturnValue({
        status: "APPROVED",
        checks: [],
        findings: [],
        summary: "looks good",
      }),
      recommendReworkScope: vi.fn(),
    } as unknown as ReviewEngine,
    stateManager: {
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as StateManager,
    emitter: new EventEmitter(),
    logger: createLogger(),
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

describe("통합: plan → build 분리 흐름", () => {
  let m: Mocks;
  let svc: PipelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    m = buildMocks();
    svc = createService(m);
  });

  it("[IT-01] plan-only → build-only: Planning 1회만, Implementation/Review 는 build 단계에서", async () => {
    const state = createState();

    // 1단계: plan-only
    const planResult = await svc.executePlanOnly(
      createContext(state, "plan-only"),
      state,
    );

    expect(planResult.planResult.requirementsPath).toMatch(/req\.md$/);
    expect(state.artifacts.requirementsPath).toMatch(/req\.md$/);
    expect(state.artifacts.implementationSpecPath).toMatch(/spec\.md$/);

    expect(m.claudeAgent.plan).toHaveBeenCalledTimes(1);
    expect(m.codexAgent.implement).not.toHaveBeenCalled();
    expect(m.gitManager.commit).not.toHaveBeenCalled();

    // 2단계: build-only (같은 state 재사용)
    const ctxBuild: CycleContext = {
      workflowId: state.workflowId,
      cycleNumber: 2,
      projectPath: state.projectPath,
      taskDescription: state.taskDescription,
      artifacts: state.artifacts,
      stage: "build-only",
    } as CycleContext;

    const buildResult = await svc.executeCycle(ctxBuild, state);

    // Planning 은 더 이상 실행되지 않음 (총 1회 유지)
    expect(m.claudeAgent.plan).toHaveBeenCalledTimes(1);
    expect(m.codexAgent.implement).toHaveBeenCalledOnce();
    expect(m.gitManager.commit).toHaveBeenCalledOnce();
    expect(m.claudeAgent.review).toHaveBeenCalledOnce();
    expect(buildResult.commitSHA).toBe("abc1234");
    expect(buildResult.changedFiles).toEqual(["src/feature.ts"]);
  });

  it("[IT-02] plan-only → 다시 plan-only: Planning 이 2회 실행되며 산출물이 갱신됨 (재기획 시나리오)", async () => {
    const state = createState();

    await svc.executePlanOnly(createContext(state, "plan-only"), state);
    expect(m.claudeAgent.plan).toHaveBeenCalledTimes(1);

    // 두 번째 plan: 새로운 산출물 반환하도록 모킹
    (m.claudeAgent.plan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      requirementsPath: "/proj/.ai-workflow/current/artifacts/req-v2.md",
      implementationSpecPath: "/proj/.ai-workflow/current/artifacts/spec-v2.md",
      testScenariosPath: "/proj/.ai-workflow/current/artifacts/tests-v2.md",
      summary: "planning v2",
    });

    await svc.executePlanOnly(createContext(state, "plan-only"), state);

    expect(m.claudeAgent.plan).toHaveBeenCalledTimes(2);
    expect(state.artifacts.requirementsPath).toMatch(/req-v2\.md$/);
  });

  it("[IT-03] plan 미실행 상태에서 build-only → PipelineServiceError", async () => {
    const state = createState({ artifacts: {} });
    const ctx = createContext(state, "build-only");

    await expect(svc.executeCycle(ctx, state)).rejects.toThrow(
      PipelineServiceError,
    );
  });

  it("[IT-04] plan-only 산출물이 일부만 있어도 build-only 는 PipelineServiceError", async () => {
    const partialArtifacts: WorkflowArtifacts = {
      requirementsPath: "/req.md",
      // implementationSpecPath 누락
      testScenariosPath: "/tests.md",
    };
    const state = createState({ artifacts: partialArtifacts });
    const ctx = createContext(state, "build-only");

    await expect(svc.executeCycle(ctx, state)).rejects.toThrow(
      PipelineServiceError,
    );
  });
});
