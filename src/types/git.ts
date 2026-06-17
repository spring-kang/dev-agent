/**
 * Git & PR 관련 타입 정의
 */

import type { ReviewResult } from "./review.js";

export interface PrRequest {
  projectPath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
}

export interface DirtyStateInfo {
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
}

export interface GitInitResult {
  branchName: string;
  hadDirtyState: boolean;
  dirtyFiles?: DirtyStateInfo;
}

export interface FinalizeContext {
  taskDescription: string;
  reviewHistory: ReviewHistoryEntry[];
  totalCycles: number;
  changedFiles: string[];
}

export interface ReviewHistoryEntry {
  cycleNumber: number;
  status: "APPROVED" | "CHANGES_REQUESTED";
  findingsCount: number;
  criticalCount: number;
}

export interface FinalizeResult {
  /** PR URL. push/PR 단계가 스킵된 경우 null. */
  prUrl: string | null;
  branchName: string;
  /** push/PR 단계가 스킵되었는지 여부 (remote 미설정 등). */
  skipped?: boolean;
  /** 스킵 사유 (예: "no-remote"). */
  skipReason?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── 상수 ──

export const MAX_SLUG_LENGTH = 50;
export const MIN_SLUG_LENGTH = 3;
export const FALLBACK_SLUG = "auto-task";
export const SLUG_PATTERN = /[^a-z0-9-]/g;

export const GIT_COMMAND_TIMEOUT = 30_000;
export const GIT_NETWORK_TIMEOUT = 60_000;

export const COMMIT_PREFIX = "ai-cycle";
export const DEFAULT_COMMIT_MESSAGE = "Auto-generated code changes";
export const REWORK_COMMIT_MESSAGE = "Rework based on review feedback";

export const PR_TITLE_PREFIX = "[AI]";
/** GitHub PR 제목 최대 길이 (GraphQL 제약). 초과 시 truncate. */
export const MAX_PR_TITLE_LENGTH = 256;
export const PR_AI_NOTICE = `> 이 PR은 AI 에이전트(dev-agent)에 의해 자동 생성되었습니다.
> - Planning: Claude Code
> - Implementation: Codex
> - Review: Claude Code`;
