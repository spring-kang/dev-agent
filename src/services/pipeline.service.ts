/**
 * PipelineService (S-02) - 단일 사이클 실행 파이프라인
 * BR-04: Planning → Implementation → Review 순서 강제
 * BR-06: 각 단계 완료 후 즉시 상태 저장
 */

import { EventEmitter } from "node:events";
import type { ClaudeAgent } from "../components/claude-agent.js";
import type { CodexAgent } from "../components/codex-agent.js";
import type { GitManager } from "../components/git-manager.js";
import type { ReviewEngine } from "../components/review-engine.js";
import type { StateManager } from "../components/state-manager.js";
import type { Logger } from "../components/logger.js";
import type {
  CycleContext,
  CycleResult,
  WorkflowState,
  WorkflowArtifacts,
  WorkflowPhase,
} from "../types/workflow.js";
import type { PlanResult } from "../types/agent.js";
import { PipelineServiceError } from "../types/errors.js";
import type { PhaseStartEvent, PhaseCompleteEvent, CycleCompleteEvent } from "../types/events.js";

/** plan-only 실행 결과 */
export interface PlanOnlyResult {
  artifacts: WorkflowArtifacts;
  planResult: PlanResult;
  duration: number;
}

export class PipelineService {
  constructor(
    private readonly claudeAgent: ClaudeAgent,
    private readonly codexAgent: CodexAgent,
    private readonly gitManager: GitManager,
    private readonly reviewEngine: ReviewEngine,
    private readonly stateManager: StateManager,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
  ) {}

  /**
   * 단일 사이클 실행 (Planning → Implementation → Commit → Review → Evaluate)
   *
   * stage 옵션:
   * - "full" (기본): 전체 사이클 실행
   * - "plan-only": Planning 만 실행 후 즉시 반환 (Implementation/Review 스킵)
   *   → CycleResult 의 reviewResult/commitSHA 가 무의미한 placeholder
   *   → 명시적 분리 호출을 원하면 executePlanOnly() 사용 권장
   * - "build-only": Planning 스킵, 기존 state.artifacts 의 planResult 재사용 후
   *   Implementation 부터 시작 → reviewResult 반환
   */
  async executeCycle(context: CycleContext, state: WorkflowState): Promise<CycleResult> {
    const stage = context.stage ?? "full";

    if (stage === "plan-only") {
      // 호환을 위해 placeholder reviewResult 채워 반환
      const planResult = await this.runPlanning(context, state);
      const updatedArtifacts: WorkflowArtifacts = {
        ...context.artifacts,
        requirementsPath: planResult.requirementsPath,
        implementationSpecPath: planResult.implementationSpecPath,
        testScenariosPath: planResult.testScenariosPath,
      };
      return {
        reviewResult: {
          status: "APPROVED",
          checks: [],
          findings: [],
          summary: "plan-only stage placeholder",
        },
        changedFiles: [],
        artifacts: updatedArtifacts,
        commitSHA: "",
        duration: 0,
      };
    }

    const cycleStart = performance.now();
    const { cycleNumber, projectPath, artifacts } = context;
    this.logger.setCycleNumber(cycleNumber);

    let planResult: PlanResult;
    let updatedArtifacts: WorkflowArtifacts = { ...artifacts };

    if (stage === "build-only") {
      // 기존 산출물에서 planResult 복원
      planResult = this.restorePlanResultFromArtifacts(artifacts);
    } else {
      planResult = await this.runPlanning(context, state);
      updatedArtifacts = {
        ...updatedArtifacts,
        requirementsPath: planResult.requirementsPath,
        implementationSpecPath: planResult.implementationSpecPath,
        testScenariosPath: planResult.testScenariosPath,
      };
      state.artifacts = updatedArtifacts;
      await this.stateManager.save(state);
    }

    // ── 2. Implementation ──
    this.emitPhaseStart("implementation", cycleNumber, state.workflowId);
    const implStart = performance.now();

    const implResult = await this.codexAgent.implement({
      projectPath,
      implementationSpecPath: planResult.implementationSpecPath,
    });

    const changedFiles = implResult.changedFiles;
    updatedArtifacts.changedFiles = changedFiles;

    state.currentPhase = "implementation";
    state.artifacts = updatedArtifacts;
    await this.stateManager.save(state);

    this.emitPhaseComplete("implementation", cycleNumber, state.workflowId, performance.now() - implStart);

    // ── 3. Commit ──
    const commitSHA = await this.gitManager.commit(
      projectPath,
      cycleNumber,
      implResult.suggestedCommitMessage,
    );

    // ── 4. Review ──
    this.emitPhaseStart("review", cycleNumber, state.workflowId);
    const reviewStart = performance.now();

    const reviewRaw = await this.claudeAgent.review({
      projectPath,
      changedFiles,
      requirementsPath: planResult.requirementsPath,
      testScenariosPath: planResult.testScenariosPath,
    });

    // ── 5. Evaluate ──
    const reviewResult = this.reviewEngine.evaluate(reviewRaw);

    if (reviewResult.status === "CHANGES_REQUESTED") {
      reviewResult.recommendation = this.reviewEngine.recommendReworkScope(reviewResult);
    }

    state.currentPhase = "review";
    state.reviewHistory.push(reviewResult);
    await this.stateManager.save(state);

    this.emitPhaseComplete("review", cycleNumber, state.workflowId, performance.now() - reviewStart);

    const cycleDuration = Math.round(performance.now() - cycleStart);
    this.emitCycleComplete(cycleNumber, state.workflowId, reviewResult, cycleDuration);

    return {
      reviewResult,
      changedFiles,
      artifacts: updatedArtifacts,
      commitSHA,
      duration: cycleDuration,
    };
  }

  /**
   * Plan 단계만 실행 (Planning → 산출물 반환)
   * WorkflowService.executeFromNotionPlanOnly 가 호출.
   */
  async executePlanOnly(
    context: CycleContext,
    state: WorkflowState,
  ): Promise<PlanOnlyResult> {
    const cycleStart = performance.now();
    this.logger.setCycleNumber(context.cycleNumber);

    const planResult = await this.runPlanning(context, state);

    const updatedArtifacts: WorkflowArtifacts = {
      ...context.artifacts,
      requirementsPath: planResult.requirementsPath,
      implementationSpecPath: planResult.implementationSpecPath,
      testScenariosPath: planResult.testScenariosPath,
    };

    state.artifacts = updatedArtifacts;
    await this.stateManager.save(state);

    return {
      planResult,
      artifacts: updatedArtifacts,
      duration: Math.round(performance.now() - cycleStart),
    };
  }

  /**
   * Build 단계만 실행 (Planning 스킵 → Implementation/Commit/Review)
   * 기존 state.artifacts 의 plan 산출물을 재사용한다.
   */
  async executeBuildOnly(context: CycleContext, state: WorkflowState): Promise<CycleResult> {
    return this.executeCycle({ ...context, stage: "build-only" }, state);
  }

  /**
   * Planning 단계 실행 (executeCycle 과 executePlanOnly 가 공유)
   */
  private async runPlanning(
    context: CycleContext,
    state: WorkflowState,
  ): Promise<PlanResult> {
    const { cycleNumber, projectPath, taskDescription } = context;
    this.emitPhaseStart("planning", cycleNumber, state.workflowId);
    const planStart = performance.now();

    const planResult = await this.claudeAgent.plan({
      projectPath,
      taskDescription,
      reworkScope: context.reworkScope,
      previousFeedback: context.previousFeedback
        ? JSON.stringify(context.previousFeedback, null, 2)
        : undefined,
      artifactsDir: `${projectPath}/.ai-workflow/current/artifacts`,
    });

    state.currentPhase = "planning";
    await this.stateManager.save(state);

    this.emitPhaseComplete("planning", cycleNumber, state.workflowId, performance.now() - planStart);
    return planResult;
  }

  /**
   * state.artifacts 에서 PlanResult 복원 (build-only 진입 시)
   * 필수 경로 누락 시 PipelineServiceError 던진다.
   */
  private restorePlanResultFromArtifacts(artifacts: WorkflowArtifacts): PlanResult {
    const { requirementsPath, implementationSpecPath, testScenariosPath } = artifacts;
    if (!requirementsPath || !implementationSpecPath || !testScenariosPath) {
      throw new PipelineServiceError(
        "기획 산출물이 누락되었습니다. 먼저 `devagent plan <pageId>` 를 실행하세요.",
        "recoverable",
        "build-only",
      );
    }
    return {
      requirementsPath,
      implementationSpecPath,
      testScenariosPath,
      summary: "restored from artifacts",
    };
  }

  // ── 이벤트 발행 (에러 격리) ──

  private emitPhaseStart(phase: WorkflowPhase, cycleNumber: number, workflowId: string): void {
    this.logger.setPhase(phase);
    this.safeEmit("phase:start", {
      type: "phase:start",
      phase,
      cycleNumber,
      workflowId,
      timestamp: new Date().toISOString(),
    } satisfies PhaseStartEvent);
  }

  private emitPhaseComplete(
    phase: WorkflowPhase,
    cycleNumber: number,
    workflowId: string,
    duration: number,
  ): void {
    this.safeEmit("phase:complete", {
      type: "phase:complete",
      phase,
      cycleNumber,
      workflowId,
      duration: Math.round(duration),
      timestamp: new Date().toISOString(),
    } satisfies PhaseCompleteEvent);
  }

  private emitCycleComplete(
    cycleNumber: number,
    workflowId: string,
    reviewResult: import("../types/review.js").ReviewResult,
    duration: number,
  ): void {
    this.safeEmit("cycle:complete", {
      type: "cycle:complete",
      cycleNumber,
      workflowId,
      reviewResult,
      duration,
      timestamp: new Date().toISOString(),
    } satisfies CycleCompleteEvent);
  }

  private safeEmit(event: string, data: unknown): void {
    try {
      this.eventEmitter.emit(event, data);
    } catch (error) {
      this.logger.warn(`이벤트 핸들러 에러 (${event}): ${(error as Error).message}`);
    }
  }
}
