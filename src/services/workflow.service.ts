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
