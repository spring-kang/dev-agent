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
import type { PhaseStartEvent, PhaseCompleteEvent, CycleCompleteEvent } from "../types/events.js";

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
   * 단일 사이클 실행
   * - inlineSpec 이 있으면 Planning 스킵 → Implementation → Commit → Review
   * - 그 외에는 Planning → Implementation → Commit → Review
   */
  async executeCycle(context: CycleContext, state: WorkflowState): Promise<CycleResult> {
    const cycleStart = performance.now();
    const { cycleNumber, projectPath, artifacts } = context;
    this.logger.setCycleNumber(cycleNumber);

    // inlineSpec 모드: Notion task 본문이 곧 implementation spec → Planning 스킵
    const useInlineSpec = !!(context.inlineSpec && context.inlineSpec.trim().length > 0);

    let planResult: PlanResult | null = null;
    let updatedArtifacts: WorkflowArtifacts = { ...artifacts };

    if (useInlineSpec) {
      this.logger.info(
        `Planning 스킵 (inline spec 사용, source=${context.inlineSpecSource ?? "(unknown)"}, ` +
          `${context.inlineSpec!.length}자)`,
      );
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
      ...(useInlineSpec
        ? {
            inlineSpec: context.inlineSpec!,
            inlineSpecSource: context.inlineSpecSource ?? "(inline)",
          }
        : { implementationSpecPath: planResult!.implementationSpecPath }),
    });

    const changedFiles = implResult.changedFiles;
    updatedArtifacts.changedFiles = changedFiles;

    if (changedFiles.length === 0) {
      this.logger.warn(
        "Codex가 이번 사이클에서 변경한 파일이 없습니다 (무변경). " +
          "동일 입력으로 리뷰가 반복되면 정체(stall)로 감지되어 조기 중단될 수 있습니다.",
      );
    }

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
      ...(planResult?.requirementsPath ? { requirementsPath: planResult.requirementsPath } : {}),
      ...(planResult?.testScenariosPath
        ? { testScenariosPath: planResult.testScenariosPath }
        : {}),
      ...(useInlineSpec && context.inlineSpec
        ? { inlineSpec: context.inlineSpec, inlineSpecSource: context.inlineSpecSource ?? "(inline)" }
        : {}),
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
   * Planning 단계 실행
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
