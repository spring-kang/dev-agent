/**
 * WorkflowService (S-01) - Facade 패턴
 * Preflight 검증 → Orchestrator 위임 → 결과 반환
 */

import type { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
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
import {
  toBatchTaskInput,
  groupTasksByDomain,
  runWithConcurrency,
  summarizeOutcomes,
  type BatchTaskInput,
  type BatchTaskOutcome,
  type BatchBuildSummary,
} from "./batch-scheduler.js";

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
      /**
       * 이벤트 기반 실시간 Notion Status 동기화 사용 여부 (기본 true).
       * 배치(병렬) 빌드에서는 여러 워크플로우가 같은 EventEmitter 를 공유하여
       * phase:start 이벤트의 workflowId↔pageId 매칭이 어긋나므로 false 로 끄고,
       * 호출 측(executeBuildFromNotionBatch)이 setStatusDirect 로 명시 전이한다.
       */
      liveStatusSync?: boolean;
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
    const liveStatusSync = options?.liveStatusSync !== false;
    let syncStarted = false;
    const statusSync = this.notionStatusSync;
    const artifactSync = this.notionArtifactSync;
    const bus = this.eventEmitter;
    let captureHandler: ((event: import("../types/events.js").PhaseStartEvent) => void) | undefined;

    // 배치 모드(liveStatusSync=false): 이벤트 매칭이 불가하므로 빌드 시작 시점에
    // "In Progress" 로만 직접 전이한다. 최종 상태는 배치 호출 측이 갱신한다.
    if (!liveStatusSync) {
      await statusSync.setStatusDirect(notionPageId, "In Progress");
    }

    if (bus && liveStatusSync) {
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
   * Notion 의 Approved task 들을 도메인별로 묶어 일괄 빌드한다.
   *
   * 스케줄링:
   *   - task 제목 prefix 로 도메인 식별 (`interview-1` → `interview`)
   *   - 같은 도메인은 한 레인에서 슬라이스 번호 순으로 **순차** (앞 슬라이스 실패 시
   *     같은 도메인 후속 슬라이스는 skip)
   *   - 서로 다른 도메인 레인은 최대 concurrency 개까지 **병렬**
   *
   * 격리:
   *   - 모든 task 가 같은 저장소(basePath)를 공유하므로, 동시 빌드는 각각
   *     `git worktree` 로 격리된 워킹트리에서 수행한다 (브랜치/인덱스 충돌 방지).
   *
   * 상태:
   *   - 이벤트 기반 live sync 는 동시 실행에서 매칭이 어긋나므로 끄고,
   *     빌드 시작 시 "In Progress", 종료 시 완료="Done"/실패="Approved" 로 직접 전이.
   */
  async executeBuildFromNotionBatch(options: {
    databaseId: string;
    basePath?: string;
    concurrency?: number;
    cliOverrides?: Partial<WorkflowConfig>;
    dryRun?: boolean;
    keepWorktrees?: boolean;
  }): Promise<BatchBuildSummary> {
    if (!this.notionStatusSync || !this.notionClient) {
      throw new WorkflowServiceError(
        "Notion 통합이 구성되지 않았습니다. integrations.json 에 Notion 인증을 등록하세요.",
        "recoverable",
      );
    }
    const notionClient = this.notionClient;
    const statusSync = this.notionStatusSync;

    // 1) Approved task 수집
    const approved = await notionClient.queryDatabase(options.databaseId, {
      status: "Approved",
      pageSize: 100,
    });
    const inputs: BatchTaskInput[] = approved
      .filter((t) => t.title.trim().length > 0)
      .map((t) => toBatchTaskInput(t));

    const lanes = groupTasksByDomain(inputs);

    if (inputs.length === 0) {
      return summarizeOutcomes([], lanes, options.dryRun ?? false);
    }

    // 2) base 저장소 경로 결정 (CLI > Notion 속성)
    const basePath =
      options.basePath?.trim() ||
      inputs.find((t) => t.projectPath.trim().length > 0)?.projectPath.trim();
    if (!basePath) {
      throw new WorkflowServiceError(
        "base 프로젝트 경로를 결정할 수 없습니다. --project 옵션 또는 Notion task 의 'Project Path' 속성을 설정하세요.",
        "recoverable",
      );
    }

    // 3) dry-run: 스케줄만 출력
    if (options.dryRun) {
      return summarizeOutcomes([], lanes, true);
    }

    // 4) base 브랜치 확정 + 사전 fetch (동시 fetch ref-lock 경합 방지)
    const { value: baseConfig } = await this.configManager.load(
      basePath,
      options.cliOverrides,
    );
    const baseBranch = baseConfig.baseBranch;
    await this.gitManager.fetchBase(basePath, baseBranch);
    const baseRef = await this.gitManager.resolveWorktreeBaseRef(basePath, baseBranch);

    const worktreeRoot = path.join(os.tmpdir(), "devagent-worktrees");
    await mkdir(worktreeRoot, { recursive: true });

    const concurrency = Math.min(
      Math.max(1, options.concurrency ?? MAX_PARALLEL_WORKFLOWS),
      MAX_PARALLEL_WORKFLOWS,
    );

    this.logger.info(
      `배치 빌드 시작: ${inputs.length}개 task, ${lanes.length}개 도메인 레인, ` +
        `동시성=${concurrency}, base=${baseRef}`,
    );

    // 5) 레인 단위 동시 실행 (레인 내부는 순차, 실패 시 후속 skip)
    const laneResults = await runWithConcurrency(lanes, concurrency, async (lane) => {
      const outcomes: BatchTaskOutcome[] = [];
      let laneFailed = false;

      for (const task of lane.tasks) {
        if (laneFailed) {
          this.logger.warn(
            `[${lane.domain}] 이전 슬라이스 실패로 skip: ${task.title}`,
          );
          outcomes.push({
            pageId: task.pageId,
            title: task.title,
            domain: lane.domain,
            status: "skipped",
            error: "같은 도메인의 이전 슬라이스 빌드 실패로 건너뜀",
          });
          continue;
        }

        const outcome = await this.buildSingleInWorktree(
          task,
          basePath,
          baseRef,
          worktreeRoot,
          statusSync,
          notionClient,
          options.cliOverrides,
          options.keepWorktrees ?? false,
        );
        outcomes.push(outcome);
        if (outcome.status !== "succeeded") {
          laneFailed = true;
        }
      }
      return outcomes;
    });

    const allOutcomes = laneResults.flat();
    return summarizeOutcomes(allOutcomes, lanes, false);
  }

  /**
   * 단일 task 를 격리된 worktree 에서 빌드한다 (배치 내부 헬퍼).
   * 모든 예외를 잡아 outcome 으로 변환하므로 레인 루프를 깨지 않는다.
   */
  private async buildSingleInWorktree(
    task: BatchTaskInput,
    basePath: string,
    baseRef: string,
    worktreeRoot: string,
    statusSync: NotionStatusSync,
    notionClient: NotionClient,
    cliOverrides: Partial<WorkflowConfig> | undefined,
    keepWorktrees: boolean,
  ): Promise<BatchTaskOutcome> {
    const shortId = task.pageId.replace(/-/g, "").slice(0, 8);
    const rand = crypto.randomBytes(3).toString("hex");
    const worktreePath = path.join(
      worktreeRoot,
      `${task.domain}-${task.slice}-${shortId}-${rand}`,
    );

    const base: Omit<BatchTaskOutcome, "status"> = {
      pageId: task.pageId,
      title: task.title,
      domain: task.domain,
    };

    try {
      await this.gitManager.addDetachedWorktree(basePath, worktreePath, baseRef);
    } catch (err) {
      this.logger.error(
        `[${task.domain}] worktree 생성 실패: ${(err as Error).message}`,
      );
      return { ...base, status: "failed", error: `worktree 생성 실패: ${(err as Error).message}` };
    }

    try {
      const result = await this.executeBuildFromNotion(task.pageId, {
        projectPath: worktreePath,
        ...(cliOverrides ? { cliOverrides } : {}),
        liveStatusSync: false,
      });

      const succeeded = result.status === "completed";
      // 최종 상태 직접 전이 (완료=Done, 실패/중단=Approved 로 재시도 가능하게)
      await statusSync.setStatusDirect(task.pageId, succeeded ? "Done" : "Approved");

      if (succeeded && result.prUrl) {
        try {
          await notionClient.addComment(
            task.pageId,
            `✅ dev-agent 배치 빌드 완료\nPR: ${result.prUrl}`,
          );
        } catch {
          // 코멘트 실패는 무시
        }
        return { ...base, status: "succeeded", prUrl: result.prUrl };
      }

      if (succeeded) {
        return { ...base, status: "succeeded" };
      }

      return {
        ...base,
        status: "failed",
        error: result.error?.message ?? `워크플로우 상태: ${result.status}`,
      };
    } catch (err) {
      await statusSync.setStatusDirect(task.pageId, "Approved");
      this.logger.error(`[${task.domain}] 빌드 실패: ${(err as Error).message}`);
      return { ...base, status: "failed", error: (err as Error).message };
    } finally {
      if (!keepWorktrees) {
        await this.gitManager.removeWorktree(basePath, worktreePath);
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
