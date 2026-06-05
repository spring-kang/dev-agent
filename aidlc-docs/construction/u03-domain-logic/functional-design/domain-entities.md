# Domain Entities - U-03: Domain Logic

## 1. Review Domain

### ReviewResult (리뷰 결과 - 핵심 도메인 엔티티)

```typescript
interface ReviewResult {
  status: "APPROVED" | "CHANGES_REQUESTED";
  checks: ReviewCheck[];
  findings: ReviewFinding[];
  summary: string;
  recommendation?: "partial" | "full";  // ReviewEngine이 추가
}
```

### ReviewCheck (리뷰 체크 항목)

```typescript
interface ReviewCheck {
  name: ReviewCheckName;
  passed: boolean;
  details: string;
}

type ReviewCheckName =
  | "build"
  | "tests"
  | "security"
  | "design"
  | "codeQuality"
  | "errorHandling"
  | "performance";
```

### ReviewFinding (리뷰 발견 사항)

```typescript
interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "info";
  location: string;      // 파일:라인
  description: string;
  suggestion: string;
}
```

---

## 2. Workflow Domain

### WorkflowRequest (워크플로우 요청)

```typescript
interface WorkflowRequest {
  projectPath: string;
  taskDescription: string;
  config: WorkflowConfig;
}
```

### WorkflowResult (워크플로우 결과)

```typescript
interface WorkflowResult {
  status: "completed" | "failed" | "stopped";
  prUrl?: string;
  totalCycles: number;
  reviewHistory: ReviewResult[];
  duration: number;          // ms
  workflowId: string;
  branchName: string;
  error?: AppError;          // failed 시 에러 정보
}
```

### WorkflowStatus (워크플로우 상태 조회용)

```typescript
interface WorkflowStatus {
  workflowId: string;
  projectPath: string;
  projectName: string;
  taskDescription: string;
  currentPhase: WorkflowPhase;
  currentCycle: number;
  startedAt: string;
  updatedAt: string;
  elapsed: number;           // ms
  lastReviewStatus?: "APPROVED" | "CHANGES_REQUESTED";
}
```

---

## 3. Cycle Domain

### CycleContext (사이클 컨텍스트)

```typescript
interface CycleContext {
  cycleNumber: number;           // 1부터 시작
  projectPath: string;
  taskDescription: string;
  previousFeedback?: ReviewResult;
  reworkScope?: "partial" | "full";
  artifacts: WorkflowArtifacts;
  config: WorkflowConfig;
}
```

### CycleResult (사이클 결과)

```typescript
interface CycleResult {
  reviewResult: ReviewResult;
  changedFiles: string[];
  artifacts: WorkflowArtifacts;  // 업데이트된 산출물 경로
  commitSHA: string;
  duration: number;              // ms
}
```

### MaxIterationDecision (최대 반복 도달 시 사용자 결정)

```typescript
type MaxIterationDecision = "create_pr" | "continue" | "stop";

interface ContinueDecision {
  type: "continue";
  additionalIterations: number;  // 추가 허용 횟수
}
```

---

## 4. Event Types

### WorkflowEvent (이벤트 타입 정의)

```typescript
type WorkflowEventType =
  | "workflow:start"
  | "workflow:end"
  | "phase:start"
  | "phase:complete"
  | "cycle:complete";

interface WorkflowStartEvent {
  type: "workflow:start";
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  timestamp: string;
}

interface WorkflowEndEvent {
  type: "workflow:end";
  workflowId: string;
  result: WorkflowResult;
  timestamp: string;
}

interface PhaseStartEvent {
  type: "phase:start";
  phase: WorkflowPhase;
  cycleNumber: number;
  workflowId: string;
  timestamp: string;
}

interface PhaseCompleteEvent {
  type: "phase:complete";
  phase: WorkflowPhase;
  cycleNumber: number;
  workflowId: string;
  duration: number;
  timestamp: string;
}

interface CycleCompleteEvent {
  type: "cycle:complete";
  cycleNumber: number;
  workflowId: string;
  reviewResult: ReviewResult;
  duration: number;
  timestamp: string;
}
```

---

## 5. Error Types

### OrchestratorError

```typescript
class OrchestratorError extends AppError {
  readonly code = "ORCHESTRATOR_ERROR";
  readonly severity: "critical" | "recoverable";
  readonly workflowId: string;
  readonly phase?: WorkflowPhase;
  readonly cycleNumber?: number;
}
```

### ParallelConflictError

```typescript
class ParallelConflictError extends AppError {
  readonly code = "PARALLEL_CONFLICT";
  readonly severity = "critical";
  readonly conflictingPaths: string[];
}
```

### ReviewParseError

```typescript
class ReviewParseError extends AppError {
  readonly code = "REVIEW_PARSE_ERROR";
  readonly severity = "recoverable";
  readonly rawOutput: string;     // 파싱 실패한 원본 (첫 500자)
  readonly parseAttempts: string[]; // 시도한 파싱 방법들
}
```

---

## 6. Constants

```typescript
// 리뷰 판정
const REVIEW_CHECK_NAMES: ReviewCheckName[] = [
  "build", "tests", "security", "design",
  "codeQuality", "errorHandling", "performance"
];

// 재작업 추천 임계값
const FULL_REWORK_CRITICAL_THRESHOLD = 3;

// 이벤트
const WORKFLOW_EVENTS: WorkflowEventType[] = [
  "workflow:start", "workflow:end",
  "phase:start", "phase:complete",
  "cycle:complete"
];

// 텍스트 파싱 키워드
const APPROVED_KEYWORDS = ["APPROVED", "approve", "all checks passed"];
const REJECTED_KEYWORDS = ["CHANGES_REQUESTED", "changes requested", "failed"];
```

---

## 7. Entity Relationships

```
WorkflowRequest
  └── WorkflowConfig (from U-01)

Orchestrator.execute()
  ├── creates → WorkflowState (U-01 StateManager)
  ├── calls → GitService.initWorkflow() (U-04)
  ├── loops → PipelineService.executeCycle()
  │     ├── calls → ClaudeAgent.plan() (U-02) → PlanResult
  │     ├── calls → CodexAgent.implement() (U-02) → ImplementResult
  │     ├── calls → GitManager.commit() (U-04) → SHA
  │     ├── calls → ClaudeAgent.review() (U-02) → ReviewRawOutput
  │     └── calls → ReviewEngine.evaluate() → ReviewResult
  ├── calls → GitService.finalize() (U-04) → PR URL
  └── returns → WorkflowResult

ReviewEngine (순수 로직, 외부 의존 없음)
  ├── evaluate(ReviewRawOutput) → ReviewResult
  └── recommendReworkScope(ReviewResult) → "partial" | "full"
```
