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
import { E2eVerifier } from "../components/e2e-verifier.js";
import type { ReviewResult } from "../types/review.js";
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
import { StallDetector } from "./stall-detector.js";
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
    /** E2E 검증기 (선택). 주입되고 config.e2eEnabled=true 일 때만 PR 직전 게이트로 동작 */
    private readonly e2eVerifier?: E2eVerifier,
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
      ...(request.inlineSpecSource ? { inlineSpecSource: request.inlineSpecSource } : {}),
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
      ...(state.inlineSpecSource ? { inlineSpecSource: state.inlineSpecSource } : {}),
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
    const stallDetector = new StallDetector();

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
        // E2E(Playwright) 검증 게이트 (opt-in): 통과해야 PR 을 생성한다.
        const e2eFeedback = await this.runE2eGate(request, state);
        if (e2eFeedback) {
          // 검증 실패 → CHANGES_REQUESTED 로 되돌려 다음 사이클에 Codex 가 수정하도록 한다.
          state.reviewHistory.push(e2eFeedback);
          await this.stateManager.save(state);
          previousFeedback = e2eFeedback;
          reworkScope = e2eFeedback.recommendation;

          // 동일 e2e 실패가 반복되면 stall 감지로 사용자에게 조기 위임.
          const stalled = stallDetector.record(cycleResult.changedFiles.length, e2eFeedback);
          if (stalled) {
            const stallResult = await this.handleStallDetected(
              request,
              state,
              start,
              stallDetector.count,
            );
            if (stallResult) {
              return stallResult;
            }
            stallDetector.reset();
          }

          cycleNumber++;
          continue;
        }

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

      // 무진척(정체) 감지: Codex 무변경 또는 직전과 동일 피드백이 연속되면
      // maxIterations 까지 의미 없이 소모하지 않고 사용자에게 조기 결정을 위임한다.
      const stalled = stallDetector.record(
        cycleResult.changedFiles.length,
        cycleResult.reviewResult,
      );
      if (stalled) {
        const stallResult = await this.handleStallDetected(
          request,
          state,
          start,
          stallDetector.count,
        );
        if (stallResult) {
          return stallResult;
        }
        // 사용자가 '계속 진행'을 선택 → 정체 카운터 리셋 후 루프 지속
        stallDetector.reset();
      }

      cycleNumber++;
    }

    // 최대 반복 도달
    return this.handleMaxIterationsReached(request, state, start);
  }

  /**
   * E2E 검증 게이트.
   * - e2eEnabled=false 또는 verifier 미주입이면 즉시 통과(null).
   * - 통과 시 null, 실패(또는 실행 오류) 시 CHANGES_REQUESTED 합성 피드백 반환.
   */
  private async runE2eGate(
    request: WorkflowRequest,
    state: WorkflowState,
  ): Promise<ReviewResult | null> {
    if (!request.config.e2eEnabled || !this.e2eVerifier) {
      return null;
    }

    const url = request.config.e2eUrl;
    this.logger.info(`E2E 검증 게이트 실행 (cycle=${state.currentCycle})`);
    this.safeEmit("e2e:start", {
      type: "e2e:start",
      workflowId: state.workflowId,
      url,
      command: request.config.e2eCommand,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.e2eVerifier.verify({
        projectPath: request.projectPath,
        url,
        command: request.config.e2eCommand,
        timeout: request.config.e2eTimeout,
      });

      // PR 본문 표기를 위해 통과/실패 무관하게 마지막 실행 요약을 상태에 보관한다.
      state.e2e = {
        passed: result.passed,
        durationMs: result.duration,
        command: request.config.e2eCommand,
        url,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };

      this.safeEmit("e2e:complete", {
        type: "e2e:complete",
        workflowId: state.workflowId,
        passed: result.passed,
        timestamp: new Date().toISOString(),
      });

      if (result.passed) {
        return null;
      }
      return E2eVerifier.buildFeedbackFromFailure(result, url);
    } catch (error) {
      // 실행 자체 실패(명령 미존재 등) → 게이트 실패로 처리(PR 보류).
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`E2E 검증 실행 오류: ${message}`);
      state.e2e = {
        passed: false,
        durationMs: 0,
        command: request.config.e2eCommand,
        url,
        exitCode: null,
        timedOut: false,
      };
      this.safeEmit("e2e:complete", {
        type: "e2e:complete",
        workflowId: state.workflowId,
        passed: false,
        timestamp: new Date().toISOString(),
      });
      return {
        status: "CHANGES_REQUESTED",
        checks: [{ name: "tests", passed: false, details: `E2E 실행 오류: ${message}` }],
        findings: [
          {
            severity: "critical",
            location: url || "(e2e)",
            description: `E2E 검증을 실행하지 못했습니다: ${message}`,
            suggestion:
              "e2eCommand/e2eUrl 설정과 테스트 러너(예: playwright) 설치 상태를 확인하세요.",
          },
        ],
        summary: "E2E 실행 오류로 PR 생성을 보류합니다.",
        recommendation: "partial",
      };
    }
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

    const decision = await this.promptUserDecision([
      `\u26A0\uFE0F  최대 반복 횟수(${request.config.maxIterations}회)에 도달했습니다.`,
      `현재까지 ${state.currentCycle}회 사이클 수행, 마지막 리뷰: CHANGES_REQUESTED`,
    ]);

    switch (decision) {
      case "create_pr":
        return this.finalizeAndComplete(request, state, startTime, "최대 반복 도달");

      case "continue": {
        // 추가 반복 (기본 3회)
        const additionalIterations = 3;
        request.config.maxIterations += additionalIterations;
        state.maxIterations = request.config.maxIterations;
        this.logger.info(`추가 ${additionalIterations}회 반복 허용 (총 ${request.config.maxIterations}회)`);
        return this.runCycleLoop(request, state);
      }

      case "stop":
      default:
        return this.stopWorkflow(state, startTime);
    }
  }

  /**
   * 무진척(정체) 감지 처리 (사용자 선택)
   * @returns 사용자가 'PR 생성' 또는 '중단'을 선택하면 종료 결과, '계속 진행'을 선택하면 null
   */
  private async handleStallDetected(
    request: WorkflowRequest,
    state: WorkflowState,
    startTime: number,
    noProgressCount: number,
  ): Promise<WorkflowResult | null> {
    this.logger.warn(
      `무진척 사이클이 ${noProgressCount}회 연속 감지되었습니다 ` +
        `(Codex 무변경 또는 직전과 동일한 리뷰 피드백). ` +
        `동일 결과가 반복될 가능성이 높아 조기 결정을 제안합니다.`,
    );

    const decision = await this.promptUserDecision([
      `\u26A0\uFE0F  진척 없는 사이클이 ${noProgressCount}회 연속 감지되었습니다.`,
      "Codex가 변경을 만들지 못했거나 직전과 동일한 리뷰 피드백이 반복되고 있습니다.",
      `현재까지 ${state.currentCycle}회 사이클 수행, 마지막 리뷰: CHANGES_REQUESTED`,
    ], { continueLabel: "정체 무시하고 계속 진행" });

    switch (decision) {
      case "create_pr":
        return this.finalizeAndComplete(request, state, startTime, "정체 감지");

      case "continue":
        // 루프 계속 진행 (호출부에서 정체 카운터 리셋)
        return null;

      case "stop":
      default:
        return this.stopWorkflow(state, startTime);
    }
  }

  /**
   * 미통과 상태로 PR 생성 후 워크플로우 완료 처리
   */
  private async finalizeAndComplete(
    request: WorkflowRequest,
    state: WorkflowState,
    startTime: number,
    reasonLabel: string,
  ): Promise<WorkflowResult> {
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
        `${reasonLabel} 후 로컬 완료 (push/PR 스킵 사유=${finalizeResult.skipReason}). ` +
          `브랜치: ${state.branchName}`,
      );
    } else {
      this.logger.info(`${reasonLabel} 후 PR 생성: ${finalizeResult.prUrl}`);
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

  /**
   * 워크플로우 중단 처리
   */
  private async stopWorkflow(
    state: WorkflowState,
    startTime: number,
  ): Promise<WorkflowResult> {
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

  private async promptUserDecision(
    headerLines: string[],
    options?: { continueLabel?: string },
  ): Promise<MaxIterationDecision> {
    const continueLabel = options?.continueLabel ?? "추가 반복 (3회)";

    const envDecision = process.env.DEVAGENT_NON_INTERACTIVE_DECISION?.trim();
    const isNonInteractive = !process.stdin.isTTY || !process.stdout.isTTY || process.env.CI === "1";
    const forcedDecision = envDecision === "create_pr" || envDecision === "continue" || envDecision === "stop"
      ? envDecision
      : undefined;

    if (isNonInteractive) {
      const autoDecision: MaxIterationDecision = forcedDecision ?? "create_pr";
      this.logger.warn(
        `비대화형 실행 감지: 사용자 입력 대신 자동 결정(${autoDecision})을 적용합니다.`,
      );
      for (const line of headerLines) {
        this.logger.warn(line);
      }
      return autoDecision;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      console.log("");
      for (const line of headerLines) {
        console.log(line);
      }
      console.log("");
      console.log("선택해주세요:");
      console.log("  1) 현재 상태로 PR 생성");
      console.log(`  2) ${continueLabel}`);
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
      ...(state.e2e ? { e2e: state.e2e } : {}),
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
