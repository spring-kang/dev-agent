/**
 * WorkflowService — plan/build 분리 단위 테스트
 *
 * 검증 항목 (build-only 거부 경로 중심):
 *   WS-BUILD-01: notionStatusSync 미구성 → WorkflowServiceError
 *   WS-BUILD-02: Status 가 "Approved" 가 아니면 거부
 *   WS-BUILD-03: --project 미지정 → 거부 (build-only 는 Notion 경로 fallback 없음)
 *   WS-BUILD-04: state 가 없으면 거부 ("먼저 devagent plan ...")
 *   WS-BUILD-05: planningCompleted !== true 면 거부
 *   WS-BUILD-06: 모든 조건 충족 → orchestrator.executeBuildOnly 호출
 *
 *   WS-PLAN-01: planningEnhancer 미구성 → WorkflowServiceError
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { WorkflowService } from "../../../src/services/workflow.service.js";
import { WorkflowServiceError } from "../../../src/types/errors.js";
import type { Logger } from "../../../src/components/logger.js";
import type { Orchestrator } from "../../../src/orchestrator/orchestrator.js";
import type { ConfigManager } from "../../../src/components/config-manager.js";
import type { WorkspaceManager } from "../../../src/components/workspace-manager.js";
import type { StateManager } from "../../../src/components/state-manager.js";
import type { GitManager } from "../../../src/components/git-manager.js";
import type { MonitoringService } from "../../../src/services/monitoring.service.js";
import type { NotionStatusSync } from "../../../src/integrations/notion-status-sync.js";
import type { PlanningEnhancer } from "../../../src/integrations/planning-enhancer.js";
import type { WorkflowState } from "../../../src/types/workflow.js";

function logger(): Logger {
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

function createCompletedPlanState(
  overrides: Partial<WorkflowState> = {},
): WorkflowState {
  return {
    workflowId: "wf-plan-done",
    projectPath: "/proj",
    projectName: "proj",
    taskDescription: "테스트",
    status: "running",
    currentPhase: "plan_review",
    currentCycle: 1,
    maxIterations: 5,
    branchName: "",
    artifacts: {
      requirementsPath: "/req.md",
      implementationSpecPath: "/spec.md",
      testScenariosPath: "/tests.md",
    },
    reviewHistory: [],
    planningCompleted: true,
    startedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Deps {
  orchestrator: Orchestrator;
  configManager: ConfigManager;
  workspaceManager: WorkspaceManager;
  stateManager: StateManager;
  gitManager: GitManager;
  monitoringService: MonitoringService;
  notionStatusSync?: NotionStatusSync;
  planningEnhancer?: PlanningEnhancer;
}

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    orchestrator: {
      executePlanOnly: vi.fn(),
      executeBuildOnly: vi.fn().mockResolvedValue({
        workflowId: "wf-plan-done",
        status: "completed",
        cycles: 1,
        duration: 1,
      }),
      execute: vi.fn(),
    } as unknown as Orchestrator,
    configManager: {
      load: vi.fn(),
    } as unknown as ConfigManager,
    workspaceManager: {
      validateProject: vi.fn(),
      checkPrerequisites: vi.fn(),
      initWorkflowDirs: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceManager,
    stateManager: {
      restore: vi.fn(),
    } as unknown as StateManager,
    gitManager: {} as unknown as GitManager,
    monitoringService: {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as MonitoringService,
    ...overrides,
  };
}

function createService(deps: Deps): WorkflowService {
  return new WorkflowService(
    deps.orchestrator,
    deps.configManager,
    deps.workspaceManager,
    deps.stateManager,
    deps.gitManager,
    deps.monitoringService,
    logger(),
    new EventEmitter(),
    deps.planningEnhancer,
    deps.notionStatusSync,
  );
}

describe("WorkflowService — executeFromNotionBuildOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[WS-BUILD-01] notionStatusSync 미구성 시 즉시 거부", async () => {
    const svc = createService(buildDeps({ notionStatusSync: undefined }));
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow(WorkflowServiceError);
  });

  it("[WS-BUILD-02] Status 가 'Approved' 가 아니면 거부", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Plan Review"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const svc = createService(buildDeps({ notionStatusSync }));
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow(/Approved/);
  });

  it("[WS-BUILD-02a] Status 가 빈 문자열이어도 거부", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue(""),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const svc = createService(buildDeps({ notionStatusSync }));
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow(WorkflowServiceError);
  });

  it("[WS-BUILD-03] --project 미지정 시 거부 (Notion fallback 없음)", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Approved"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const svc = createService(buildDeps({ notionStatusSync }));
    await expect(
      svc.executeFromNotionBuildOnly("page-1"),
    ).rejects.toThrow(/프로젝트 경로/);
  });

  it("[WS-BUILD-04] state 가 없으면 거부 ('먼저 devagent plan')", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Approved"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const deps = buildDeps({ notionStatusSync });
    (deps.stateManager.restore as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const svc = createService(deps);
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow(/devagent plan/);
  });

  it("[WS-BUILD-05] planningCompleted=false 면 거부", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Approved"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const deps = buildDeps({ notionStatusSync });
    (deps.stateManager.restore as ReturnType<typeof vi.fn>).mockResolvedValue(
      createCompletedPlanState({ planningCompleted: false }),
    );

    const svc = createService(deps);
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow(/기획이 완료되지 않은/);
  });

  it("[WS-BUILD-06] 모든 조건 충족 → orchestrator.executeBuildOnly 호출 + statusSync 등록", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Approved"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const deps = buildDeps({ notionStatusSync });
    (deps.stateManager.restore as ReturnType<typeof vi.fn>).mockResolvedValue(
      createCompletedPlanState(),
    );

    const svc = createService(deps);
    const result = await svc.executeFromNotionBuildOnly("page-1", {
      projectPath: "/proj",
    });

    expect(notionStatusSync.fetchCurrentStatus).toHaveBeenCalledWith("page-1");
    expect(notionStatusSync.registerWorkflow).toHaveBeenCalledWith(
      "wf-plan-done",
      "page-1",
    );
    expect(notionStatusSync.start).toHaveBeenCalled();
    expect(deps.orchestrator.executeBuildOnly).toHaveBeenCalledWith("/proj");
    expect(notionStatusSync.stop).toHaveBeenCalled();
    expect(deps.monitoringService.stop).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("[WS-BUILD-07] executeBuildOnly 실패해도 finally 에서 statusSync.stop 호출", async () => {
    const notionStatusSync = {
      fetchCurrentStatus: vi.fn().mockResolvedValue("Approved"),
      registerWorkflow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NotionStatusSync;

    const deps = buildDeps({ notionStatusSync });
    (deps.stateManager.restore as ReturnType<typeof vi.fn>).mockResolvedValue(
      createCompletedPlanState(),
    );
    (deps.orchestrator.executeBuildOnly as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("boom"));

    const svc = createService(deps);
    await expect(
      svc.executeFromNotionBuildOnly("page-1", { projectPath: "/proj" }),
    ).rejects.toThrow("boom");

    expect(notionStatusSync.stop).toHaveBeenCalled();
    expect(deps.monitoringService.stop).toHaveBeenCalled();
  });
});

describe("WorkflowService — executeFromNotionPlanOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[WS-PLAN-01] planningEnhancer 미구성 시 즉시 거부", async () => {
    const svc = createService(buildDeps({ planningEnhancer: undefined }));
    await expect(
      svc.executeFromNotionPlanOnly("page-1"),
    ).rejects.toThrow(WorkflowServiceError);
  });
});
