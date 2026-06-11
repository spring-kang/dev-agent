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
} from "../types/workflow.js";
import type { WorkflowConfig } from "../types/config.js";
import { PreflightError, WorkflowServiceError } from "../types/errors.js";
import type { NotionStatusSync } from "../integrations/notion-status-sync.js";
import type { NotionArtifactSync } from "../integrations/notion-artifact-sync.js";
import type { NotionClient } from "../integrations/notion-client.js";

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
    private readonly notionStatusSync?: NotionStatusSync,
    private readonly notionArtifactSync?: NotionArtifactSync,
    private readonly notionClient?: NotionClient,
  ) {}

  /**
   * 워크플로우 실행 (Facade)
   *
   * inlineSpec 옵션이 주어지면 Planning을 스킵하고 해당 본문을 Codex 구현 명세로 직접 전달.
   * (Notion → Codex 직접 흐름용)
   */
  async execute(
    projectPath: string,
    taskDescription: string,
    cliOverrides?: Partial<WorkflowConfig>,
    extras?: { inlineSpec?: string; inlineSpecSource?: string },
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
      ...(extras?.inlineSpec ? { inlineSpec: extras.inlineSpec } : {}),
      ...(extras?.inlineSpecSource ? { inlineSpecSource: extras.inlineSpecSource } : {}),
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
   * Notion task → Build 실행 (단순화된 흐름)
   *
   * 전제: 사용자가 CLI에서 직접 `claude`로 기획을 작성/검토하고,
   *       Notion task의 Status를 "Approved"로 직접 전이시킨 상태.
   *
   * 흐름:
   *   1) Notion Status="Approved" 검증 (실패 시 즉시 거부)
   *   2) Notion task properties(projectPath, title) + 본문 markdown 로드
   *   3) Notion 본문을 implementation spec으로 그대로 Codex에 전달
   *      (별도 planning enhancer/Claude 호출 없음)
   *   4) Implementation → Commit → Review(Sonnet) → PR
   *   5) Status는 phase 이벤트 기반 sync(In Progress → In Review → Done)에 위임
   */
  async executeBuildFromNotion(
    notionPageId: string,
    options?: {
      projectPath?: string;
      cliOverrides?: Partial<WorkflowConfig>;
    },
  ): Promise<WorkflowResult> {
    if (!this.notionStatusSync || !this.notionClient) {
      throw new WorkflowServiceError(
        "Notion 통합이 구성되지 않았습니다. integrations.json 에 Notion 인증을 등록하세요.",
        "recoverable",
      );
    }

    this.logger.info(`Notion task 개발 단계 시작: ${notionPageId}`);

    // 1) Notion Status 검증 (Approved만 통과)
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
          `claude로 기획을 마치고 Notion에서 Status를 "Approved"로 변경한 뒤 다시 실행하세요.`,
        "recoverable",
      );
    }

    // 2) Notion task 상세 로드 (본문 = 기획서)
    const task = await this.notionClient.getTask(notionPageId);
    if (!task) {
      throw new WorkflowServiceError(
        `Notion 페이지를 찾을 수 없거나 접근 권한이 없습니다 (page=${notionPageId}). ` +
          `Notion에서 integration이 페이지에 연결되었는지 확인하세요.`,
        "recoverable",
      );
    }

    const inlineSpec = task.bodyMarkdown.trim();
    if (inlineSpec.length === 0) {
      throw new WorkflowServiceError(
        `Notion task 본문이 비어 있습니다 (page=${notionPageId}). ` +
          `claude로 기획서를 작성해 task 본문에 채운 뒤 다시 실행하세요.`,
        "recoverable",
      );
    }

    // 3) 프로젝트 경로 결정 (CLI > rc > Notion 속성)
    const resolvedProjectPath =
      options?.projectPath?.trim() || task.projectPath.trim();
    if (!resolvedProjectPath) {
      throw new WorkflowServiceError(
        "프로젝트 경로가 지정되지 않았습니다. --project 옵션, .devagentrc, 또는 Notion task의 'Project Path' 속성 중 하나로 전달하세요.",
        "recoverable",
      );
    }

    // 4) 일반 워크플로우 실행 (taskDescription = task 제목 + 본문)
    //    inline spec은 별도 경로로 전달 (Orchestrator → Pipeline → CodexAgent.inlineSpec)
    const taskDescription = `${task.title}\n\n${inlineSpec}`;

    // 5) phase:start 이벤트로 workflowId 캡처 후 Notion sync 시작
    let syncStarted = false;
    const statusSync = this.notionStatusSync;
    const artifactSync = this.notionArtifactSync;
    const bus = this.eventEmitter;
    let captureHandler: ((event: import("../types/events.js").PhaseStartEvent) => void) | undefined;

    if (bus) {
      captureHandler = (event): void => {
        if (syncStarted) return;
        syncStarted = true;
        statusSync.registerWorkflow(event.workflowId, notionPageId);
        statusSync.start();
        if (artifactSync) {
          artifactSync.registerWorkflow(event.workflowId, notionPageId, resolvedProjectPath);
          artifactSync.start();
        }
      };
      bus.once("phase:start", captureHandler);
    }

    try {
      const result = await this.execute(
        resolvedProjectPath,
        taskDescription,
        options?.cliOverrides,
        { inlineSpec, inlineSpecSource: `notion:${notionPageId}` },
      );
      return result;
    } finally {
      if (bus && captureHandler && !syncStarted) {
        bus.off("phase:start", captureHandler);
      }
      if (syncStarted) {
        statusSync.stop();
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
