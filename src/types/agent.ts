/**
 * 에이전트 관련 타입 정의
 */

// ── Planning ──

export interface PlanRequest {
  projectPath: string;
  taskDescription: string;
  reworkScope?: "partial" | "full";
  previousFeedback?: string;
  artifactsDir: string;
}

export interface PlanResult {
  requirementsPath: string;
  implementationSpecPath: string;
  testScenariosPath: string;
  summary: string;
}

// ── Implementation ──

export interface ImplementRequest {
  projectPath: string;
  implementationSpecPath: string;
}

export interface ImplementResult {
  changedFiles: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  /**
   * 구현 명세에서 추출한 비즈니스 커밋 메시지 권장값.
   * - 명세에 "정확한 비즈니스 커밋 메시지" 등이 명시되어 있으면 그 값을 그대로 사용.
   * - 추출 실패 시 undefined (기본 자동 메시지 사용).
   */
  suggestedCommitMessage?: string;
}

// ── Review ──

export interface ReviewRequest {
  projectPath: string;
  changedFiles: string[];
  requirementsPath?: string;
  testScenariosPath?: string;
}

// ── Process 관리 ──

export interface SpawnOptions {
  cwd: string;
  timeout: number;
  env?: Record<string, string>;
  maxOutputSize?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// ── 프롬프트 ──

export interface PromptDelivery {
  method: "inline" | "file";
  content?: string;
  filePath?: string;
}

// ── 인터페이스 (에이전트 교체 가능성) ──

export interface PlanningAgent {
  plan(request: PlanRequest): Promise<PlanResult>;
}

export interface ImplementationAgent {
  implement(request: ImplementRequest): Promise<ImplementResult>;
}

export interface ReviewAgent {
  review(request: ReviewRequest): Promise<import("../types/review.js").ReviewRawOutput>;
}

// ── 상수 ──

export const PROMPT_FILE_THRESHOLD = 100_000; // 100KB
export const MAX_STDOUT_CAPTURE = 10_000;

export const ARTIFACT_FILES = {
  requirements: "requirements.md",
  implementationSpec: "implementation-spec.md",
  testScenarios: "test-scenarios.md",
} as const;

export const JSON_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/;
export const JSON_OBJECT_PATTERN = /\{[\s\S]*"status"\s*:\s*[\s\S]*\}/;
