/**
 * MonitoringService (S-04) - EventEmitter 기반 워크플로우 모니터링
 * NFR: 이벤트 핸들러 에러 격리, TTY 감지
 */

import { EventEmitter } from "node:events";
import type { Logger } from "../components/logger.js";
import type {
  PhaseStartEvent,
  PhaseCompleteEvent,
  CycleCompleteEvent,
  WorkflowEndEvent,
} from "../types/events.js";
import type { WorkflowPhase } from "../types/workflow.js";

interface PhaseRecord {
  phase: string;
  cycleNumber: number;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

interface CycleRecord {
  cycleNumber: number;
  startedAt: number;
  completedAt: number;
  duration: number;
  reviewStatus: "APPROVED" | "CHANGES_REQUESTED";
  findingsCount: number;
  criticalCount: number;
}

export interface WorkflowReport {
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  status: string;
  totalDuration: number;
  totalCycles: number;
  phases: PhaseRecord[];
  cycles: CycleRecord[];
  prUrl?: string;
  generatedAt: string;
}

export class MonitoringService {
  private workflowId?: string;
  private startedAt?: number;
  private phases: PhaseRecord[] = [];
  private cycles: CycleRecord[] = [];
  private currentPhase?: string;
  private currentCycle?: number;
  private progressTimer?: ReturnType<typeof setInterval>;
  private status?: string;
  private prUrl?: string;
  private projectPath?: string;
  private taskDescription?: string;

  // 바운드 핸들러 (off에서 사용)
  private readonly handlePhaseStart = this.onPhaseStart.bind(this);
  private readonly handlePhaseComplete = this.onPhaseComplete.bind(this);
  private readonly handleCycleComplete = this.onCycleComplete.bind(this);
  private readonly handleWorkflowEnd = this.onWorkflowEnd.bind(this);

  constructor(
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
  ) {}

  /**
   * 모니터링 시작
   */
  start(workflowId: string, projectPath?: string, taskDescription?: string): void {
    this.workflowId = workflowId;
    this.startedAt = Date.now();
    this.phases = [];
    this.cycles = [];
    this.projectPath = projectPath;
    this.taskDescription = taskDescription;

    // 이벤트 구독
    this.eventEmitter.on("phase:start", this.handlePhaseStart);
    this.eventEmitter.on("phase:complete", this.handlePhaseComplete);
    this.eventEmitter.on("cycle:complete", this.handleCycleComplete);
    this.eventEmitter.on("workflow:end", this.handleWorkflowEnd);

    // TTY 모드에서 진행 표시
    if (process.stdout.isTTY) {
      this.startProgressDisplay();
    }
  }

  /**
   * 모니터링 종료
   */
  stop(): void {
    this.stopProgressDisplay();

    this.eventEmitter.off("phase:start", this.handlePhaseStart);
    this.eventEmitter.off("phase:complete", this.handlePhaseComplete);
    this.eventEmitter.off("cycle:complete", this.handleCycleComplete);
    this.eventEmitter.off("workflow:end", this.handleWorkflowEnd);
  }

  /**
   * 리포트 생성
   */
  generateReport(): WorkflowReport | null {
    if (!this.workflowId || !this.startedAt) {
      return null;
    }

    return {
      workflowId: this.workflowId,
      projectPath: this.projectPath ?? "",
      taskDescription: this.taskDescription ?? "",
      status: this.status ?? "unknown",
      totalDuration: Date.now() - this.startedAt,
      totalCycles: this.cycles.length,
      phases: this.phases,
      cycles: this.cycles,
      prUrl: this.prUrl,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 이벤트 핸들러 ──

  private onPhaseStart(event: PhaseStartEvent): void {
    this.currentPhase = event.phase;
    this.currentCycle = event.cycleNumber;
    this.phases.push({
      phase: event.phase,
      cycleNumber: event.cycleNumber,
      startedAt: Date.now(),
    });
  }

  private onPhaseComplete(event: PhaseCompleteEvent): void {
    const record = this.phases[this.phases.length - 1];
    if (record) {
      record.completedAt = Date.now();
      record.duration = event.duration;
    }
  }

  private onCycleComplete(event: CycleCompleteEvent): void {
    const cyclePhases = this.phases.filter((p) => p.cycleNumber === event.cycleNumber);
    const startedAt = cyclePhases[0]?.startedAt ?? Date.now();

    this.cycles.push({
      cycleNumber: event.cycleNumber,
      startedAt,
      completedAt: Date.now(),
      duration: event.duration,
      reviewStatus: event.reviewResult.status,
      findingsCount: event.reviewResult.findings.length,
      criticalCount: event.reviewResult.findings.filter((f) => f.severity === "critical").length,
    });
  }

  private onWorkflowEnd(event: WorkflowEndEvent): void {
    this.status = event.result.status;
    this.prUrl = event.result.prUrl;
    this.stopProgressDisplay();
  }

  // ── 진행 표시 (TTY) ──

  private startProgressDisplay(): void {
    const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
    let frameIndex = 0;

    this.progressTimer = setInterval(() => {
      const spinner = spinnerFrames[frameIndex % spinnerFrames.length];
      frameIndex++;

      const elapsed = this.startedAt ? this.formatDuration(Date.now() - this.startedAt) : "0s";
      const phase = this.currentPhase ?? "initializing";
      const cycle = this.currentCycle ?? 0;

      process.stdout.write(
        `\r${spinner} Phase: ${phase} | Cycle: ${cycle} | Elapsed: ${elapsed}   `,
      );
    }, 80);
  }

  private stopProgressDisplay(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = undefined;
      if (process.stdout.isTTY) {
        process.stdout.write("\r" + " ".repeat(60) + "\r");
      }
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const min = Math.floor(ms / 60_000);
    const sec = Math.round((ms % 60_000) / 1000);
    return `${min}m ${sec}s`;
  }
}
