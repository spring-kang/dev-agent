/**
 * 리뷰 관련 타입 정의
 */

// ── 리뷰 결과 ──

export interface ReviewResult {
  status: "APPROVED" | "CHANGES_REQUESTED";
  checks: ReviewCheck[];
  findings: ReviewFinding[];
  summary: string;
  recommendation?: "partial" | "full";
}

export interface ReviewCheck {
  name: ReviewCheckName;
  passed: boolean;
  details: string;
}

export type ReviewCheckName =
  | "build"
  | "tests"
  | "security"
  | "design"
  | "codeQuality"
  | "errorHandling"
  | "performance";

export const REVIEW_CHECK_NAMES: ReviewCheckName[] = [
  "build",
  "tests",
  "security",
  "design",
  "codeQuality",
  "errorHandling",
  "performance",
];

export interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "info";
  location: string;
  description: string;
  suggestion: string;
}

// ── 리뷰 원시 출력 ──

export interface ReviewRawOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsedJson?: ReviewJsonOutput;
}

export interface ReviewJsonOutput {
  status?: string;
  checks?: Array<{
    name?: string;
    passed?: boolean;
    details?: string;
  }>;
  findings?: Array<{
    severity?: string;
    location?: string;
    description?: string;
    suggestion?: string;
  }>;
  summary?: string;
}

// ── 판정 키워드 ──

export const APPROVED_KEYWORDS = ["APPROVED", "approve", "all checks passed"] as const;
export const REJECTED_KEYWORDS = [
  "CHANGES_REQUESTED",
  "changes requested",
  "failed",
] as const;

// ── 상수 ──

export const FULL_REWORK_CRITICAL_THRESHOLD = 3;
