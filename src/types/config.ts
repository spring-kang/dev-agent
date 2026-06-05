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
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_CONFIG: Readonly<WorkflowConfig> = {
  maxIterations: 5,
  branchPrefix: "ai",
  logLevel: "info",
  claudeTimeout: 300_000,
  codexTimeout: 600_000,
  prIncludeReviewSummary: true,
  autoCommit: true,
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
];
