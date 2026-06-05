# Domain Entities - U-02: Agent Integration

## 1. Agent Request/Response Types

### PlanRequest (기획 요청)

```typescript
interface PlanRequest {
  taskDescription: string;         // 원본 작업 설명
  cwd: string;                     // 대상 프로젝트 절대 경로
  previousFeedback?: ReviewResult; // 이전 리뷰 피드백 (재기획 시)
  reworkScope: "partial" | "full"; // 재기획 범위
}
```

### PlanResult (기획 결과)

```typescript
interface PlanResult {
  requirements: string;          // requirements.md 절대 경로
  implementationSpec: string;    // implementation-spec.md 절대 경로
  testScenarios: string;         // test-scenarios.md 절대 경로
  stdout: string;                // Claude CLI stdout 전체
  duration: number;              // ms
}
```

### ImplementRequest (구현 요청)

```typescript
interface ImplementRequest {
  implementationSpecPath: string;  // implementation-spec.md 절대 경로
  cwd: string;                     // 대상 프로젝트 절대 경로
  timeout: number;                 // ms
}
```

### ImplementResult (구현 결과)

```typescript
interface ImplementResult {
  changedFiles: string[];          // 변경된 파일 상대 경로 목록
  stdout: string;                  // Codex CLI stdout 전체
  exitCode: number;                // 프로세스 종료 코드
  duration: number;                // ms
}
```

### ReviewRequest (리뷰 요청)

```typescript
interface ReviewRequest {
  cwd: string;                     // 대상 프로젝트 절대 경로
  changedFiles: string[];          // 리뷰 대상 파일 목록
  requirementsPath: string;        // requirements.md 경로
  testScenariosPath: string;       // test-scenarios.md 경로
}
```

### ReviewRawOutput (리뷰 원문 출력)

```typescript
interface ReviewRawOutput {
  stdout: string;                  // Claude CLI stdout 전체
  parsedJson?: ReviewJsonOutput;   // JSON 파싱 성공 시
  parseError?: string;             // JSON 파싱 실패 시 원인
  duration: number;                // ms
}

// Claude가 출력하는 JSON 구조 (기대 형식)
interface ReviewJsonOutput {
  status: "APPROVED" | "CHANGES_REQUESTED";
  checks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
  findings: Array<{
    severity: "critical" | "major" | "minor" | "info";
    location: string;
    description: string;
    suggestion: string;
  }>;
  summary: string;
}
```

---

## 2. Process Management Types

### SpawnOptions (프로세스 생성 옵션)

```typescript
interface SpawnOptions {
  cwd: string;                     // 작업 디렉토리
  timeout: number;                 // ms
  env?: NodeJS.ProcessEnv;         // 환경변수 (기본: process.env 상속)
}
```

### ProcessResult (프로세스 실행 결과)

```typescript
interface ProcessResult {
  stdout: string;                  // 전체 stdout
  stderr: string;                  // 전체 stderr
  exitCode: number;                // 종료 코드 (0=성공)
  signal?: string;                 // 시그널로 종료된 경우 (SIGTERM, SIGKILL)
  duration: number;                // ms
  timedOut: boolean;               // 타임아웃 발생 여부
}
```

---

## 3. Error Types

### AgentError (에이전트 에러 베이스)

```typescript
abstract class AgentError extends AppError {
  readonly agentType: "claude" | "codex";
  readonly operation: "plan" | "implement" | "review";
  readonly processResult?: Partial<ProcessResult>;  // 가용한 프로세스 정보
}
```

### AgentTimeoutError (타임아웃)

```typescript
class AgentTimeoutError extends AgentError {
  readonly code = "AGENT_TIMEOUT";
  readonly severity = "recoverable";
  readonly timeout: number;        // 설정된 타임아웃 (ms)
  readonly elapsed: number;        // 실제 경과 시간 (ms)
}
```

### AgentProcessError (프로세스 에러)

```typescript
class AgentProcessError extends AgentError {
  readonly code = "AGENT_PROCESS_ERROR";
  readonly severity = "recoverable";
  readonly exitCode: number;
  readonly stderrTail: string;     // stderr 마지막 500자
}
```

### AgentOutputError (산출물 에러)

```typescript
class AgentOutputError extends AgentError {
  readonly code = "AGENT_OUTPUT_ERROR";
  readonly severity = "recoverable";
  readonly missingFiles?: string[];    // 누락된 파일 목록
  readonly invalidFiles?: string[];    // 유효하지 않은 파일 목록
  readonly parseError?: string;        // JSON 파싱 에러
}
```

---

## 4. Prompt Templates (프롬프트 관련 타입)

### PromptTemplate (프롬프트 구성 정보)

```typescript
interface PromptTemplate {
  type: "initial_plan" | "partial_rework" | "full_rework" | "review" | "implement";
  variables: Record<string, string>;  // 템플릿 변수
}
```

### PromptDelivery (프롬프트 전달 방식)

```typescript
interface PromptDelivery {
  method: "argument" | "file";     // 직접 인자 vs 파일 참조
  content: string;                 // 실제 프롬프트 내용
  filePath?: string;               // file 방식일 때 임시 파일 경로
}
```

---

## 5. Constants

```typescript
// 프롬프트 파일 참조 임계값
const PROMPT_FILE_THRESHOLD = 100 * 1024; // 100KB

// 타임아웃 관련
const SIGTERM_GRACE_PERIOD = 5000;  // SIGTERM 후 SIGKILL까지 대기 (ms)

// 산출물 검증
const MIN_ARTIFACT_LENGTH = 10;     // 산출물 최소 길이 (자)
const ARTIFACT_FILES = [
  "requirements.md",
  "implementation-spec.md",
  "test-scenarios.md",
] as const;

// stdout 패턴 매칭 (info 레벨 승격)
const STDOUT_PATTERNS = {
  fileWrite: /Writing file:\s*(.+)/,
  error: /Error:\s*(.+)/,
  warning: /Warning:\s*(.+)/,
} as const;

// JSON 추출 패턴
const JSON_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/;
const JSON_STATUS_PATTERN = /\{\s*"status"\s*:/;

// 변경 파일 수집 제외 패턴
const CHANGED_FILES_EXCLUDE = [
  ".ai-workflow/",
  ".git/",
  "node_modules/",
] as const;

// 임시 프롬프트 파일 경로
const PROMPT_TMP_FILENAME = ".prompt-tmp";
```

---

## 6. Entity Relationships

```
PlanRequest
  └── ReviewResult? (previousFeedback, from U-03)

PlanResult
  └── (standalone, feeds into ImplementRequest)

ImplementRequest
  └── (uses PlanResult.implementationSpec path)

ImplementResult
  └── (feeds into ReviewRequest.changedFiles)

ReviewRequest
  └── (uses PlanResult paths + ImplementResult.changedFiles)

ReviewRawOutput
  └── ReviewJsonOutput? (parsed)
  └── (feeds into U-03 ReviewEngine)

ProcessResult
  └── (internal, wraps child_process result)

AgentError hierarchy:
  AgentError (abstract)
    ├── AgentTimeoutError
    ├── AgentProcessError
    └── AgentOutputError
```
