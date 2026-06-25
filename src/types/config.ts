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
  /**
   * E2E(Playwright) 검증 활성화 여부.
   * - true 이면 리뷰가 APPROVED 된 직후, PR 생성 직전에 e2eCommand 를 실행한다.
   * - 실패 시 PR 생성을 보류하고 합성 CHANGES_REQUESTED 피드백으로 다음 사이클에 되돌린다.
   * - 기본값: false (opt-in → 기존 동작 무변경)
   */
  e2eEnabled: boolean;
  /**
   * E2E 검증 대상 base URL (예: http://localhost:3000).
   * - 실행 시 PLAYWRIGHT_BASE_URL / BASE_URL / E2E_BASE_URL 환경변수로 주입된다.
   * - 비어 있으면 env 주입을 생략(테스트가 자체 URL 을 알고 있다고 가정).
   */
  e2eUrl: string;
  /**
   * E2E 실행 명령. shell 없이 공백 기준 argv 로 분해되어 실행된다(shell:false).
   * - 기본값: "npx playwright test"
   */
  e2eCommand: string;
  /**
   * E2E 실행 타임아웃(ms).
   */
  e2eTimeout: number;
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
  // E2E 검증은 기본 비활성(opt-in). CLI(--e2e/--e2e-url) 또는 설정으로 켠다.
  e2eEnabled: false,
  e2eUrl: "",
  e2eCommand: "npx playwright test",
  e2eTimeout: 300_000,
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
  {
    key: "e2eEnabled",
    validate: (v) => typeof v === "boolean",
    message: "e2eEnabled는 boolean이어야 합니다",
  },
  {
    key: "e2eUrl",
    // 빈 문자열 허용(= env 주입 생략). 비어있지 않으면 http/https URL 만 허용.
    validate: (v) => typeof v === "string" && (v.length === 0 || /^https?:\/\/\S+$/.test(v)),
    message: "e2eUrl은 빈 문자열이거나 http(s):// 로 시작하는 URL이어야 합니다",
  },
  {
    key: "e2eCommand",
    // 비어있지 않은 문자열. 셸 메타문자(파이프/리다이렉트/명령연결)는 금지(shell:false 안전성).
    validate: (v) =>
      typeof v === "string" && v.trim().length > 0 && !/[;&|<>`$(){}]/.test(v),
    message: "e2eCommand는 셸 메타문자 없는 비어있지 않은 명령 문자열이어야 합니다",
  },
  {
    key: "e2eTimeout",
    validate: (v) => typeof v === "number" && v >= 10_000 && v <= 1_800_000,
    message: "e2eTimeout은 10,000~1,800,000ms 사이여야 합니다",
  },
];
