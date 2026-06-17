/**
 * Orchestrator (C-02) - 워크플로우 실행 제어
 * BR-05: 최대 반복 도달 시 사용자 선택 요청
 * BR-07: 병렬 실행 시 프로젝트 경로 충돌 방지
 */

import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";
import * as readline from "node:readline";
import type { PipelineService } from "../services/pipeline.service.js";
import type { GitService } from "../services/git.service.js";
import type { StateManager } from "../components/state-manager.js";
import type { ReviewEngine } from "../components/review-engine.js";
import type { Logger } from "../components/logger.js";
import type {
  WorkflowRequest,
  WorkflowResult,
  WorkflowState,
  WorkflowStatus,
  CycleContext,
  MaxIterationDecision,
} from "../types/workflow.js";
import { WORKFLOW_DIRS } from "../types/workflow.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { ReviewHistoryEntry } from "../types/git.js";
import {
  OrchestratorError,
  ParallelConflictError,
} from "../types/errors.js";

export class Orchestrator {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly gitService: GitService,
    private readonly stateManager: StateManager,
    private readonly reviewEngine: ReviewEngine,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
  ) {}

  /**
   * 워크플로우 실행
   */
  async execute(request: WorkflowRequest): Promise<WorkflowResult> {
    const workflowId = crypto.randomUUID();
    const start = performance.now();

    this.logger.setWorkflowId(workflowId);
    this.logger.info(`워크플로우 시작: ${request.taskDescription}`);

    // 이벤트 발행
    this.safeEmit("workflow:start", {
      type: "workflow:start",
      workflowId,
      projectPath: request.projectPath,
      taskDescription: request.taskDescription,
      timestamp: new Date().toISOString(),
    });

    // 초기 상태 생성
    const state: WorkflowState = {
      workflowId,
      projectPath: request.projectPath,
      projectName: request.projectPath.split("/").pop() ?? "unknown",
      taskDescription: request.taskDescription,
      status: "running",
      currentPhase: "initializing",
      currentCycle: 0,
      maxIterations: request.config.maxIterations,
      branchName: "",
      artifacts: {},
      reviewHistory: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.stateManager.save(state);

    try {
      // Git 초기화
      const gitInit = await this.gitService.initWorkflow(
        request.projectPath,
        request.taskDescription,
        request.config.branchPrefix,
        request.config.baseBranch,
      );
      state.branchName = gitInit.branchName;
      await this.stateManager.save(state);

      // 사이클 루프
      const result = await this.runCycleLoop(request, state);

      // 워크플로우 종료 이벤트
      this.safeEmit("workflow:end", {
        type: "workflow:end",
        workflowId,
        result,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      state.status = "failed";
      state.error = (error as Error).message;
      await this.stateManager.save(state);

      const duration = Math.round(performance.now() - start);

      const result: WorkflowResult = {
        status: "failed",
        totalCycles: state.currentCycle,
        reviewHistory: state.reviewHistory,
        duration,
        workflowId,
        branchName: state.branchName,
        error: error as import("../types/errors.js").AppError,
      };

      this.safeEmit("workflow:end", {
        type: "workflow:end",
        workflowId,
        result,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  }

  /**
   * 워크플로우 재시작
   */
  async resume(projectPath: string): Promise<WorkflowResult> {
    const state = await this.stateManager.restore(projectPath);
    if (!state) {
      throw new OrchestratorError("복구할 워크플로우가 없습니다", "unknown", "critical");
    }

    if (state.status === "completed") {
      throw new OrchestratorError(
        "이미 완료된 워크플로우입니다",
        state.workflowId,
        "recoverable",
      );
    }

    this.logger.setWorkflowId(state.workflowId);
    this.logger.info(`워크플로우 재시작: ${state.taskDescription} (사이클 ${state.currentCycle}부터)`);

    state.status = "running";
    await this.stateManager.save(state);

    const request: WorkflowRequest = {
      projectPath: state.projectPath,
      taskDescription: state.taskDescription,
      config: {
        ...DEFAULT_CONFIG,
        maxIterations: state.maxIterations,
      },
    };

    return this.runCycleLoop(request, state);
  }

  /**
   * 병렬 워크플로우 실행
   */
  async executeParallel(requests: WorkflowRequest[]): Promise<WorkflowResult[]> {
    // 경로 중복 검증
    const paths = requests.map((r) => r.projectPath);
    const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i);
    if (duplicates.length > 0) {
      throw new ParallelConflictError([...new Set(duplicates)]);
    }

    this.logger.info(`병렬 워크플로우 시작: ${requests.length}개 프로젝트`);

    // Promise.allSettled로 독립 실행
    const results = await Promise.allSettled(
      requests.map((r) => {
        const childLogger = this.logger.createChildLogger(crypto.randomUUID());
        return this.execute(r);
      }),
    );

    return results.map((r, i) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        status: "failed" as const,
        totalCycles: 0,
        reviewHistory: [],
        duration: 0,
        workflowId: "unknown",
        branchName: "",
        error: r.reason as import("../types/errors.js").AppError,
      };
    });
  }

  /**
   * 워크플로우 상태 조회
   */
  async getStatus(projectPath?: string): Promise<WorkflowStatus[]> {
    if (projectPath) {
      const state = await this.stateManager.restore(projectPath);
      if (!state) return [];

      return [this.stateToStatus(state)];
    }

    // 전체 프로젝트 스캔은 WorkflowService에서 처리
    return [];
  }

  // ── 사이클 루프 ──

  private async runCycleLoop(
    request: WorkflowRequest,
    state: WorkflowState,
  ): Promise<WorkflowResult> {
    const start = performance.now();
    let cycleNumber = state.currentCycle > 0 ? state.currentCycle : 1;
    let previousFeedback = state.reviewHistory.length > 0
      ? state.reviewHistory[state.reviewHistory.length - 1]
      : undefined;
    let reworkScope: "partial" | "full" | undefined;

    while (cycleNumber <= request.config.maxIterations) {
      state.currentCycle = cycleNumber;
      await this.stateManager.save(state);

      const context: CycleContext = {
        cycleNumber,
        projectPath: request.projectPath,
        taskDescription: request.taskDescription,
        previousFeedback,
        reworkScope,
        artifacts: state.artifacts,
        config: request.config,
        ...(request.inlineSpec ? { inlineSpec: request.inlineSpec } : {}),
        ...(request.inlineSpecSource ? { inlineSpecSource: request.inlineSpecSource } : {}),
      };

      const cycleResult = await this.pipelineService.executeCycle(context, state);

      // 산출물 업데이트
      state.artifacts = cycleResult.artifacts;

      if (cycleResult.reviewResult.status === "APPROVED") {
        // PR 생성
        state.currentPhase = "pr_creation";
        await this.stateManager.save(state);

        const finalizeResult = await this.gitService.finalize(
          request.projectPath,
          state.branchName,
          request.config.baseBranch,
          this.buildFinalizeContext(state),
          request.config.prIncludeReviewSummary,
        );

        // 완료
        state.status = "completed";
        state.currentPhase = "completed";
        state.completedAt = new Date().toISOString();
        await this.stateManager.save(state);

        // 아카이브
        await this.stateManager.archive(request.projectPath, state.workflowId);

        const duration = Math.round(performance.now() - start);
        if (finalizeResult.skipped) {
          this.logger.info(
            `워크플로우 완료 (로컬 only, push/PR 스킵 사유=${finalizeResult.skipReason}). ` +
              `브랜치: ${state.branchName}`,
          );
        } else {
          this.logger.info(`워크플로우 완료! PR: ${finalizeResult.prUrl}`);
        }

        return {
          status: "completed",
          prUrl: finalizeResult.prUrl ?? undefined,
          totalCycles: cycleNumber,
          reviewHistory: state.reviewHistory,
          duration,
          workflowId: state.workflowId,
          branchName: state.branchName,
        };
      }

      // CHANGES_REQUESTED → 다음 사이클 준비
      previousFeedback = cycleResult.reviewResult;
      reworkScope = cycleResult.reviewResult.recommendation;
      cycleNumber++;
    }

    // 최대 반복 도달
    return this.handleMaxIterationsReached(request, state, start);
  }

  /**
   * 최대 반복 도달 처리 (사용자 선택)
   */
  private async handleMaxIterationsReached(
    request: WorkflowRequest,
    state: WorkflowState,
    startTime: number,
  ): Promise<WorkflowResult> {
    this.logger.warn(
      `최대 반복 횟수(${request.config.maxIterations}회)에 도달했습니다.`,
    );

    const decision = await this.promptUserDecision(request.config.maxIterations, state.currentCycle);

    switch (decision) {
      case "create_pr": {
        // 미통과 상태로 PR 생성
        state.currentPhase = "pr_creation";
        await this.stateManager.save(state);

        const context = this.buildFinalizeContext(state);
        const finalizeResult = await this.gitService.finalize(
          request.projectPath,
          state.branchName,
          request.config.baseBranch,
          context,
          request.config.prIncludeReviewSummary,
        );

        state.status = "completed";
        state.currentPhase = "completed";
        state.completedAt = new Date().toISOString();
        await this.stateManager.save(state);
        await this.stateManager.archive(request.projectPath, state.workflowId);

        if (finalizeResult.skipped) {
          this.logger.info(
            `최대 반복 도달 후 로컬 완료 (push/PR 스킵 사유=${finalizeResult.skipReason}). ` +
              `브랜치: ${state.branchName}`,
          );
        }

        return {
          status: "completed",
          prUrl: finalizeResult.prUrl ?? undefined,
          totalCycles: state.currentCycle,
          reviewHistory: state.reviewHistory,
          duration: Math.round(performance.now() - startTime),
          workflowId: state.workflowId,
          branchName: state.branchName,
        };
      }

      case "continue": {
        // 추가 반복 (기본 3회)
        const additionalIterations = 3;
        request.config.maxIterations += additionalIterations;
        state.maxIterations = request.config.maxIterations;
        this.logger.info(`추가 ${additionalIterations}회 반복 허용 (총 ${request.config.maxIterations}회)`);
        return this.runCycleLoop(request, state);
      }

      case "stop":
      default: {
        state.status = "stopped";
        state.currentPhase = "stopped";
        await this.stateManager.save(state);

        return {
          status: "stopped",
          totalCycles: state.currentCycle,
          reviewHistory: state.reviewHistory,
          duration: Math.round(performance.now() - startTime),
          workflowId: state.workflowId,
          branchName: state.branchName,
        };
      }
    }
  }

  private async promptUserDecision(
    maxIterations: number,
    currentCycle: number,
  ): Promise<MaxIterationDecision> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      console.log("");
      console.log(`\u26A0\uFE0F  최대 반복 횟수(${maxIterations}회)에 도달했습니다.`);
      console.log(`현재까지 ${currentCycle}회 사이클 수행, 마지막 리뷰: CHANGES_REQUESTED`);
      console.log("");
      console.log("선택해주세요:");
      console.log("  1) 현재 상태로 PR 생성");
      console.log("  2) 추가 반복 (3회)");
      console.log("  3) 워크플로우 중단");
      console.log("");

      rl.question("선택 (1/2/3): ", (answer) => {
        rl.close();
        switch (answer.trim()) {
          case "1":
            resolve("create_pr");
            break;
          case "2":
            resolve("continue");
            break;
          case "3":
          default:
            resolve("stop");
            break;
        }
      });
    });
  }

  private buildFinalizeContext(state: WorkflowState): import("../types/git.js").FinalizeContext {
    return {
      taskDescription: state.taskDescription,
      reviewHistory: state.reviewHistory.map((r, i): ReviewHistoryEntry => ({
        cycleNumber: i + 1,
        status: r.status,
        findingsCount: r.findings.length,
        criticalCount: r.findings.filter((f) => f.severity === "critical").length,
      })),
      totalCycles: state.currentCycle,
      changedFiles: state.artifacts.changedFiles ?? [],
    };
  }

  private stateToStatus(state: WorkflowState): WorkflowStatus {
    const now = Date.now();
    const startedAt = new Date(state.startedAt).getTime();

    return {
      workflowId: state.workflowId,
      projectPath: state.projectPath,
      projectName: state.projectName,
      taskDescription: state.taskDescription,
      currentPhase: state.currentPhase,
      currentCycle: state.currentCycle,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      elapsed: now - startedAt,
      lastReviewStatus: state.reviewHistory.length > 0
        ? state.reviewHistory[state.reviewHistory.length - 1]?.status
        : undefined,
    };
  }

  private safeEmit(event: string, data: unknown): void {
    try {
      this.eventEmitter.emit(event, data);
    } catch (error) {
      this.logger.warn(`이벤트 핸들러 에러 (${event}): ${(error as Error).message}`);
    }
  }
}
