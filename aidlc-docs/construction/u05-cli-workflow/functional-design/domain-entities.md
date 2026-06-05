# Domain Entities - U-05: CLI & Workflow

## 1. CLI Types

### RunOptions (run 커맨드 옵션)

```typescript
interface RunOptions {
  project: string;           // 프로젝트 경로 (필수)
  task: string;              // 작업 설명 (positional argument)
  maxIterations?: number;    // --max-iterations 오버라이드
  parallel?: string[];       // --parallel: 추가 프로젝트 경로들
  config?: string;           // --config: 설정 파일 경로 오버라이드
  verbose?: boolean;         // --verbose: 상세 로그 출력
}
```

### StatusOptions (status 커맨드 옵션)

```typescript
interface StatusOptions {
  project?: string;          // 특정 프로젝트 (없으면 전체)
  json?: boolean;            // --json: JSON 형식 출력
}
```

### ResumeOptions (resume 커맨드 옵션)

```typescript
interface ResumeOptions {
  project: string;           // 프로젝트 경로 (필수)
  verbose?: boolean;         // --verbose: 상세 로그 출력
}
```

### ReportOptions (report 커맨드 옵션)

```typescript
interface ReportOptions {
  project: string;           // 프로젝트 경로 (필수)
  format?: "text" | "json";  // 출력 형식 (기본: text)
  output?: string;           // 파일 출력 경로 (없으면 stdout)
}
```

### ConfigOptions (config 커맨드 옵션)

```typescript
interface ConfigOptions {
  action: "show" | "set" | "get";
  key?: string;              // get/set 시 설정 키
  value?: string;            // set 시 값
}
```

### ParallelRunOptions (병렬 실행 옵션)

```typescript
interface ParallelRunOptions {
  projects: string[];        // 프로젝트 경로 목록
  task: string;              // 공통 작업 설명
  maxIterations?: number;    // 공통 maxIterations
  config?: string;           // 공통 설정 파일 경로
}
```

---

## 2. CLI Output Types

### CliOutput (CLI 출력 결과)

```typescript
interface CliOutput {
  success: boolean;
  message: string;
  data?: unknown;            // JSON 출력 시 사용
  exitCode: number;          // 0=성공, 1=에러, 2=사용 오류
}
```

### ProgressDisplay (진행 상황 표시)

```typescript
interface ProgressDisplay {
  phase: WorkflowPhase;
  cycleNumber: number;
  totalCycles: number;       // maxIterations
  elapsed: number;           // ms
  status: "running" | "waiting" | "completed" | "failed";
}
```

### WorkflowSummary (워크플로우 완료 요약)

```typescript
interface WorkflowSummary {
  status: "completed" | "failed" | "stopped";
  prUrl?: string;
  totalCycles: number;
  duration: number;          // ms
  reviewPassedAt?: number;   // 몇 번째 사이클에서 통과했는지
}
```

---

## 3. WorkflowService Types

### ServiceRequest (서비스 요청 - CLI에서 변환됨)

```typescript
interface ServiceRequest {
  type: "run" | "resume" | "parallel";
  workflowRequest?: WorkflowRequest;        // run
  parallelRequests?: WorkflowRequest[];     // parallel
  resumeProjectPath?: string;               // resume
}
```

### PreflightResult (사전 검증 결과)

```typescript
interface PreflightResult {
  valid: boolean;
  config: WorkflowConfig;
  projectInfo: ProjectInfo;
  warnings: string[];        // 경고 사항 (dirty state 등)
  errors: string[];          // 차단 사항
}
```

---

## 4. MonitoringService Types

### MonitoringState (모니터링 내부 상태)

```typescript
interface MonitoringState {
  workflowId: string;
  startedAt: number;         // Date.now()
  phases: PhaseRecord[];
  cycles: CycleRecord[];
  currentPhase?: WorkflowPhase;
  currentCycle?: number;
}
```

### PhaseRecord (단계 기록)

```typescript
interface PhaseRecord {
  phase: WorkflowPhase;
  cycleNumber: number;
  startedAt: number;
  completedAt?: number;
  duration?: number;         // ms
}
```

### CycleRecord (사이클 기록)

```typescript
interface CycleRecord {
  cycleNumber: number;
  startedAt: number;
  completedAt: number;
  duration: number;          // ms
  reviewStatus: "APPROVED" | "CHANGES_REQUESTED";
  findingsCount: number;
  criticalCount: number;
}
```

### WorkflowReport (워크플로우 리포트)

```typescript
interface WorkflowReport {
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  status: "completed" | "failed" | "stopped";
  totalDuration: number;     // ms
  totalCycles: number;
  phases: PhaseRecord[];
  cycles: CycleRecord[];
  finalReviewResult?: ReviewResult;
  prUrl?: string;
  generatedAt: string;       // ISO timestamp
}
```

---

## 5. Error Types

### CliError (CLI 오류)

```typescript
class CliError extends AppError {
  readonly code = "CLI_ERROR";
  readonly severity = "recoverable";
  readonly command: string;           // 실행된 서브커맨드
  readonly exitCode: number;          // 반환할 종료 코드
}
```

### CliValidationError (CLI 입력 검증 오류)

```typescript
class CliValidationError extends CliError {
  readonly code = "CLI_VALIDATION_ERROR";
  readonly exitCode = 2;              // 사용법 오류
  readonly invalidArgs: string[];     // 잘못된 인자들
}
```

### WorkflowServiceError (서비스 오류)

```typescript
class WorkflowServiceError extends AppError {
  readonly code = "WORKFLOW_SERVICE_ERROR";
  readonly severity: "critical" | "recoverable";
  readonly phase?: string;            // 실패한 단계
}
```

### PreflightError (사전 검증 실패)

```typescript
class PreflightError extends WorkflowServiceError {
  readonly code = "PREFLIGHT_ERROR";
  readonly severity = "critical";     // 실행 불가
  readonly failedChecks: string[];    // 실패한 검증 항목
}
```

---

## 6. Constants

```typescript
// CLI 서브커맨드
const CLI_COMMANDS = ["run", "status", "resume", "list", "config", "report"] as const;
type CliCommand = typeof CLI_COMMANDS[number];

// 종료 코드
const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE_ERROR = 2;

// 진행 상황 표시
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;          // ms

// 시간 형식
const DURATION_FORMAT_THRESHOLD = 60_000;  // 60초 이상이면 분:초 형식

// 병렬 실행
const MAX_PARALLEL_WORKFLOWS = 5;     // 최대 동시 실행 수

// 모니터링
const PROGRESS_UPDATE_INTERVAL = 1000; // 1초마다 진행 표시 갱신
const REPORT_MAX_FINDINGS = 20;        // 리포트에 표시할 최대 findings 수

// CLI 텍스트
const CLI_NAME = "dev-agent";
const CLI_VERSION = "1.0.0";
const CLI_DESCRIPTION = "AI-powered development pipeline orchestrator";

// 완료 메시지 템플릿
const COMPLETION_MESSAGES = {
  approved: "✅ 워크플로우 완료! PR이 생성되었습니다.",
  stopped: "⏹️  워크플로우가 중단되었습니다. 'dev-agent resume'로 재시작 가능합니다.",
  failed: "❌ 워크플로우 실패.",
  maxIterations: "⚠️  최대 반복 횟수에 도달했습니다.",
} as const;
```

---

## 7. Entity Relationships

```
CLI (C-01 - Presentation Layer)
  ├── parseCommand(argv) → CliCommand + Options
  ├── handleRun(RunOptions) → WorkflowSummary
  │     └── WorkflowService.execute()
  ├── handleResume(ResumeOptions) → WorkflowSummary
  │     └── WorkflowService.resume()
  ├── handleStatus(StatusOptions) → WorkflowStatus[]
  │     └── Orchestrator.getStatus() (via WorkflowService)
  ├── handleList() → ProjectInfo[]
  │     └── WorkspaceManager.listProjects()
  ├── handleConfig(ConfigOptions) → void
  │     └── ConfigManager (직접)
  └── handleReport(ReportOptions) → WorkflowReport
        └── MonitoringService.generateReport()

WorkflowService (S-01 - Application Layer / Facade)
  ├── execute(WorkflowRequest) → WorkflowResult
  │     ├── preflight() → PreflightResult
  │     │     ├── ConfigManager.load()
  │     │     └── WorkspaceManager.validateProject()
  │     ├── MonitoringService.start()
  │     ├── Orchestrator.execute() → WorkflowResult
  │     └── MonitoringService.stop()
  ├── executeParallel(WorkflowRequest[]) → WorkflowResult[]
  │     └── Orchestrator.executeParallel()
  └── resume(projectPath) → WorkflowResult
        └── Orchestrator.resume()

MonitoringService (S-04 - Application Layer / Observer)
  ├── start(workflowId) → void
  ├── onPhaseStart(event) → void (이벤트 핸들러)
  ├── onPhaseComplete(event) → void (이벤트 핸들러)
  ├── onCycleComplete(event) → void (이벤트 핸들러)
  ├── onWorkflowEnd(event) → void (이벤트 핸들러)
  ├── stop() → void
  └── generateReport() → WorkflowReport
```
