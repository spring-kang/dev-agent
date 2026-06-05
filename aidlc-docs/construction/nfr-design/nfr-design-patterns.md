# NFR Design Patterns - dev-agent

> Functional Design의 비즈니스 로직 + NFR Requirements를 반영한 설계 패턴.
> 로컬 CLI 도구에 적합한 패턴만 선택.

---

## 1. Resilience Patterns (안정성 패턴)

### 1.1 Graceful Degradation: 상태 저장 우선

**적용 대상**: 모든 에러 발생 시점

```
패턴:
- 에러 발생 시 "상태 저장 → 에러 전파" 순서
- StateManager.save()가 실패해도 원본 에러를 전파 (save 실패는 경고만)
- "데이터 보존 > 깔끔한 종료" 원칙

적용 위치:
- PipelineService: 각 단계 실패 시 현재까지의 상태 저장
- Orchestrator: 사이클 루프 에러 시 상태 저장 후 에러 전파
- CLI: SIGINT 핸들러에서 상태 저장 후 종료
```

### 1.2 Atomic Write: 상태 파일 무결성

**적용 대상**: StateManager.save()

```
패턴:
1. 임시 파일에 쓰기: state.json.tmp
2. fsync로 디스크 동기화
3. rename으로 원자적 교체: state.json.tmp → state.json

이점:
- 쓰기 중 프로세스 종료 → 기존 state.json 보존
- rename은 파일 시스템 수준에서 원자적

구현:
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + ".tmp";
  const fd = await fs.open(tmpPath, "w");
  await fd.write(data);
  await fd.datasync();
  await fd.close();
  await fs.rename(tmpPath, filePath);
}
```

### 1.3 Process Lifecycle Management: 자식 프로세스 관리

**적용 대상**: ClaudeAgent, CodexAgent, GitManager

```
패턴:
1. spawn으로 자식 프로세스 생성 (shell: false)
2. 타임아웃 타이머 설정
3. stdout/stderr 스트림 수집
4. 정상 종료: exitCode 확인 → 결과 반환
5. 타임아웃: SIGTERM → 5초 대기 → SIGKILL → AgentTimeoutError
6. 비정상 종료: exitCode !== 0 → AgentProcessError

구현:
function spawnWithTimeout(cmd, args, opts): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, shell: false });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
      reject(new AgentTimeoutError(...));
    }, opts.timeout);

    // stdout/stderr 수집
    // close 이벤트에서 resolve/reject
  });
}
```

### 1.4 Fail-Fast Preflight: 사전 검증

**적용 대상**: WorkflowService.execute()

```
패턴:
- 워크플로우 시작 전 모든 사전 조건을 한번에 검증
- 하나라도 실패하면 워크플로우를 시작하지 않음
- "빨리 실패 → 빨리 수정" 원칙
- AI 에이전트 호출 비용(시간+토큰)을 절약

검증 순서:
1. 설정 로드 가능 여부
2. 프로젝트 경로 유효성
3. 필수 CLI 도구 (git, claude, codex, gh) 존재
4. 디스크 공간 (최소 100MB)
```

---

## 2. Error Handling Patterns (에러 처리 패턴)

### 2.1 Error Hierarchy: 구조화된 에러 체계

**적용 대상**: 전체 시스템

```
패턴:
AppError (추상 베이스)
├── code: string          // 기계 판독용 (예: "GIT_PUSH_ERROR")
├── severity: string      // "critical" | "recoverable"
├── message: string       // 사람 판독용
└── cause?: Error         // 원인 에러 체이닝

서브클래스:
├── ConfigError           // 설정 관련
├── WorkspaceError        // 프로젝트/디렉토리 관련
├── StateError            // 상태 관련
├── AgentTimeoutError     // 에이전트 타임아웃
├── AgentProcessError     // 에이전트 프로세스 실패
├── AgentOutputError      // 에이전트 출력 파싱 실패
├── GitError              // Git 명령 실패
├── GitPushError          // Push 실패
├── GitPrError            // PR 생성 실패
├── OrchestratorError     // 워크플로우 오케스트레이션 실패
├── ReviewParseError      // 리뷰 파싱 실패
├── CliError              // CLI 입력 오류
└── WorkflowServiceError  // 서비스 레벨 오류

이점:
- 에러 유형별 복구 전략 분기 가능
- severity로 resume 가능 여부 판단
- cause 체이닝으로 디버깅 용이
```

### 2.2 Error Boundary: 이벤트 핸들러 격리

**적용 대상**: MonitoringService 이벤트 핸들러

```
패턴:
- 이벤트 핸들러에서 발생하는 에러가 핵심 워크플로우에 영향을 주지 않음
- 각 핸들러를 try-catch로 감싸서 에러를 로그로만 기록

구현:
function safeEmit(event: string, data: any): void {
  try {
    eventEmitter.emit(event, data);
  } catch (error) {
    logger.warn(`이벤트 핸들러 에러 (${event}):`, error);
    // 워크플로우는 계속 진행
  }
}
```

### 2.3 Conservative Judgment: 보수적 판정

**적용 대상**: ReviewEngine.evaluate()

```
패턴:
- 판단이 불확실할 때 항상 "안전한 방향"으로 결정
- APPROVED vs CHANGES_REQUESTED 불확실 → CHANGES_REQUESTED
- 파싱 실패 → CHANGES_REQUESTED
- 빈 결과 → CHANGES_REQUESTED

이유:
- 잘못된 APPROVED → 품질 낮은 코드가 PR됨 (위험)
- 잘못된 CHANGES_REQUESTED → 추가 사이클 1회 (비용)
- 비용보다 위험이 크므로 보수적으로 판정
```

---

## 3. Performance Patterns (성능 패턴)

### 3.1 Lazy Initialization: 지연 초기화

**적용 대상**: container.ts (DI 컴포지션 루트)

```
패턴:
- CLI 파싱 후 필요한 서비스만 초기화
- `dev-agent --version` 등 단순 명령은 전체 DI 구성 불필요
- 서브커맨드별 필요한 의존성만 생성

구현:
// 전체 초기화하지 않고 커맨드별 초기화
function createRunDependencies() {
  const logger = new Logger(...);
  const configManager = new ConfigManager(...);
  // ... run에 필요한 것만
}

function createStatusDependencies() {
  const logger = new Logger(...);
  // ... status에 필요한 것만 (에이전트 불필요)
}
```

### 3.2 Stream Processing: 스트림 기반 출력 수집

**적용 대상**: ClaudeAgent, CodexAgent의 stdout/stderr

```
패턴:
- 자식 프로세스의 stdout을 메모리에 전체 버퍼링하지 않고 청크 단위로 처리
- 로그 파일에는 스트리밍으로 기록
- 메모리에는 최대 크기 제한 적용 (10,000자)

구현:
const chunks: Buffer[] = [];
let totalSize = 0;
const MAX_CAPTURE = 10_000;

proc.stdout.on("data", (chunk: Buffer) => {
  if (totalSize < MAX_CAPTURE) {
    chunks.push(chunk);
    totalSize += chunk.length;
  }
  // 로그 파일에는 항상 기록
  logStream.write(chunk);
});
```

---

## 4. Security Patterns (보안 패턴)

### 4.1 Safe Spawn: 안전한 프로세스 실행

**적용 대상**: 모든 child_process 호출

```
패턴:
- shell: false 강제 (shell injection 방지)
- 인자를 문자열 배열로 전달 (절대 문자열 결합 아님)
- 환경변수 상속 최소화 (필요한 것만 전달)

구현:
// 안전 (shell: false + 배열 인자)
spawn("claude", ["-p", userInput, "--output-format", "text"], { shell: false });

// 위험 (절대 사용 금지)
exec(`claude -p "${userInput}"`);  // 금지!
```

### 4.2 Path Traversal Prevention: 경로 이탈 방지

**적용 대상**: WorkspaceManager, StateManager

```
패턴:
- 사용자 입력 경로를 항상 정규화 (path.resolve)
- 정규화된 경로가 허용된 디렉토리 하위인지 검증
- 심볼릭 링크를 따라가지 않음 (fs.realpath 사용)

구현:
function validatePath(userPath: string, allowedBase: string): string {
  const resolved = path.resolve(userPath);
  const real = await fs.realpath(resolved);
  if (!real.startsWith(allowedBase)) {
    throw new WorkspaceError("경로 접근 거부: 허용된 디렉토리 외부");
  }
  return real;
}
```

### 4.3 Sensitive Data Masking: 민감 정보 마스킹

**적용 대상**: Logger

```
패턴:
- 환경변수 값 로깅 시 마스킹
- 키 이름에 SECRET, TOKEN, KEY, PASSWORD, API_KEY 포함 시 값 대체
- 마스킹 형식: "****(4자)"

구현:
const SENSITIVE_PATTERNS = /secret|token|key|password|api_key/i;

function maskSensitive(key: string, value: string): string {
  if (SENSITIVE_PATTERNS.test(key)) {
    return "****";
  }
  return value;
}
```

---

## 5. Observability Patterns (관측성 패턴)

### 5.1 Structured Logging: 구조화된 로깅

**적용 대상**: Logger

```
패턴:
- 터미널 출력: 사람이 읽기 쉬운 형식 (아이콘 + 색상)
- 파일 출력: 기계가 파싱하기 쉬운 JSON Lines

터미널 형식:
[14:30:25] ⚙️  [planning] Claude Code 기획 시작 (Cycle 1)
[14:32:10] ✅ [planning] Claude Code 기획 완료 (1m 45s)

파일 형식 (JSON Lines):
{"ts":"2026-06-01T14:30:25.123Z","level":"info","phase":"planning","cycle":1,"msg":"Claude Code 기획 시작","wfId":"abc-123"}
```

### 5.2 Event-Driven Monitoring: 이벤트 기반 모니터링

**적용 대상**: Orchestrator → MonitoringService

```
패턴:
- 핵심 로직(Orchestrator/PipelineService)이 이벤트를 발행
- 모니터링(MonitoringService)이 이벤트를 구독
- 발행자는 구독자를 알 필요 없음 (느슨한 결합)
- 구독자 에러가 발행자에 영향 없음

이벤트 흐름:
Orchestrator ──emit("workflow:start")──▶ MonitoringService.onWorkflowStart()
Pipeline ──emit("phase:start")──▶ MonitoringService.onPhaseStart()
Pipeline ──emit("phase:complete")──▶ MonitoringService.onPhaseComplete()
Pipeline ──emit("cycle:complete")──▶ MonitoringService.onCycleComplete()
Orchestrator ──emit("workflow:end")──▶ MonitoringService.onWorkflowEnd()
```

### 5.3 Duration Tracking: 소요 시간 추적

**적용 대상**: PipelineService, Orchestrator

```
패턴:
- 각 단계/사이클/워크플로우의 시작/종료 시간 기록
- performance.now() 사용 (Date.now()보다 정밀)
- 이벤트에 duration 포함하여 발행

구현:
async function trackDuration<T>(
  phase: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = Math.round(performance.now() - start);
  return { result, duration };
}
```

---

## 6. Maintainability Patterns (유지보수성 패턴)

### 6.1 Manual Dependency Injection: 수동 DI

**적용 대상**: container.ts

```
패턴:
- DI 컨테이너 프레임워크 없이 수동으로 의존성 조립
- 빌드 순서에 맞춰 생성: U-01 → U-02 → U-04 → U-03 → U-05
- 각 컴포넌트는 생성자에서 의존성을 주입받음

구현:
// container.ts
export function createContainer(): Container {
  // Phase 1: U-01 Core Infrastructure
  const logger = new Logger(logConfig);
  const configManager = new ConfigManager();
  const workspaceManager = new WorkspaceManager(logger);
  const stateManager = new StateManager(logger);

  // Phase 2: U-02 Agent Integration
  const claudeAgent = new ClaudeAgent(logger);
  const codexAgent = new CodexAgent(logger);

  // Phase 3: U-04 Git & PR
  const gitManager = new GitManager(logger);
  const gitService = new GitService(gitManager, logger);

  // Phase 4: U-03 Domain Logic
  const reviewEngine = new ReviewEngine();
  const eventEmitter = new EventEmitter();
  const pipelineService = new PipelineService(
    claudeAgent, codexAgent, gitManager, reviewEngine,
    stateManager, eventEmitter, logger
  );
  const orchestrator = new Orchestrator(
    pipelineService, gitService, stateManager,
    reviewEngine, eventEmitter, logger
  );

  // Phase 5: U-05 CLI & Workflow
  const monitoringService = new MonitoringService(eventEmitter, logger);
  const workflowService = new WorkflowService(
    orchestrator, configManager, workspaceManager,
    stateManager, monitoringService, logger
  );

  return { workflowService, logger };
}
```

### 6.2 Interface Segregation: 인터페이스 분리

**적용 대상**: Agent, Git 인터페이스

```
패턴:
- 큰 인터페이스보다 작은 인터페이스 여러 개
- 테스트 시 필요한 메서드만 mock

인터페이스:
interface PlanningAgent {
  plan(request: PlanRequest): Promise<PlanResult>;
}

interface ImplementationAgent {
  implement(request: ImplementRequest): Promise<ImplementResult>;
}

interface ReviewAgent {
  review(request: ReviewRequest): Promise<ReviewRawOutput>;
}

// ClaudeAgent implements PlanningAgent, ReviewAgent
// CodexAgent implements ImplementationAgent
```

### 6.3 Configuration with Defaults: 기본값 있는 설정

**적용 대상**: ConfigManager

```
패턴:
- 모든 설정 항목에 기본값 제공
- 사용자가 설정하지 않은 항목은 자동으로 기본값 사용
- undefined가 비즈니스 로직에 전파되지 않음

구현:
const DEFAULT_CONFIG: Required<WorkflowConfig> = {
  maxIterations: 5,
  branchPrefix: "ai",
  logLevel: "info",
  claudeTimeout: 300000,
  codexTimeout: 600000,
  prIncludeReviewSummary: true,
  autoCommit: true,
};

function mergeConfig(...sources: Partial<WorkflowConfig>[]): Required<WorkflowConfig> {
  return Object.assign({}, DEFAULT_CONFIG, ...sources);
}
```

---

## 7. Pattern Application Matrix

| 패턴 | 유닛 | NFR 카테고리 | 우선순위 |
|---|---|---|---|
| Atomic Write | U-01 | Reliability | Critical |
| Process Lifecycle | U-02 | Reliability | Critical |
| Graceful Degradation | U-01, U-05 | Reliability | Critical |
| Safe Spawn | U-02, U-04 | Security | High |
| Path Traversal Prevention | U-01 | Security | High |
| Sensitive Data Masking | U-01 | Security | High |
| Error Hierarchy | 전체 | Maintainability | High |
| Interface Segregation | U-02, U-04 | Maintainability | High |
| Manual DI | 전체 | Maintainability | High |
| Conservative Judgment | U-03 | Reliability | High |
| Error Boundary | U-03, U-05 | Reliability | Medium |
| Fail-Fast Preflight | U-05 | Performance | Medium |
| Lazy Initialization | U-05 | Performance | Medium |
| Stream Processing | U-02 | Performance | Medium |
| Structured Logging | U-01 | Observability | Medium |
| Event-Driven Monitoring | U-03, U-05 | Observability | Medium |
| Duration Tracking | U-03 | Observability | Medium |
| Config with Defaults | U-01 | Usability | Medium |
