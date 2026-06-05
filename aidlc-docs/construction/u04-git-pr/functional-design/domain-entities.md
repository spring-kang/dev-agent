# Domain Entities - U-04: Git & PR

## 1. Git Request/Response Types

### PrRequest (PR 생성 요청)

```typescript
interface PrRequest {
  projectPath: string;    // 대상 프로젝트 절대 경로
  branchName: string;     // 소스 브랜치
  baseBranch: string;     // 타겟 브랜치 (예: "main")
  title: string;          // PR 제목
  body: string;           // PR 본문 (Markdown)
}
```

### DirtyStateInfo (워킹 트리 상태)

```typescript
interface DirtyStateInfo {
  isDirty: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
}
```

### GitInitResult (워크플로우 Git 초기화 결과)

```typescript
interface GitInitResult {
  branchName: string;        // 생성된 브랜치명
  hadDirtyState: boolean;    // dirty state 감지 여부
  dirtyFiles?: DirtyStateInfo; // dirty 파일 정보
}
```

### FinalizeContext (PR 생성 컨텍스트)

```typescript
interface FinalizeContext {
  taskDescription: string;
  reviewHistory: ReviewHistoryEntry[];
  totalCycles: number;
  changedFiles: string[];
}
```

### FinalizeResult (완료 결과)

```typescript
interface FinalizeResult {
  prUrl: string;             // 생성된 PR URL
  branchName: string;        // 브랜치명
}
```

---

## 2. Internal Types

### ExecResult (Git 명령 실행 결과)

```typescript
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### BranchInfo (브랜치 정보)

```typescript
interface BranchInfo {
  name: string;
  current: boolean;
  remote?: string;
}
```

---

## 3. Error Types

### GitError (Git 에러 베이스)

```typescript
class GitError extends AppError {
  readonly code = "GIT_ERROR";
  readonly severity: "critical" | "recoverable";
  readonly command: string;       // 실행한 git 명령
  readonly stderr: string;        // git stderr 출력
  readonly cwd: string;           // 작업 디렉토리
}
```

### GitTimeoutError (Git 타임아웃)

```typescript
class GitTimeoutError extends GitError {
  readonly code = "GIT_TIMEOUT";
  readonly severity = "recoverable";
  readonly timeout: number;
}
```

### GitPushError (Push 실패)

```typescript
class GitPushError extends GitError {
  readonly code = "GIT_PUSH_ERROR";
  readonly severity = "recoverable";
  readonly branchName: string;
  readonly remoteUrl?: string;
}
```

### GitPrError (PR 생성 실패)

```typescript
class GitPrError extends GitError {
  readonly code = "GIT_PR_ERROR";
  readonly severity = "recoverable";
  readonly existingPrUrl?: string;  // 중복 PR이 원인인 경우
}
```

---

## 4. Constants

```typescript
// 브랜치명 관련
const MAX_SLUG_LENGTH = 50;
const MIN_SLUG_LENGTH = 3;
const FALLBACK_SLUG = "auto-task";
const SLUG_PATTERN = /[^a-z0-9-]/g;

// 타임아웃
const GIT_COMMAND_TIMEOUT = 30_000;    // 30초 (일반 git 명령)
const GIT_NETWORK_TIMEOUT = 60_000;    // 60초 (push, pr create)

// 커밋 메시지
const COMMIT_PREFIX = "ai-cycle";
const DEFAULT_COMMIT_MESSAGE = "Auto-generated code changes";
const REWORK_COMMIT_MESSAGE = "Rework based on review feedback";

// PR
const PR_TITLE_PREFIX = "[AI]";
const PR_AI_NOTICE = `> 이 PR은 AI 에이전트(dev-agent)에 의해 자동 생성되었습니다.
> - Planning: Claude Code
> - Implementation: Codex
> - Review: Claude Code`;

// Git status 파싱
const STATUS_UNTRACKED = "??";
const STATUS_MODIFIED = ["M", " M", "MM", "A", "AM", "D"];
```

---

## 5. Entity Relationships

```
GitManager (Infrastructure)
  ├── createBranch() → string (branchName)
  ├── commit() → string (SHA)
  ├── createPullRequest(PrRequest) → string (PR URL)
  ├── push() → void
  └── checkDirtyState() → DirtyStateInfo

GitService (Domain)
  ├── initWorkflow() → GitInitResult
  │     └── uses GitManager.checkDirtyState + createBranch
  └── finalize(FinalizeContext) → FinalizeResult
        └── uses GitManager.push + createPullRequest
        └── builds PR body from FinalizeContext
```
