# Logical Components - dev-agent NFR Design

> NFR 패턴을 반영한 논리적 컴포넌트 설계.
> 각 컴포넌트의 NFR 관련 책임과 구현 방향 정의.

---

## 1. Cross-Cutting Components (횡단 관심사)

### 1.1 ErrorHandler (에러 처리 횡단 컴포넌트)

```
책임:
- AppError 계층 구조 정의
- 에러 → 사용자 메시지 변환
- 에러 → 로그 엔트리 변환
- 에러 힌트 매핑 (에러 코드 → 해결 방법)

인터페이스:
class AppError extends Error {
  abstract readonly code: string;
  abstract readonly severity: "critical" | "recoverable";
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.cause = cause;
  }

  toLogEntry(): LogEntry {
    return { code: this.code, severity: this.severity, message: this.message, stack: this.stack };
  }
}

ERROR_HINTS: Record<string, string> = {
  "AGENT_TIMEOUT": "'dev-agent resume'로 재시작해보세요",
  "GIT_PUSH_ERROR": "네트워크 연결 또는 원격 저장소 접근 권한을 확인하세요",
  "PREREQUISITE_ERROR": "'claude --version', 'codex --version' 명령으로 설치를 확인하세요",
  ...
}
```

### 1.2 ProcessManager (프로세스 생명주기 관리)

```
책임:
- 자식 프로세스 spawn + 타임아웃 관리
- stdout/stderr 수집 (크기 제한 적용)
- 정상/비정상 종료 처리
- 강제 종료 (SIGTERM → SIGKILL 에스컬레이션)

인터페이스:
interface ProcessManager {
  spawn(command: string, args: string[], options: SpawnOptions): Promise<ProcessResult>;
  killAll(): void;  // graceful shutdown 시 호출
}

SpawnOptions:
- cwd: string
- timeout: number
- env?: Record<string, string>
- maxOutputSize?: number (default: 10,000)

ProcessResult:
- stdout: string
- stderr: string
- exitCode: number
- duration: number

내부 동작:
- 활성 프로세스 Set 관리 (killAll용)
- shell: false 강제
- 타임아웃 시: SIGTERM → 5초 → SIGKILL
```

### 1.3 FileManager (안전한 파일 I/O)

```
책임:
- Atomic write (write-then-rename)
- 경로 정규화 + 접근 범위 검증
- 디렉토리 자동 생성 (recursive: true)
- JSON 읽기/쓰기 (타입 안전)

인터페이스:
interface FileManager {
  readJson<T>(filePath: string): Promise<T>;
  writeJson(filePath: string, data: unknown): Promise<void>;  // atomic
  exists(filePath: string): Promise<boolean>;
  ensureDir(dirPath: string): Promise<void>;
  validatePath(userPath: string, allowedBase: string): string;  // 경로 검증
}

내부 동작:
- writeJson: atomicWrite 패턴 적용
- readJson: JSON.parse 실패 시 명확한 에러 (파일 경로 포함)
- validatePath: path.resolve + startsWith 검증
```

---

## 2. NFR-Enhanced Component Design

### 2.1 Logger (NFR 반영)

```
기존 Functional Design + NFR 추가 사항:

추가 책임:
- 민감 정보 마스킹 (NFR-SEC-04)
- JSON Lines 파일 출력 (NFR-LOG-01)
- 에이전트 출력 크기 제한 (NFR-LOG-02)
- NO_COLOR / --no-color 지원 (NFR-USE-03)

마스킹 로직:
- 로그 메시지 내 환경변수 값 패턴 감지
- SENSITIVE_PATTERNS에 매칭되는 키의 값 → "****"

로그 크기 관리:
- 단일 로그 엔트리 최대 크기: 10,000자
- 초과 시 truncate + "[truncated: {N} chars]" 접미사
- 워크플로우 로그 파일: 아카이브 시 압축 (gzip)

TTY 감지:
- process.stdout.isTTY === true → 색상 + 아이콘 출력
- process.stdout.isTTY === false → 색상 없는 plain text
- NO_COLOR 환경변수 또는 --no-color → 강제 색상 비활성화
```

### 2.2 StateManager (NFR 반영)

```
기존 Functional Design + NFR 추가 사항:

추가 책임:
- Atomic write 적용 (NFR-REL-03)
- 복원 시 무결성 검증 (NFR-REL-03)
- 손상 상태 fallback (NFR-REL-03)

Atomic Write 구현:
save(state):
  1. JSON.stringify(state, null, 2)
  2. atomicWrite(STATE_FILE_PATH, json)
     - state.json.tmp에 쓰기
     - datasync
     - rename → state.json

복원 시 검증:
restore(projectPath):
  1. state.json 읽기
  2. JSON.parse → 실패 시 StateError
  3. 필수 필드 존재 확인 (workflowId, status, currentPhase)
  4. 필수 필드 누락 → StateError (손상)
  5. artifacts 경로 실제 존재 여부 확인
  6. 산출물 누락 → 이전 단계로 currentPhase 조정 (fallback)
```

### 2.3 ConfigManager (NFR 반영)

```
기존 Functional Design + NFR 추가 사항:

추가 책임:
- 설정 소스 추적 (NFR-USE-04: config show에서 출처 표시)
- 기본값 완전 보장 (NFR-SCA-04)
- 미지원 키 감지 (오타 방지)

소스 추적:
interface ConfigWithSource {
  value: Required<WorkflowConfig>;
  sources: Record<keyof WorkflowConfig, "default" | "global" | "project" | "env" | "cli">;
}

미지원 키 감지:
- 사용자 설정 파일에 알 수 없는 키 → 경고 로그
- 값은 무시 (에러 아님, 하위 호환성)
```

### 2.4 WorkspaceManager (NFR 반영)

```
기존 Functional Design + NFR 추가 사항:

추가 책임:
- 경로 이탈 방지 (NFR-SEC-03)
- 심볼릭 링크 추적 (NFR-SEC-03)

경로 검증 강화:
validateProject(projectPath):
  1. path.resolve(projectPath) → 절대 경로
  2. fs.realpath(resolved) → 심볼릭 링크 해제
  3. 허용된 베이스 디렉토리 하위인지 확인
  4. 접근 권한 확인 (R_OK | W_OK)
```

### 2.5 ClaudeAgent / CodexAgent (NFR 반영)

```
기존 Functional Design + NFR 추가 사항:

추가 책임:
- ProcessManager를 통한 안전한 spawn (NFR-SEC-01)
- stdout 크기 제한 (NFR-LOG-02)
- 프롬프트 인젝션 방어 (NFR-SEC-02)

프롬프트 인젝션 방어:
- 사용자 입력(taskDescription)을 프롬프트 내 명확한 구분자로 감싸기
- 시스템 지시와 사용자 데이터를 분리

예시:
const prompt = `
다음 작업을 기획해주세요.

=== 사용자 요청 (변경 금지) ===
${taskDescription}
=== 사용자 요청 끝 ===

위 요청에 대해 다음 형식으로 기획 문서를 작성하세요:
...
`;
```

---

## 3. Component Interaction (NFR 관점)

### 3.1 에러 전파 흐름

```
에이전트 에러 발생 시:

ClaudeAgent
  └── AgentTimeoutError (severity: "recoverable")
        │
        ▼
PipelineService
  ├── StateManager.save() ← 상태 저장 (best effort)
  └── 에러 재throw
        │
        ▼
Orchestrator
  ├── StateManager.save() ← 최종 상태 저장
  └── 에러 재throw
        │
        ▼
WorkflowService
  ├── MonitoringService.stop()
  └── 에러 → WorkflowResult(status="failed", error)
        │
        ▼
CLI
  ├── formatError() → 사용자 메시지 + 힌트
  └── process.exitCode = 1
```

### 3.2 Graceful Shutdown 흐름

```
SIGINT 수신 시:

CLI (SIGINT Handler)
  │
  ├── 1. MonitoringService.stop()
  │     └── 진행 표시 중단, 이벤트 구독 해제
  │
  ├── 2. ProcessManager.killAll()
  │     └── 활성 자식 프로세스에 SIGTERM 전달
  │
  ├── 3. StateManager.save()
  │     └── 현재 상태 atomic write
  │
  ├── 4. Logger.info("중단됨. resume으로 재시작 가능")
  │
  └── 5. process.exit(0)

두 번째 SIGINT (1초 내):
  └── process.exit(1) (즉시 강제 종료)
```

### 3.3 Resume 복원 흐름

```
dev-agent resume ./project

CLI
  └── WorkflowService.resume(projectPath)
        │
        ├── 1. StateManager.restore(projectPath)
        │     ├── JSON 파싱 + 필수 필드 검증
        │     └── 산출물 파일 존재 여부 확인
        │
        ├── 2. 산출물 누락 시 currentPhase 조정
        │     예: implementation 단계인데 PlanResult 없음
        │     → currentPhase를 planning으로 downgrade
        │
        ├── 3. Orchestrator.resume(projectPath)
        │     └── 조정된 currentPhase부터 사이클 재시작
        │
        └── 4. 이후 정상 execute()와 동일한 흐름
```

---

## 4. Testing Strategy (NFR-MNT-03)

### 4.1 단위 테스트 대상

| 컴포넌트 | 테스트 초점 | Mock 대상 |
|---|---|---|
| ReviewEngine | 판정 로직, 파싱 로직 | 없음 (순수 함수) |
| ConfigManager | 병합 로직, 기본값, 검증 | fs (파일 읽기) |
| StateManager | 저장/복원, atomic write, fallback | fs (파일 I/O) |
| Logger | 포매팅, 마스킹, 레벨 필터 | fs (파일 쓰기), console |
| GitManager | 명령 구성, 출력 파싱 | child_process |
| PipelineService | 단계 순서, 데이터 전달 | Agent, GitManager, StateManager |
| Orchestrator | 사이클 루프, max iteration | PipelineService, GitService |

### 4.2 통합 테스트 시나리오

```
1. Happy Path:
   - 1사이클 APPROVED → PR 생성 → 정상 종료

2. Rework Path:
   - 1사이클 CHANGES_REQUESTED → 2사이클 APPROVED → PR 생성

3. Max Iterations:
   - 3사이클 모두 CHANGES_REQUESTED → 사용자 선택 분기

4. Error Recovery:
   - Planning 단계에서 에러 → 상태 저장 → resume → 정상 완료

5. Graceful Shutdown:
   - 실행 중 SIGINT → 상태 저장 → resume → 정상 완료
```

### 4.3 테스트 구성

```
tests/
├── unit/
│   ├── components/
│   │   ├── review-engine.test.ts        # 판정 + 파싱 로직
│   │   ├── config-manager.test.ts       # 설정 병합 + 검증
│   │   ├── state-manager.test.ts        # 저장/복원 + atomic
│   │   ├── logger.test.ts              # 포매팅 + 마스킹
│   │   ├── claude-agent.test.ts        # 프롬프트 구성 + 파싱
│   │   ├── codex-agent.test.ts         # 명령 구성 + 파싱
│   │   ├── git-manager.test.ts         # Git 명령 + 파싱
│   │   └── workspace-manager.test.ts   # 프로젝트 검증
│   ├── services/
│   │   ├── pipeline.service.test.ts    # 사이클 실행 순서
│   │   ├── git.service.test.ts         # 초기화 + finalize
│   │   ├── workflow.service.test.ts    # preflight + 위임
│   │   └── monitoring.service.test.ts  # 이벤트 핸들링
│   └── orchestrator/
│       └── orchestrator.test.ts        # 사이클 루프 + resume
├── integration/
│   ├── workflow-happy-path.test.ts
│   ├── workflow-rework.test.ts
│   ├── workflow-max-iterations.test.ts
│   └── workflow-error-recovery.test.ts
└── fixtures/
    ├── review-outputs/                 # 리뷰 출력 예시 (JSON/텍스트)
    ├── config-files/                   # 설정 파일 변형들
    └── state-files/                    # 상태 파일 변형들
```

---

## 5. Dependency Summary (최종)

```
External (Production):
  commander  ^12.x  → CLI 파싱
  chalk      ^5.x   → 터미널 색상

Built-in (Node.js):
  node:child_process → 프로세스 spawn
  node:fs/promises   → 파일 I/O
  node:path          → 경로 처리
  node:events        → EventEmitter
  node:readline      → 사용자 입력
  node:crypto        → UUID 생성 (crypto.randomUUID)
  node:os            → 시스템 정보

Dev Only:
  typescript  ^5.4   → 컴파일러
  vitest      ^1.x   → 테스트
  tsx         ^4.x   → 개발 실행
  eslint      ^9.x   → 린팅
  prettier    ^3.x   → 포매팅
  @types/node ^20.x  → 타입 정의
```
