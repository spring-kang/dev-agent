/**
 * WorkflowService (S-01) - Facade 패턴
 * Preflight 검증 → Orchestrator 위임 → 결과 반환
 */

import type { EventEmitter } from "node:events";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { ConfigManager } from "../components/config-manager.js";
import type { WorkspaceManager } from "../components/workspace-manager.js";
import type { StateManager } from "../components/state-manager.js";
import type { MonitoringService } from "./monitoring.service.js";
import type { Logger } from "../components/logger.js";
import type { GitManager } from "../components/git-manager.js";
import type {
  WorkflowRequest,
  WorkflowResult,
  WorkflowStatus,
  WorkflowPhase,
} from "../types/workflow.js";
import type { WorkflowConfig } from "../types/config.js";
import type { PhaseStartEvent } from "../types/events.js";
import { PreflightError, WorkflowServiceError } from "../types/errors.js";
import type { PlanningEnhancer } from "../integrations/planning-enhancer.js";
import type { NotionStatusSync } from "../integrations/notion-status-sync.js";
import type { NotionArtifactSync } from "../integrations/notion-artifact-sync.js";
import type { EnhancedPlan } from "../types/integrations.js";

const MAX_PARALLEL_WORKFLOWS = 5;

export interface PreflightResult {
  valid: boolean;
  config: WorkflowConfig;
  warnings: string[];
  errors: string[];
}

export class WorkflowService {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly configManager: ConfigManager,
    private readonly workspaceManager: WorkspaceManager,
    private readonly stateManager: StateManager,
    private readonly gitManager: GitManager,
    private readonly monitoringService: MonitoringService,
    private readonly logger: Logger,
    private readonly eventEmitter?: EventEmitter,
    private readonly planningEnhancer?: PlanningEnhancer,
    private readonly notionStatusSync?: NotionStatusSync,
    private readonly notionArtifactSync?: NotionArtifactSync,
  ) {}

  /**
   * 워크플로우 실행 (Facade)
   */
  async execute(
    projectPath: string,
    taskDescription: string,
    cliOverrides?: Partial<WorkflowConfig>,
  ): Promise<WorkflowResult> {
    // 1. Preflight 검증
    const preflight = await this.preflight(projectPath, cliOverrides);
    if (!preflight.valid) {
      throw new PreflightError(preflight.errors);
    }

    // 경고 출력
    for (const warning of preflight.warnings) {
      this.logger.warn(warning);
    }

    // 2. WorkflowRequest 구성
    const request: WorkflowRequest = {
      projectPath,
      taskDescription,
      config: preflight.config,
    };

    // 3. 워크플로우 디렉토리 초기화
    await this.workspaceManager.initWorkflowDirs(projectPath);

    // 4. 모니터링 시작
    this.monitoringService.start("pending", projectPath, taskDescription);

    try {
      // 5. Orchestrator 위임
      const result = await this.orchestrator.execute(request);

      // 6. 모니터링 종료
      this.monitoringService.stop();

      return result;
    } catch (error) {
      this.monitoringService.stop();
      throw error;
    }
  }

  /**
   * Notion task → Plan 단계만 실행
   * 1) enhanceFromTask 로 기획 고도화
   * 2) WorkspaceManager.initWorkflowDirs(archiveExisting=true) 로 기존 current 백업
   * 3) Orchestrator.executePlanOnly 호출 → Planning 만 실행
   * 4) Notion Status → "Plan Review" 로 동기화 (statusSync.syncForPhase 직접 호출)
   * 5) state.planningCompleted = true 저장
   */
  async executeFromNotionPlanOnly(
    notionPageId: string,
    options?: {
      projectPath?: string;
      cliOverrides?: Partial<WorkflowConfig>;
      skipClaudeEnhancement?: boolean;
    },
  ): Promise<{
    enhancedPlan: EnhancedPlan;
    workflowId: string;
    artifactsPath: string;
  }> {
    if (!this.planningEnhancer) {
      throw new WorkflowServiceError(
        "Notion 통합이 구성되지 않았습니다. integrations.json 에 Notion 인증을 등록하세요.",
        "recoverable",
      );
    }

    this.logger.info(`Notion task 기획 단계 시작: ${notionPageId}`);

    // 1) 기획 고도화
    const enhancedPlan = await this.planningEnhancer.enhanceFromTask(
      notionPageId,
      { skipClaude: options?.skipClaudeEnhancement },
    );
    this.logger.info(
      `기획 고도화 완료: ${enhancedPlan.taskTitle} (참조 페이지 ${enhancedPlan.context.task.referencedPages.length}개)`,
    );

    const resolvedProjectPath =
      options?.projectPath?.trim() ||
      enhancedPlan.context.task.projectPath.trim();
    if (!resolvedProjectPath) {
      throw new WorkflowServiceError(
        "프로젝트 경로가 지정되지 않았습니다. Notion task 의 'Project Path' 속성이나 인자로 전달하세요.",
        "recoverable",
      );
    }

    // 2) Preflight
    const preflight = await this.preflight(resolvedProjectPath, options?.cliOverrides);
    if (!preflight.valid) {
      throw new PreflightError(preflight.errors);
    }
    for (const warning of preflight.warnings) {
      this.logger.warn(warning);
    }

    // 3) 워크스페이스 초기화 (기존 current 가 있으면 archive 로 백업 후 새로 생성)
    await this.workspaceManager.initWorkflowDirs(resolvedProjectPath, {
      archiveExisting: true,
    });

    // 4) Orchestrator.executePlanOnly
    const request: WorkflowRequest = {
      projectPath: resolvedProjectPath,
      taskDescription: enhancedPlan.enhancedTaskDescription,
      config: preflight.config,
    };

    this.monitoringService.start("pending", resolvedProjectPath, enhancedPlan.taskTitle);
    try {
      const result = await this.orchestrator.executePlanOnly(request);

      // 5) Notion Status → Plan Review (실패해도 워크플로우는 성공)
      if (this.notionStatusSync) {
        await this.notionStatusSync.setStatusDirect(notionPageId, "Plan Review");
      }

      return {
        enhancedPlan,
        workflowId: result.workflowId,
        artifactsPath: result.artifactsPath,
      };
    } finally {
      this.monitoringService.stop();
    }
  }

  /**
   * Notion task → Build 단계만 실행
   * 1) Notion Status 조회 → "Approved" 가 아니면 즉시 거부
   * 2) state 복원 → planningCompleted 검증
   * 3) Orchestrator.executeBuildOnly 호출
   * 4) Notion Status 동기화는 기존 phase 이벤트 기반 sync 에 위임
   */
  async executeFromNotionBuildOnly(
    notionPageId: string,
    options?: {
      projectPath?: string;
      cliOverrides?: Partial<WorkflowConfig>;
    },
  ): Promise<WorkflowResult> {
    if (!this.notionStatusSync) {
      throw new WorkflowServiceError(
        "Notion 통합이 구성되지 않았습니다. integrations.json 에 Notion 인증을 등록하세요.",
        "recoverable",
      );
    }

    this.logger.info(`Notion task 개발 단계 시작: ${notionPageId}`);

    // 1) Notion Status 검증
    let currentStatus = "";
    try {
      currentStatus = await this.notionStatusSync.fetchCurrentStatus(notionPageId);
    } catch (err) {
      throw new WorkflowServiceError(
        `Notion Status 조회 실패 (page=${notionPageId}): ${(err as Error).message}`,
        "recoverable",
        undefined,
        err as Error,
      );
    }

    if (currentStatus !== "Approved") {
      throw new WorkflowServiceError(
        `Status가 Approved가 아닙니다 (현재: "${currentStatus || "(없음)"}"). ` +
          `Notion 에서 승인 후 다시 실행하세요.`,
        "recoverable",
      );
    }

    // 2) 프로젝트 경로 결정
    const resolvedProjectPath = options?.projectPath?.trim();
    if (!resolvedProjectPath) {
      throw new WorkflowServiceError(
        "프로젝트 경로가 지정되지 않았습니다. --project 옵션 또는 rc 설정으로 전달하세요.",
        "recoverable",
      );
    }

    // 3) state 검증
    const state = await this.stateManager.restore(resolvedProjectPath);
    if (!state) {
      throw new WorkflowServiceError(
        "기획 단계 산출물이 없습니다. 먼저 `devagent plan <pageId>` 를 실행하세요.",
        "recoverable",
      );
    }
    if (state.planningCompleted !== true) {
      throw new WorkflowServiceError(
        "기획이 완료되지 않은 워크플로우입니다.",
        "recoverable",
      );
    }

    // 4) Notion sync 등록 (기존 workflowId 재사용)
    const statusSync = this.notionStatusSync;
    const artifactSync = this.notionArtifactSync;
    statusSync.registerWorkflow(state.workflowId, notionPageId);
    statusSync.start();
    if (artifactSync) {
      artifactSync.registerWorkflow(state.workflowId, notionPageId, resolvedProjectPath);
      artifactSync.start();
    }

    // 5) Orchestrator.executeBuildOnly
    this.monitoringService.start(state.workflowId, resolvedProjectPath, state.taskDescription);
    try {
      const result = await this.orchestrator.executeBuildOnly(resolvedProjectPath);
      return result;
    } finally {
      this.monitoringService.stop();
      statusSync.stop();
      if (artifactSync) artifactSync.stop();
    }
  }

  /**
   * Notion task 기반 워크플로우 실행
   * 1) Notion DB row + 본문 + 참조 페이지로 상세 기획서 자동 생성
   * 2) 워크플로우 실행 (projectPath는 Notion 속성 우선, 인자값으로 override 가능)
   * 3) 진행 단계에 따라 Notion Status 속성 자동 전이
   */
  async executeFromNotion(
    notionPageId: string,
    options?: {
      projectPath?: string;
      cliOverrides?: Partial<WorkflowConfig>;
      skipClaudeEnhancement?: boolean;
      statusMapping?: Partial<Record<WorkflowPhase, string>>;
    },
  ): Promise<WorkflowResult & { enhancedPlan: EnhancedPlan }> {
    if (!this.planningEnhancer) {
      throw new WorkflowServiceError(
        "Notion 통합이 구성되지 않았습니다. integrations.json에 Notion 인증을 등록하세요.",
        "recoverable",
      );
    }

    this.logger.info(`Notion task 기반 워크플로우 시작: ${notionPageId}`);

    // 1) 상세 기획서 생성
    const enhancedPlan = await this.planningEnhancer.enhanceFromTask(
      notionPageId,
      { skipClaude: options?.skipClaudeEnhancement },
    );

    this.logger.info(
      `기획 고도화 완료: ${enhancedPlan.taskTitle} (참조 페이지 ${enhancedPlan.context.task.referencedPages.length}개)`,
    );

    // projectPath 결정: 인자 우선, 없으면 Notion 속성, 없으면 에러
    const resolvedProjectPath =
      options?.projectPath?.trim() ||
      enhancedPlan.context.task.projectPath.trim();

    if (!resolvedProjectPath) {
      throw new WorkflowServiceError(
        "프로젝트 경로가 지정되지 않았습니다. Notion task의 'Project Path' 속성이나 인자로 전달하세요.",
        "recoverable",
      );
    }

    // 2) 상태/산출물 동기화 시작 - 첫 phase:start 이벤트로 workflowId 캡처
    //    하나의 captureHandler 안에서 두 sync를 모두 등록한다.
    let syncStarted = false;
    const statusSync = this.notionStatusSync;
    const artifactSync = this.notionArtifactSync;
    const bus = this.eventEmitter;
    let captureHandler: ((event: PhaseStartEvent) => void) | undefined;

    if ((statusSync || artifactSync) && bus) {
      captureHandler = (event: PhaseStartEvent): void => {
        if (syncStarted) return;
        syncStarted = true;
        if (statusSync) {
          statusSync.registerWorkflow(event.workflowId, notionPageId);
          statusSync.start();
        }
        if (artifactSync) {
          artifactSync.registerWorkflow(
            event.workflowId,
            notionPageId,
            resolvedProjectPath,
          );
          artifactSync.start();
        }
      };
      bus.once("phase:start", captureHandler);
    } else if ((statusSync || artifactSync) && !bus) {
      this.logger.warn("EventEmitter 미주입 - Notion 자동 동기화 비활성화");
    }

    // 3) 워크플로우 실행
    try {
      const result = await this.execute(
        resolvedProjectPath,
        enhancedPlan.enhancedTaskDescription,
        options?.cliOverrides,
      );
      return { ...result, enhancedPlan };
    } finally {
      if (bus && captureHandler && !syncStarted) {
        bus.off("phase:start", captureHandler);
      }
      if (syncStarted) {
        if (statusSync) statusSync.stop();
        if (artifactSync) artifactSync.stop();
      }
    }
  }

  /**
   * 병렬 실행
   */
  async executeParallel(
    projects: Array<{ projectPath: string; taskDescription: string }>,
    cliOverrides?: Partial<WorkflowConfig>,
  ): Promise<WorkflowResult[]> {
    if (projects.length > MAX_PARALLEL_WORKFLOWS) {
      throw new WorkflowServiceError(
        `최대 ${MAX_PARALLEL_WORKFLOWS}개 프로젝트까지 병렬 실행 가능합니다`,
        "critical",
      );
    }

    // 각 프로젝트 preflight
    const requests: WorkflowRequest[] = [];
    for (const project of projects) {
      const preflight = await this.preflight(project.projectPath, cliOverrides);
      if (!preflight.valid) {
        throw new PreflightError(preflight.errors);
      }
      await this.workspaceManager.initWorkflowDirs(project.projectPath);
      requests.push({
        projectPath: project.projectPath,
        taskDescription: project.taskDescription,
        config: preflight.config,
      });
    }

    return this.orchestrator.executeParallel(requests);
  }

  /**
   * 워크플로우 재시작
   */
  async resume(projectPath: string): Promise<WorkflowResult> {
    // 복구 가능 상태 확인
    const state = await this.stateManager.restore(projectPath);
    if (!state) {
      throw new WorkflowServiceError("복구할 워크플로우가 없습니다", "recoverable");
    }
    if (state.status === "completed") {
      throw new WorkflowServiceError("이미 완료된 워크플로우입니다", "recoverable");
    }

    this.monitoringService.start(state.workflowId, projectPath, state.taskDescription);

    try {
      const result = await this.orchestrator.resume(projectPath);
      this.monitoringService.stop();
      return result;
    } catch (error) {
      this.monitoringService.stop();
      throw error;
    }
  }

  /**
   * 상태 조회
   */
  async getStatus(projectPath?: string): Promise<WorkflowStatus[]> {
    return this.orchestrator.getStatus(projectPath);
  }

  /**
   * 리포트 생성
   */
  getReport(): import("./monitoring.service.js").WorkflowReport | null {
    return this.monitoringService.generateReport();
  }

  /**
   * 사전 검증 (Preflight)
   */
  private async preflight(
    projectPath: string,
    cliOverrides?: Partial<WorkflowConfig>,
  ): Promise<PreflightResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 설정 로드
    let config: WorkflowConfig;
    try {
      const configResult = await this.configManager.load(projectPath, cliOverrides);
      config = configResult.value;
    } catch (error) {
      errors.push(`설정 로드 실패: ${(error as Error).message}`);
      return { valid: false, config: {} as WorkflowConfig, warnings, errors };
    }

    // 2. 프로젝트 검증
    const validation = await this.workspaceManager.validateProject(projectPath);
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
    warnings.push(...validation.warnings);

    // 3. CLI 도구 확인
    const prereq = await this.workspaceManager.checkPrerequisites();
    if (!prereq.allPassed) {
      const missing = prereq.checks
        .filter((c) => c.required && !c.found)
        .map((c) => c.tool);
      errors.push(`필수 도구 누락: ${missing.join(", ")}`);
    }

    // 4. Dirty state 확인 (경고만)
    try {
      const dirtyState = await this.gitManager.checkDirtyState(projectPath);
      if (dirtyState.isDirty) {
        const count = dirtyState.untrackedFiles.length + dirtyState.modifiedFiles.length;
        warnings.push(`작업 중인 변경사항이 감지되었습니다 (${count}개 파일)`);
      }
    } catch {
      // dirty state 확인 실패는 무시
    }

    // 5. 기존 워크플로우 확인 (경고만)
    try {
      const existingState = await this.stateManager.restore(projectPath);
      if (existingState && existingState.status === "running") {
        warnings.push("이미 진행 중인 워크플로우가 있습니다 ('dev-agent resume'로 복구 가능)");
      }
    } catch {
      // 상태 확인 실패는 무시
    }

    return { valid: errors.length === 0, config, warnings, errors };
  }
}
