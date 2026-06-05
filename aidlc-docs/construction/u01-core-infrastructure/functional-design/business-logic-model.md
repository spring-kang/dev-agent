# Business Logic Model - U-01: Core Infrastructure

## 1. Logger (C-09)

### 1.1 로그 레벨 처리

```
LogLevel 우선순위: debug < info < warn < error

설정된 logLevel 이상의 메시지만 출력:
- logLevel="debug" → debug, info, warn, error 모두 출력
- logLevel="info"  → info, warn, error 출력 (debug 무시)
- logLevel="warn"  → warn, error 출력
- logLevel="error" → error만 출력
```

**로그 엔트리 구조:**
```typescript
interface LogEntry {
  timestamp: string;     // ISO 8601 (2026-06-01T14:32:05.123+09:00)
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  workflowId?: string;  // 병렬 실행 시 구분용
}
```

### 1.2 터미널 출력 포맷 (컬러 + 아이콘)

**단계별 아이콘/컬러 매핑:**
```
📋 Planning    → blue
🔨 Implement   → yellow
🔍 Review      → magenta
✅ Approved    → green
❌ Rejected    → red
⚙️ System      → gray
```

**진행 상태 출력 형식:**
```
🔵 Planning ▸ Cycle 1 ▸ 00:45 elapsed
🟡 Implement ▸ Cycle 1 ▸ 02:13 elapsed
🟣 Review ▸ Cycle 1 ▸ 03:45 elapsed
❌ Changes Requested ▸ 3 findings (1 critical, 2 major)
🔵 Planning ▸ Cycle 2 ▸ 04:10 elapsed (rework: partial)
...
✅ Approved ▸ Cycle 3 ▸ Total: 12:30
```

**로그 레벨별 출력 포맷:**
```
[DEBUG] [14:32:05] Loading config from ~/.dev-agent/config.json  (gray, dimmed)
[INFO]  [14:32:05] Workflow started: "로그인 기능 추가"           (white)
[WARN]  [14:32:05] Dirty working tree detected                   (yellow)
[ERROR] [14:32:05] Claude CLI process exited with code 1         (red, bold)
```

**--no-color 모드:**
- 환경변수 `NO_COLOR=1` 또는 CLI 옵션 `--no-color` 시 모든 ANSI 색상 코드 제거
- CI/CD 환경 자동 감지 (`CI=true` 또는 stdout이 TTY가 아닌 경우)

### 1.3 파일 로깅 규칙

**파일 경로:** `<projectPath>/.ai-workflow/logs/workflow-<workflowId>.log`

**파일 포맷:** JSON Lines (각 줄이 독립된 JSON 객체)
```json
{"timestamp":"2026-06-01T14:32:05.123+09:00","level":"info","message":"Workflow started","context":{"task":"로그인 기능 추가","project":"/path/to/project"}}
{"timestamp":"2026-06-01T14:32:06.456+09:00","level":"debug","message":"Config loaded","context":{"source":"project","path":".ai-workflow/config.json"}}
```

**규칙:**
- 파일 로그는 항상 `debug` 레벨로 기록 (터미널 출력 레벨과 무관)
- 보존 정책 없음 (히스토리 아카이브에 의해 관리)
- 파일 쓰기 실패 시 터미널에 경고만 출력, 워크플로우 중단하지 않음

### 1.4 Child Logger 격리 (병렬 실행)

```
createChildLogger(workflowId: string): Logger

- 터미널 출력: prefix로 workflowId 축약 포함 (예: `[wf-a1b2] 🔵 Planning...`)
- 파일 로그: 별도 파일 (workflow-<workflowId>.log)
- 각 child logger는 독립적인 파일 핸들 유지
- 부모 logger의 logLevel 설정 상속
```

### 1.5 리포트 생성 로직

**generateReport(result: WorkflowResult): Promise<string>**

```
Input: WorkflowResult (status, prUrl, totalCycles, reviewHistory, duration)

Output: Markdown 형식 리포트 파일 경로

리포트 내용:
1. 헤더: 작업 요약, 최종 상태 (APPROVED/FAILED/STOPPED)
2. 실행 통계: 총 사이클 수, 총 소요 시간
3. 사이클별 요약:
   - 사이클 번호, 소요 시간
   - 리뷰 결과 (APPROVED/CHANGES_REQUESTED)
   - 주요 findings (severity별 카운트)
4. 최종 결과: PR URL (있으면), 변경된 파일 수
5. 저장 경로: .ai-workflow/logs/report-<workflowId>.md
```

---

## 2. ConfigManager (C-07)

### 2.1 설정 소스별 로드 로직

```
설정 소스 (4개):
1. 기본값 (하드코딩)
2. 글로벌 JSON: ~/.dev-agent/config.json
3. 프로젝트 JSON: <projectPath>/.ai-workflow/config.json
4. 환경변수: DEV_AGENT_* prefix
5. CLI 옵션: 커맨드라인에서 직접 전달

로드 순서 (낮은 우선순위 → 높은 우선순위):
기본값 → 글로벌 JSON → 프로젝트 JSON → 환경변수 → CLI 옵션
```

**환경변수 매핑 규칙:**
```
DEV_AGENT_MAX_ITERATIONS → maxIterations (number)
DEV_AGENT_LOG_LEVEL → logLevel (string)
DEV_AGENT_BRANCH_PREFIX → branchPrefix (string)
DEV_AGENT_BASE_BRANCH → baseBranch (string)
DEV_AGENT_CLAUDE_PATH → claudePath (string)
DEV_AGENT_CODEX_PATH → codexPath (string)
DEV_AGENT_GH_PATH → ghPath (string)
DEV_AGENT_PROJECTS_DIR → projectsDir (string)
DEV_AGENT_ITERATION_TIMEOUT → iterationTimeout (number, ms)

변환 규칙:
- 카멜케이스 → UPPER_SNAKE_CASE + "DEV_AGENT_" prefix
- number 타입: parseInt() 적용
- boolean 타입: "true"/"1" → true, 나머지 → false
```

### 2.2 설정 병합 알고리즘

```typescript
function mergeConfig(
  defaults: WorkflowConfig,
  globalJson: Partial<WorkflowConfig> | null,
  projectJson: Partial<WorkflowConfig> | null,
  envVars: Partial<WorkflowConfig>,
  cliOptions: Partial<WorkflowConfig>
): WorkflowConfig {
  // Shallow merge (중첩 객체인 reviewChecks는 deep merge)
  const merged = {
    ...defaults,
    ...(globalJson ?? {}),
    ...(projectJson ?? {}),
    ...envVars,
    ...cliOptions,
  };

  // reviewChecks는 deep merge (부분 오버라이드 허용)
  merged.reviewChecks = {
    ...defaults.reviewChecks,
    ...(globalJson?.reviewChecks ?? {}),
    ...(projectJson?.reviewChecks ?? {}),
    ...(envVars.reviewChecks ?? {}),
    ...(cliOptions.reviewChecks ?? {}),
  };

  return merged;
}
```

### 2.3 설정 검증 규칙

**Severity 분류:**

| 설정 항목 | 검증 규칙 | 실패 시 Severity |
|---|---|---|
| claudePath | 실행 가능 경로 존재 | CRITICAL (종료) |
| codexPath | 실행 가능 경로 존재 | CRITICAL (종료) |
| ghPath | 실행 가능 경로 존재 | CRITICAL (종료) |
| maxIterations | 1 ≤ n ≤ 20, 정수 | WARNING (기본값 3) |
| iterationTimeout | 30000 ≤ n ≤ 3600000 | WARNING (기본값 300000) |
| logLevel | "debug"\|"info"\|"warn"\|"error" | WARNING (기본값 "info") |
| branchPrefix | 비어있지 않은 문자열, git 브랜치명 규칙 준수 | WARNING (기본값 "ai") |
| baseBranch | 비어있지 않은 문자열 | WARNING (기본값 "main") |
| projectsDir | 유효한 디렉토리 경로 | WARNING (기본값 "./projects") |
| reviewChecks.* | boolean 타입 | WARNING (기본값 true) |

**검증 프로세스:**
```
1. 전체 설정 병합 완료
2. CRITICAL 항목 검증 → 실패 시 에러 메시지 출력 + process.exit(1)
3. WARNING 항목 검증 → 실패 시 경고 출력 + 기본값 대체
4. 최종 유효 설정 반환
```

### 2.4 기본값 정의

```typescript
const DEFAULT_CONFIG: WorkflowConfig = {
  projectsDir: "./projects",
  maxIterations: 3,
  iterationTimeout: 300000,       // 5분
  branchPrefix: "ai",
  baseBranch: "main",
  autoCommit: true,
  prAutoCreate: true,
  prIncludeReviewSummary: true,
  reviewChecks: {
    build: true,
    tests: true,
    security: true,
    design: true,
    codeQuality: true,
    errorHandling: true,
    performance: true,
  },
  claudePath: "claude",
  codexPath: "codex",
  ghPath: "gh",
  logLevel: "info",
  logDir: ".ai-workflow/logs",
};
```

---

## 3. WorkspaceManager (C-10)

### 3.1 프로젝트 검증 로직

**validateProject(projectPath: string): Promise<ValidationResult>**

```
검증 단계 (순서대로):
1. 경로 존재 확인
   - 실패: errors.push("프로젝트 경로가 존재하지 않습니다: <path>")

2. 디렉토리인지 확인
   - 실패: errors.push("경로가 디렉토리가 아닙니다: <path>")

3. .git 디렉토리 존재 확인 (Git 레포)
   - 실패: errors.push("Git 레포지토리가 아닙니다. 'git init'으로 초기화해주세요.")

4. Git remote 설정 확인 (git remote -v)
   - 실패: warnings.push("Git remote가 설정되지 않았습니다. PR 생성이 불가합니다.")

5. 현재 브랜치 확인 가능 여부
   - 실패: errors.push("Git 브랜치 상태를 확인할 수 없습니다.")

결과:
- valid = (errors.length === 0)
- errors: string[] (치명적 문제)
- warnings: string[] (경고, 실행 가능하지만 일부 기능 제한)
```

### 3.2 CLI 도구 가용성 검증

**checkPrerequisites(): Promise<PrerequisiteResult>**

```
각 도구에 대해:
1. which <tool> 또는 command -v <tool> 실행
2. 존재하면 <tool> --version 실행하여 버전 정보 수집
3. 결과: { available: boolean, version?: string }

검증 대상:
- claude: `claude --version` (또는 claudePath 설정값)
- codex: `codex --version` (또는 codexPath 설정값)
- gh: `gh --version`
- git: `git --version`

모든 도구가 available=true여야 워크플로우 실행 가능
하나라도 available=false이면 에러 메시지와 함께 설치 안내 출력
```

### 3.3 .ai-workflow 디렉토리 초기화

**initWorkflowDir(projectPath: string): Promise<void>**

```
생성할 디렉토리 구조:
<projectPath>/.ai-workflow/
├── config.json       (기본 설정, 없으면 생성)
├── current/          (현재 진행 중인 작업)
│   └── iterations/   (반복 사이클 기록)
├── history/          (완료된 작업 아카이브)
└── logs/             (실행 로그)

규칙:
- 이미 존재하면 기존 구조 유지 (덮어쓰지 않음)
- 존재하지 않는 디렉토리만 생성
- config.json이 없으면 빈 객체 {} 생성 (기본값 사용 의미)
```

### 3.4 프로젝트 목록 조회

**listProjects(projectsDir: string): Promise<ProjectInfo[]>**

```
1. projectsDir 내 모든 디렉토리 스캔 (1단계만, 재귀 없음)
2. 숨김 디렉토리(.) 제외
3. 각 디렉토리에 대해:
   - name: 디렉토리명
   - path: 절대 경로
   - hasGit: .git 존재 여부
   - hasRemote: git remote -v 결과 존재 여부
   - hasWorkflowDir: .ai-workflow 존재 여부
4. 알파벳 순 정렬하여 반환
```

---

## 4. StateManager (C-08)

### 4.1 상태 직렬화/역직렬화

**저장 경로:** `<projectPath>/.ai-workflow/current/state.json`

**형식:** JSON (pretty-printed, 2-space indent)

```typescript
// 저장
async save(projectPath: string, state: WorkflowState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const filePath = path.join(projectPath, '.ai-workflow', 'current', 'state.json');
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

// 복원
async restore(projectPath: string): Promise<WorkflowState | null> {
  const filePath = path.join(projectPath, '.ai-workflow', 'current', 'state.json');
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as WorkflowState;
}
```

### 4.2 상태 저장 트리거

```
저장 시점 (각 단계 완료 시):
1. Planning 완료 → currentPhase="planning" 완료 상태 저장
2. Implementation 완료 → currentPhase="implementation" 완료 상태 저장
3. Review 완료 → currentPhase="review" 완료 상태 저장 (+ reviewHistory 업데이트)
4. PR 생성 완료 → currentPhase="pr_creation" 완료 상태 저장
5. SIGINT/SIGTERM 수신 시 → 현재 상태 긴급 저장 (phase는 "interrupted"로 표시하지 않고 마지막 완료된 단계 유지)

저장 시 항상 updatedAt 갱신
```

### 4.3 상태 복원 로직

```
resume(projectPath) 호출 시:
1. state.json 존재 확인 → 없으면 null 반환 (재시작 불가)
2. state.json 파싱
3. 복원 가능성 판단:
   - workflowId 유효성 (비어있지 않은 문자열)
   - currentPhase가 유효한 값
   - branchName 존재 확인 (git branch 존재 여부 체크)
   - artifacts 경로 유효성 (파일 존재 여부)
4. 복원 불가 시: 경고 + null 반환
5. 복원 가능 시: WorkflowState 반환

복원 후 재시작 위치:
- currentPhase="planning" → planning부터 재실행 (산출물 재생성)
- currentPhase="implementation" → implementation부터 재실행
- currentPhase="review" → review부터 재실행
- currentPhase="pr_creation" → PR 생성부터 재실행
```

### 4.4 SIGINT/SIGTERM 핸들링

```
registerShutdownHandler(projectPath: string):
1. process.on('SIGINT', handler)
2. process.on('SIGTERM', handler)

handler:
1. 현재 실행 중인 child process에 SIGTERM 전송
2. child process 종료 대기 (최대 5초)
3. 현재 state를 state.json에 저장 (긴급 저장)
4. 터미널에 메시지 출력:
   "⚠️  워크플로우가 중단되었습니다. 'dev-agent resume --project <path>'로 재시작할 수 있습니다."
5. process.exit(130) (SIGINT) 또는 process.exit(143) (SIGTERM)

주의:
- 핸들러는 워크플로우당 1회만 등록 (중복 방지)
- 긴급 저장 실패 시에도 종료 진행 (최선 노력)
```

### 4.5 히스토리 아카이브

```
archive(projectPath: string, state: WorkflowState): Promise<void>

트리거: 워크플로우 정상 완료 시 (APPROVED 또는 사용자 선택에 의한 PR 생성 후)

동작:
1. .ai-workflow/current/ 전체를 .ai-workflow/history/<workflowId>/ 로 이동
2. 아카이브 디렉토리 구조:
   .ai-workflow/history/<workflowId>/
   ├── state.json (최종 상태)
   ├── requirements.md
   ├── implementation-spec.md
   ├── test-scenarios.md
   └── iterations/
       ├── cycle-1/
       └── cycle-N/
3. current/ 디렉토리를 빈 상태로 초기화 (iterations/ 디렉토리만 재생성)
4. 로그 파일은 logs/ 디렉토리에 유지 (이동하지 않음)
```
