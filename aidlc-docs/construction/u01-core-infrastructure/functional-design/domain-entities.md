# Domain Entities - U-01: Core Infrastructure

## 1. Configuration Domain

### WorkflowConfig (설정 엔티티)

```typescript
interface WorkflowConfig {
  // 프로젝트 워크스페이스
  projectsDir: string;

  // 반복 제어
  maxIterations: number;
  iterationTimeout: number;  // ms

  // Git 설정
  branchPrefix: string;
  baseBranch: string;
  autoCommit: boolean;

  // PR 설정
  prAutoCreate: boolean;
  prIncludeReviewSummary: boolean;

  // 리뷰 기준
  reviewChecks: ReviewChecksConfig;

  // CLI 경로
  claudePath: string;
  codexPath: string;
  ghPath: string;

  // 로깅
  logLevel: LogLevel;
  logDir: string;
}

interface ReviewChecksConfig {
  build: boolean;
  tests: boolean;
  security: boolean;
  design: boolean;
  codeQuality: boolean;
  errorHandling: boolean;
  performance: boolean;
}

type LogLevel = "debug" | "info" | "warn" | "error";
```

### ConfigSource (설정 소스 값 객체)

```typescript
interface ConfigSource {
  type: "default" | "global" | "project" | "env" | "cli";
  path?: string;  // 파일 경로 (global, project)
  values: Partial<WorkflowConfig>;
}
```

### ConfigValidationResult (검증 결과 값 객체)

```typescript
interface ConfigValidationResult {
  valid: boolean;
  criticalErrors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

interface ConfigValidationError {
  field: string;
  message: string;
  value: unknown;
}

interface ConfigValidationWarning {
  field: string;
  message: string;
  value: unknown;
  fallbackValue: unknown;  // 대체될 기본값
}
```

---

## 2. Workspace Domain

### ProjectInfo (프로젝트 정보 엔티티)

```typescript
interface ProjectInfo {
  name: string;          // 디렉토리명
  path: string;          // 절대 경로
  hasGit: boolean;       // .git 존재 여부
  hasRemote: boolean;    // git remote 설정 여부
  hasWorkflowDir: boolean; // .ai-workflow 존재 여부
}
```

### ValidationResult (프로젝트 검증 결과)

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];      // 치명적 문제 (실행 불가)
  warnings: string[];    // 경고 (일부 기능 제한)
}
```

### PrerequisiteResult (도구 가용성 결과)

```typescript
interface PrerequisiteResult {
  claude: ToolAvailability;
  codex: ToolAvailability;
  gh: ToolAvailability;
  git: ToolAvailability;
  allAvailable: boolean;  // 편의 속성: 모든 도구 available
}

interface ToolAvailability {
  available: boolean;
  version?: string;
  path?: string;         // 실제 실행 경로
  error?: string;        // 불가 시 원인
}
```

---

## 3. State Domain

### WorkflowState (워크플로우 상태 엔티티)

```typescript
interface WorkflowState {
  workflowId: string;           // UUID v4
  projectPath: string;          // 대상 프로젝트 절대 경로
  taskDescription: string;      // 원본 작업 요청
  currentPhase: WorkflowPhase;
  currentCycle: number;         // 1부터 시작
  branchName: string;           // 작업 브랜치명
  artifacts: WorkflowArtifacts;
  reviewHistory: ReviewHistoryEntry[];
  config: WorkflowConfig;       // 실행 시 사용된 설정 스냅샷
  startedAt: string;            // ISO 8601
  updatedAt: string;            // ISO 8601
}

type WorkflowPhase = "planning" | "implementation" | "review" | "pr_creation";
```

### WorkflowArtifacts (산출물 경로 값 객체)

```typescript
interface WorkflowArtifacts {
  requirementsPath?: string;     // .ai-workflow/current/requirements.md
  implSpecPath?: string;         // .ai-workflow/current/implementation-spec.md
  testScenariosPath?: string;    // .ai-workflow/current/test-scenarios.md
  changedFiles?: string[];       // 마지막 구현에서 변경된 파일 목록
}
```

### ReviewHistoryEntry (리뷰 히스토리 항목)

```typescript
interface ReviewHistoryEntry {
  cycleNumber: number;
  phase: "review";
  timestamp: string;             // ISO 8601
  status: "APPROVED" | "CHANGES_REQUESTED";
  findingsCount: {
    critical: number;
    major: number;
    minor: number;
    info: number;
  };
  summary: string;
}
```

---

## 4. Logging Domain

### LogEntry (로그 엔트리 값 객체)

```typescript
interface LogEntry {
  timestamp: string;             // ISO 8601 with ms
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  workflowId?: string;           // 병렬 실행 시 구분
}
```

### LoggerConfig (로거 설정 값 객체)

```typescript
interface LoggerConfig {
  level: LogLevel;
  logDir: string;
  colorEnabled: boolean;
  workflowId?: string;          // child logger용
}
```

### ProgressInfo (진행 상태 값 객체)

```typescript
interface ProgressInfo {
  phase: WorkflowPhase;
  cycleNumber: number;
  elapsed: number;               // ms
  status?: "started" | "completed" | "failed";
  detail?: string;               // 추가 정보 (예: "3 findings")
}
```

### WorkflowReport (워크플로우 리포트 엔티티)

```typescript
interface WorkflowReport {
  workflowId: string;
  taskDescription: string;
  finalStatus: "completed" | "failed" | "stopped";
  prUrl?: string;
  totalCycles: number;
  totalDuration: number;         // ms
  cycles: CycleReportEntry[];
  changedFilesCount: number;
  generatedAt: string;           // ISO 8601
}

interface CycleReportEntry {
  cycleNumber: number;
  duration: number;              // ms
  reviewStatus: "APPROVED" | "CHANGES_REQUESTED";
  findingsCount: {
    critical: number;
    major: number;
    minor: number;
    info: number;
  };
  keyChanges: string;            // 주요 변경 요약
}
```

---

## 5. Error Domain

### AppError (애플리케이션 에러 베이스)

```typescript
abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly severity: "critical" | "recoverable";
  readonly timestamp: string;
  readonly context?: Record<string, unknown>;
}
```

### ConfigError (설정 관련 에러)

```typescript
class ConfigError extends AppError {
  readonly code = "CONFIG_ERROR";
  readonly severity = "critical";
  readonly field: string;
  readonly source: ConfigSource["type"];
}
```

### WorkspaceError (워크스페이스 관련 에러)

```typescript
class WorkspaceError extends AppError {
  readonly code = "WORKSPACE_ERROR";
  readonly severity = "critical";
  readonly projectPath: string;
  readonly validationErrors: string[];
}
```

### PrerequisiteError (도구 가용성 에러)

```typescript
class PrerequisiteError extends AppError {
  readonly code = "PREREQUISITE_ERROR";
  readonly severity = "critical";
  readonly missingTools: string[];
  readonly installGuide: string;  // 설치 안내 메시지
}
```

### StateError (상태 관련 에러)

```typescript
class StateError extends AppError {
  readonly code = "STATE_ERROR";
  readonly severity: "critical" | "recoverable";
  readonly operation: "save" | "restore" | "archive";
}
```

---

## 6. Entity Relationships

```
WorkflowConfig
  └── ReviewChecksConfig (composed)

WorkflowState
  ├── WorkflowArtifacts (composed)
  ├── ReviewHistoryEntry[] (composed)
  └── WorkflowConfig (snapshot, composed)

ProjectInfo
  └── (standalone)

ValidationResult
  └── (standalone)

PrerequisiteResult
  └── ToolAvailability[] (composed)

LogEntry
  └── (standalone value object)

WorkflowReport
  └── CycleReportEntry[] (composed)
```

---

## 7. Domain Constants

```typescript
// 로그 레벨 숫자 매핑
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 단계별 아이콘 매핑
const PHASE_ICONS: Record<string, string> = {
  planning: "📋",
  implementation: "🔨",
  review: "🔍",
  approved: "✅",
  rejected: "❌",
  system: "⚙️",
};

// 단계별 컬러 매핑 (chalk 색상명)
const PHASE_COLORS: Record<string, string> = {
  planning: "blue",
  implementation: "yellow",
  review: "magenta",
  approved: "green",
  rejected: "red",
  system: "gray",
};

// 워크플로우 디렉토리 구조
const WORKFLOW_DIRS = {
  root: ".ai-workflow",
  current: ".ai-workflow/current",
  iterations: ".ai-workflow/current/iterations",
  history: ".ai-workflow/history",
  logs: ".ai-workflow/logs",
  config: ".ai-workflow/config.json",
  state: ".ai-workflow/current/state.json",
} as const;

// 글로벌 설정 경로
const GLOBAL_CONFIG_DIR = "~/.dev-agent";
const GLOBAL_CONFIG_PATH = "~/.dev-agent/config.json";

// 환경변수 prefix
const ENV_PREFIX = "DEV_AGENT_";
```
