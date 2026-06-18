/**
 * 워크플로우 설정 타입 정의
 */

export interface WorkflowConfig {
  maxIterations: number;
  branchPrefix: string;
  logLevel: LogLevel;
  claudeTimeout: number;
  codexTimeout: number;
  prIncludeReviewSummary: boolean;
  autoCommit: boolean;
  /**
   * Claude CLI 리뷰 시 사용할 모델 식별자.
   * - 예: "claude-sonnet-4-5-20250929" (권장 - Sonnet은 리뷰 품질 대비 비용 효율적)
   * - 비어 있으면 claude CLI 기본 모델 사용
   * - claude CLI에 --model <id> 인자로 전달됨
   */
  reviewModel: string;
  /**
   * 작업 브랜치의 기준(base) 브랜치명.
   * - 브랜치 생성 전 origin에서 이 브랜치를 fetch/checkout/pull(--ff-only)로 동기화한다.
   * - PR 생성 시 base 브랜치로도 사용된다.
   * - 기본값: "main" (저장소에 따라 "master" 등으로 변경 가능)
   */
  baseBranch: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_CONFIG: Readonly<WorkflowConfig> = {
  maxIterations: 10,
  branchPrefix: "ai",
  logLevel: "info",
  claudeTimeout: 300_000,
  codexTimeout: 600_000,
  prIncludeReviewSummary: true,
  autoCommit: true,
  // 기획은 사용자가 직접 claude로 진행 → 리뷰는 비용/품질 균형이 좋은 Sonnet으로 고정 기본값.
  reviewModel: "claude-sonnet-4-5-20250929",
  baseBranch: "main",
};

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof WorkflowConfig)[];

/**
 * 설정 값의 출처를 추적하는 타입
 */
export type ConfigSource = "default" | "global" | "project" | "env" | "cli";

export interface ConfigWithSource {
  value: WorkflowConfig;
  sources: Record<keyof WorkflowConfig, ConfigSource>;
}

/**
 * 프로젝트 검증 결과
 */
export interface ProjectInfo {
  projectPath: string;
  projectName: string;
  hasGit: boolean;
  hasPackageJson: boolean;
}

export interface ValidationResult {
  valid: boolean;
  projectInfo?: ProjectInfo;
  errors: string[];
  warnings: string[];
}

export interface PrerequisiteResult {
  allPassed: boolean;
  checks: PrerequisiteCheck[];
}

export interface PrerequisiteCheck {
  tool: string;
  required: boolean;
  found: boolean;
  version?: string;
  path?: string;
}

/**
 * 설정 검증 규칙
 */
export interface ConfigValidationRule {
  key: keyof WorkflowConfig;
  validate: (value: unknown) => boolean;
  message: string;
}

export const CONFIG_VALIDATION_RULES: ConfigValidationRule[] = [
  {
    key: "maxIterations",
    validate: (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20,
    message: "maxIterations는 1~20 사이의 정수여야 합니다",
  },
  {
    key: "logLevel",
    validate: (v) => typeof v === "string" && ["debug", "info", "warn", "error"].includes(v),
    message: "logLevel은 debug, info, warn, error 중 하나여야 합니다",
  },
  {
    key: "claudeTimeout",
    validate: (v) => typeof v === "number" && v >= 30_000 && v <= 900_000,
    message: "claudeTimeout은 30,000~900,000ms 사이여야 합니다",
  },
  {
    key: "codexTimeout",
    validate: (v) => typeof v === "number" && v >= 60_000 && v <= 1_800_000,
    message: "codexTimeout은 60,000~1,800,000ms 사이여야 합니다",
  },
  {
    key: "branchPrefix",
    validate: (v) => typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v) && v.length <= 20,
    message: "branchPrefix는 소문자 영문으로 시작하는 20자 이내 문자열이어야 합니다",
  },
  {
    key: "prIncludeReviewSummary",
    validate: (v) => typeof v === "boolean",
    message: "prIncludeReviewSummary는 boolean이어야 합니다",
  },
  {
    key: "autoCommit",
    validate: (v) => typeof v === "boolean",
    message: "autoCommit은 boolean이어야 합니다",
  },
  {
    key: "reviewModel",
    // 빈 문자열 허용 (= claude CLI 기본 모델 사용)
    // 비어있지 않으면 영문/숫자/하이픈/점 조합만 허용 (CLI 인자 안전성)
    validate: (v) => typeof v === "string" && (v.length === 0 || /^[a-zA-Z0-9.\-]+$/.test(v)),
    message: "reviewModel은 영문/숫자/하이픈/점만 사용 가능하거나 빈 문자열이어야 합니다",
  },
  {
    key: "baseBranch",
    // git 브랜치명 안전 문자만 허용 (영문/숫자/점/하이픈/슬래시/언더스코어), 비어있지 않아야 함
    validate: (v) =>
      typeof v === "string" && v.length > 0 && v.length <= 100 && /^[A-Za-z0-9._/\-]+$/.test(v),
    message: "baseBranch는 비어있지 않은 git 브랜치명(영문/숫자/./-/_// )이어야 합니다",
  },
];
