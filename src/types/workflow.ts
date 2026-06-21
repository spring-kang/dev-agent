/**
 * 워크플로우 상태 및 흐름 관련 타입 정의
 */

import type { WorkflowConfig } from "./config.js";
import type { ReviewResult } from "./review.js";
import type { AppError } from "./errors.js";

// ── 워크플로우 단계 ──

export type WorkflowPhase =
  | "initializing"
  | "planning"
  | "plan_review"
  | "approved"
  | "implementation"
  | "review"
  | "pr_creation"
  | "completed"
  | "failed"
  | "stopped";

export const PHASE_ORDER: WorkflowPhase[] = [
  "initializing",
  "planning",
  "plan_review",
  "approved",
  "implementation",
  "review",
  "pr_creation",
];

export const PHASE_ICONS: Record<WorkflowPhase, string> = {
  initializing: "\u2699\uFE0F",
  planning: "\uD83D\uDCDD",
  plan_review: "\uD83D\uDCCB",
  approved: "\u2714\uFE0F",
  implementation: "\uD83D\uDEE0\uFE0F",
  review: "\uD83D\uDD0D",
  pr_creation: "\uD83D\uDE80",
  completed: "\u2705",
  failed: "\u274C",
  stopped: "\u23F9\uFE0F",
};

export const PHASE_COLORS: Record<WorkflowPhase, string> = {
  initializing: "cyan",
  planning: "blue",
  plan_review: "cyan",
  approved: "green",
  implementation: "yellow",
  review: "magenta",
  pr_creation: "green",
  completed: "green",
  failed: "red",
  stopped: "gray",
};

// ── 워크플로우 산출물 ──

export interface WorkflowArtifacts {
  requirementsPath?: string;
  implementationSpecPath?: string;
  testScenariosPath?: string;
  changedFiles?: string[];
}

// ── 워크플로우 상태 (영속) ──

export interface WorkflowState {
  workflowId: string;
  projectPath: string;
  projectName: string;
  taskDescription: string;
  /** inlineSpec 출처 라벨 (예: notion:<pageId>) - resume 후 외부 후처리 복구용 */
  inlineSpecSource?: string;
  status: "running" | "completed" | "failed" | "stopped";
  currentPhase: WorkflowPhase;
  currentCycle: number;
  maxIterations: number;
  branchName: string;
  artifacts: WorkflowArtifacts;
  reviewHistory: ReviewResult[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  /** Plan 단계 완료 여부 (plan/build 분리 워크플로우용) */
  planningCompleted?: boolean;
  /** Build 진입 시각 (감사용, ISO 8601) */
  planApprovedAt?: string;
}

// ── 워크플로우 요청/결과 ──

export interface WorkflowRequest {
  projectPath: string;
  taskDescription: string;
  config: WorkflowConfig;
  /**
   * Notion task 본문 등 외부 명세를 그대로 Codex에 전달할 때 사용.
   * 값이 있으면 Planning 단계를 스킵하고 inlineSpec을 implementation spec으로 사용.
   */
  inlineSpec?: string;
  /** inlineSpec 출처 라벨 (로그/오류 메시지용, 예: "notion:abc123") */
  inlineSpecSource?: string;
}

export interface WorkflowResult {
  status: "completed" | "failed" | "stopped";
  prUrl?: string;
  totalCycles: number;
  reviewHistory: ReviewResult[];
  duration: number;
  workflowId: string;
  branchName: string;
  error?: AppError;
}

// ── 워크플로우 상태 조회 ──

export interface WorkflowStatus {
  workflowId: string;
  projectPath: string;
  projectName: string;
  taskDescription: string;
  currentPhase: WorkflowPhase;
  currentCycle: number;
  startedAt: string;
  updatedAt: string;
  elapsed: number;
  lastReviewStatus?: "APPROVED" | "CHANGES_REQUESTED";
}

// ── 사이클 ──

export interface CycleContext {
  cycleNumber: number;
  projectPath: string;
  taskDescription: string;
  previousFeedback?: ReviewResult;
  reworkScope?: "partial" | "full";
  artifacts: WorkflowArtifacts;
  config: WorkflowConfig;
  /**
   * Notion task 본문을 그대로 Codex에 전달할 때 사용 (inline implementation spec).
   * 값이 있으면 Planning 스킵.
   */
  inlineSpec?: string;
  inlineSpecSource?: string;
}

export interface CycleResult {
  reviewResult: ReviewResult;
  changedFiles: string[];
  artifacts: WorkflowArtifacts;
  commitSHA: string;
  duration: number;
}

// ── 최대 반복 도달 결정 ──

export type MaxIterationDecision = "create_pr" | "continue" | "stop";

export interface ContinueDecision {
  type: "continue";
  additionalIterations: number;
}

// ── 워크플로우 디렉토리 구조 ──

export const WORKFLOW_DIRS = {
  root: ".ai-workflow",
  current: ".ai-workflow/current",
  archive: ".ai-workflow/archive",
  logs: ".ai-workflow/logs",
  artifacts: ".ai-workflow/current/artifacts",
} as const;

export const STATE_FILE = "state.json" as const;
