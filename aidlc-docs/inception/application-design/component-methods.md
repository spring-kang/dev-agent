# Component Methods

> **Note**: 상세 비즈니스 로직은 Functional Design (CONSTRUCTION phase)에서 정의. 여기서는 메서드 시그니처와 고수준 목적만 정의.

---

## C-01: CLI

```typescript
// 진입점
main(argv: string[]): Promise<void>

// 서브커맨드 핸들러
handleRun(options: RunOptions): Promise<void>
handleStatus(options: StatusOptions): Promise<void>
handleResume(options: ResumeOptions): Promise<void>
handleList(): Promise<void>
handleConfig(action: "show" | "set", key?: string, value?: string): Promise<void>
handleReport(workflowId: string): Promise<void>
```

**Types**:
```typescript
interface RunOptions {
  project: string;       // 프로젝트 경로
  task: string;          // 작업 설명
  maxIterations?: number;
  verbose?: boolean;
}

interface ResumeOptions {
  project: string;
}

interface StatusOptions {
  all?: boolean;         // 모든 실행 중인 워크플로우
}
```

---

## C-02: Orchestrator

```typescript
// 워크플로우 실행
execute(request: WorkflowRequest): Promise<WorkflowResult>

// 워크플로우 재시작
resume(projectPath: string): Promise<WorkflowResult>

// 단일 사이클 실행 (Planning -> Implementation -> Review)
executeCycle(context: CycleContext): Promise<CycleResult>

// 반복 횟수 초과 시 사용자 선택 처리
handleMaxIterationsReached(context: CycleContext): Promise<MaxIterationDecision>

// 병렬 워크플로우 실행
executeParallel(requests: WorkflowRequest[]): Promise<WorkflowResult[]>

// 실행 중인 워크플로우 상태 조회
getStatus(projectPath?: string): Promise<WorkflowStatus[]>
```

**Types**:
```typescript
interface WorkflowRequest {
  projectPath: string;
  taskDescription: string;
  config: WorkflowConfig;
}

interface WorkflowResult {
  status: "completed" | "failed" | "stopped";
  prUrl?: string;
  totalCycles: number;
  reviewHistory: ReviewResult[];
  duration: number;
}

interface CycleContext {
  cycleNumber: number;
  projectPath: string;
  previousFeedback?: ReviewResult;
  artifacts: WorkflowArtifacts;
}

interface CycleResult {
  reviewResult: ReviewResult;
  changedFiles: string[];
  artifacts: WorkflowArtifacts;
}

type MaxIterationDecision = "create_pr" | "continue" | "stop";
```

---

## C-03: ClaudeAgent

```typescript
// 기획 산출물 생성
plan(request: PlanRequest): Promise<PlanResult>

// 코드 리뷰 수행
review(request: ReviewRequest): Promise<ReviewRawOutput>

// CLI 프로세스 생성 및 실행
spawn(args: string[], options: SpawnOptions): Promise<ProcessResult>
```

**Types**:
```typescript
interface PlanRequest {
  taskDescription: string;
  cwd: string;
  previousFeedback?: ReviewResult;
  reworkScope: "partial" | "full";
}

interface PlanResult {
  requirements: string;          // requirements.md 경로
  implementationSpec: string;    // implementation-spec.md 경로
  testScenarios: string;         // test-scenarios.md 경로
}

interface ReviewRequest {
  cwd: string;
  changedFiles: string[];
  requirementsPath: string;
  testScenariosPath: string;
}
```

---

## C-04: CodexAgent

```typescript
// 코드 생성
implement(request: ImplementRequest): Promise<ImplementResult>

// CLI 프로세스 생성 및 실행
spawn(args: string[], options: SpawnOptions): Promise<ProcessResult>
```

**Types**:
```typescript
interface ImplementRequest {
  implementationSpecPath: string;
  cwd: string;
  timeout: number;
}

interface ImplementResult {
  changedFiles: string[];
  stdout: string;
  exitCode: number;
}
```

---

## C-05: ReviewEngine

```typescript
// 리뷰 결과 파싱 및 판정
evaluate(rawOutput: ReviewRawOutput): ReviewResult

// 재작업 범위 추천
recommendReworkScope(result: ReviewResult): "partial" | "full"
```

**Types**:
```typescript
interface ReviewResult {
  status: "APPROVED" | "CHANGES_REQUESTED";
  checks: ReviewCheck[];
  findings: ReviewFinding[];
  summary: string;
  recommendation?: "partial" | "full";
}

interface ReviewCheck {
  name: string;          // build, tests, security, design, codeQuality, errorHandling, performance
  passed: boolean;
  details: string;
}

interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "info";
  location: string;     // 파일:라인
  description: string;
  suggestion: string;
}
```

---

## C-06: GitManager

```typescript
// 작업 브랜치 생성
createBranch(projectPath: string, taskSummary: string): Promise<string>

// 변경사항 커밋
commit(projectPath: string, cycleNumber: number, message?: string): Promise<string>

// PR 생성
createPullRequest(request: PrRequest): Promise<string>

// 브랜치 push
push(projectPath: string, branchName: string): Promise<void>

// working tree 상태 확인
checkDirtyState(projectPath: string): Promise<DirtyStateInfo>
```

**Types**:
```typescript
interface PrRequest {
  projectPath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;        // 작업 요약, 리뷰 히스토리, AI 표시 포함
}

interface DirtyStateInfo {
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
}
```

---

## C-07: ConfigManager

```typescript
// 설정 로드 및 병합
load(projectPath: string, cliOptions?: Partial<WorkflowConfig>): WorkflowConfig

// 현재 설정 표시
show(projectPath?: string): WorkflowConfig

// 설정 값 변경
set(key: string, value: string, scope: "global" | "project"): void

// 기본 설정 생성
initDefault(projectPath: string): void
```

---

## C-08: StateManager

```typescript
// 상태 저장
save(projectPath: string, state: WorkflowState): Promise<void>

// 상태 복원
restore(projectPath: string): Promise<WorkflowState | null>

// 히스토리 아카이브
archive(projectPath: string, state: WorkflowState): Promise<void>

// SIGINT/SIGTERM 핸들러 등록
registerShutdownHandler(projectPath: string): void
```

**Types**:
```typescript
interface WorkflowState {
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  currentPhase: "planning" | "implementation" | "review" | "pr_creation";
  currentCycle: number;
  branchName: string;
  artifacts: WorkflowArtifacts;
  reviewHistory: ReviewResult[];
  startedAt: string;        // ISO timestamp
  updatedAt: string;
}

interface WorkflowArtifacts {
  requirementsPath?: string;
  implSpecPath?: string;
  testScenariosPath?: string;
  changedFiles?: string[];
}
```

---

## C-09: Logger

```typescript
// 로그 출력
debug(message: string, context?: Record<string, unknown>): void
info(message: string, context?: Record<string, unknown>): void
warn(message: string, context?: Record<string, unknown>): void
error(message: string, context?: Record<string, unknown>): void

// 워크플로우 진행 상태 출력
progress(phase: string, cycleNumber: number, elapsed: number): void

// 리포트 생성
generateReport(result: WorkflowResult): Promise<string>

// 워크플로우별 로거 생성 (병렬 실행용)
createChildLogger(workflowId: string): Logger
```

---

## C-10: WorkspaceManager

```typescript
// 프로젝트 목록 조회
listProjects(projectsDir: string): Promise<ProjectInfo[]>

// 프로젝트 검증
validateProject(projectPath: string): Promise<ValidationResult>

// .ai-workflow 초기화
initWorkflowDir(projectPath: string): Promise<void>

// CLI 도구 가용성 검증
checkPrerequisites(): Promise<PrerequisiteResult>
```

**Types**:
```typescript
interface ProjectInfo {
  name: string;
  path: string;
  hasGit: boolean;
  hasRemote: boolean;
  hasWorkflowDir: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface PrerequisiteResult {
  claude: { available: boolean; version?: string };
  codex: { available: boolean; version?: string };
  gh: { available: boolean; version?: string };
  git: { available: boolean; version?: string };
}
```
