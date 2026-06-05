# NFR Requirements - dev-agent (전체 유닛 통합)

> 로컬 CLI 도구 특성상 모든 유닛이 단일 프로세스에서 실행되므로,
> NFR은 유닛별이 아닌 시스템 전체 단위로 정의한다.

---

## 1. Performance Requirements (성능)

### NFR-PERF-01: CLI 시작 시간

| 항목 | 요구사항 |
|---|---|
| 지표 | CLI 프로세스 시작 → 첫 출력까지 |
| 목표 | < 500ms |
| 최소 허용 | < 1000ms |
| 측정 방법 | `time dev-agent --version` |
| 해당 유닛 | U-05 (CLI) |

**근거**: CLI 도구의 반응성. 사용자가 느리다고 느끼지 않는 임계값.

### NFR-PERF-02: 설정 로드 시간

| 항목 | 요구사항 |
|---|---|
| 지표 | ConfigManager.load() 완료 시간 |
| 목표 | < 100ms |
| 최소 허용 | < 300ms |
| 측정 방법 | 내부 타이머 로깅 |
| 해당 유닛 | U-01 (ConfigManager) |

**근거**: 4개 설정 소스 병합 (default + global + project + env)에 필요한 시간.

### NFR-PERF-03: 상태 파일 I/O

| 항목 | 요구사항 |
|---|---|
| 지표 | StateManager.save() / restore() 시간 |
| 목표 | save < 50ms, restore < 100ms |
| 최소 허용 | save < 200ms, restore < 500ms |
| 측정 방법 | 내부 타이머 |
| 해당 유닛 | U-01 (StateManager) |

**근거**: 상태 저장은 각 단계 완료 시 호출되므로 빠르게 동작해야 함. Atomic write 오버헤드 포함.

### NFR-PERF-04: 에이전트 프로세스 메모리

| 항목 | 요구사항 |
|---|---|
| 지표 | dev-agent 프로세스 자체의 RSS |
| 목표 | < 100MB |
| 최소 허용 | < 200MB |
| 측정 방법 | process.memoryUsage().rss |
| 해당 유닛 | 전체 (U-01~U-05) |

**근거**: Claude/Codex는 별도 프로세스로 실행되므로, 오케스트레이터 자체는 경량이어야 함.

### NFR-PERF-05: 로그 파일 크기 관리

| 항목 | 요구사항 |
|---|---|
| 지표 | 단일 워크플로우 로그 파일 크기 |
| 목표 | < 10MB (일반적 5사이클 기준) |
| 최대 허용 | < 50MB |
| 관리 정책 | 아카이브 시 압축, 30일 후 자동 삭제 |
| 해당 유닛 | U-01 (Logger) |

---

## 2. Reliability Requirements (안정성)

### NFR-REL-01: Graceful Shutdown

| 항목 | 요구사항 |
|---|---|
| 지표 | SIGINT 수신 후 상태 저장 완료까지 |
| 목표 | < 3초 |
| 동작 | 현재 상태 저장 → 자식 프로세스 종료 → 정상 종료 |
| 실패 시 | 2차 SIGINT로 즉시 종료 허용 |
| 해당 유닛 | U-05 (CLI), U-01 (StateManager) |

### NFR-REL-02: 에이전트 타임아웃 복구

| 항목 | 요구사항 |
|---|---|
| 지표 | Claude/Codex 프로세스 무응답 시 복구 |
| 타임아웃 | Claude: 300초, Codex: 600초 |
| 동작 | 타임아웃 → SIGTERM → 5초 대기 → SIGKILL → 에러 전파 |
| 재시도 | 없음 (resume으로 수동 복구) |
| 해당 유닛 | U-02 (Agent Integration) |

### NFR-REL-03: 상태 일관성 보장

| 항목 | 요구사항 |
|---|---|
| 지표 | 비정상 종료 후 상태 파일 무결성 |
| 방법 | Atomic write (write-then-rename) |
| 검증 | restore() 시 JSON 유효성 검증 |
| 실패 시 | 손상된 상태 → 이전 단계로 fallback |
| 해당 유닛 | U-01 (StateManager) |

### NFR-REL-04: Git 명령 실패 복구

| 항목 | 요구사항 |
|---|---|
| 지표 | Git 명령 실패 시 시스템 상태 |
| 타임아웃 | 일반: 30초, 네트워크: 60초 |
| 복구 | 실패 시 워크플로우 상태 저장 후 에러 전파 |
| 데이터 보호 | 커밋된 코드는 항상 보존 |
| 해당 유닛 | U-04 (Git & PR) |

### NFR-REL-05: 병렬 워크플로우 격리

| 항목 | 요구사항 |
|---|---|
| 지표 | 병렬 실행 시 하나의 실패가 다른 것에 미치는 영향 |
| 동작 | Promise.allSettled 사용 → 독립 실행 |
| 격리 수준 | 독립된 로거, 상태 파일, 에러 컨텍스트 |
| 제한 | 동일 프로젝트 병렬 실행 금지 (파일 충돌 방지) |
| 해당 유닛 | U-03 (Orchestrator), U-05 (WorkflowService) |

---

## 3. Security Requirements (보안)

### NFR-SEC-01: 명령 주입 방지

| 항목 | 요구사항 |
|---|---|
| 대상 | child_process.spawn 호출 시 인자 전달 |
| 방법 | shell: false + 인자 배열 방식 (shell injection 불가) |
| 금지 | exec() 사용 금지, 문자열 결합 명령 금지 |
| 해당 유닛 | U-02 (Agent), U-04 (Git) |

### NFR-SEC-02: 프롬프트 인젝션 방어

| 항목 | 요구사항 |
|---|---|
| 대상 | 사용자 입력이 AI 프롬프트에 포함되는 경우 |
| 방법 | 역할 분리 (system/user prompt), 입력 이스케이프 |
| 범위 | taskDescription, projectPath가 프롬프트에 포함될 때 |
| 해당 유닛 | U-02 (Agent Integration) |

### NFR-SEC-03: 파일 시스템 접근 범위 제한

| 항목 | 요구사항 |
|---|---|
| 대상 | 오케스트레이터가 접근하는 파일 경로 |
| 제한 | projectPath 하위 + .ai-workflow/ 내부만 |
| 방법 | 경로 정규화 후 prefix 검증 (path traversal 방지) |
| 해당 유닛 | U-01 (WorkspaceManager, StateManager) |

### NFR-SEC-04: 민감 정보 보호

| 항목 | 요구사항 |
|---|---|
| 대상 | 로그, 리포트, PR 본문에 포함되는 정보 |
| 금지 | API 키, 토큰, 비밀번호가 로그에 기록되지 않도록 |
| 방법 | 환경변수명만 로그 (값은 마스킹), .env 파일 내용 미기록 |
| 해당 유닛 | U-01 (Logger), U-04 (Git - PR body) |

### NFR-SEC-05: 자식 프로세스 권한 제한

| 항목 | 요구사항 |
|---|---|
| 대상 | Claude/Codex 프로세스 |
| 제한 | Codex: --approval-mode full-auto (sandbox 내) |
| 원칙 | 최소 권한 원칙: 필요한 권한만 부여 |
| 해당 유닛 | U-02 (Agent Integration) |

---

## 4. Maintainability Requirements (유지보수성)

### NFR-MNT-01: 코드 구조 규칙

| 항목 | 요구사항 |
|---|---|
| 아키텍처 | 4-Layer (Presentation → Application → Domain → Infrastructure) |
| 의존성 방향 | 상위 → 하위만 허용. 역방향 의존 금지 |
| DI | Manual DI (composition root: container.ts) |
| 해당 유닛 | 전체 |

### NFR-MNT-02: 타입 안전성

| 항목 | 요구사항 |
|---|---|
| TypeScript | strict mode 활성화 |
| any 사용 | 금지 (외부 라이브러리 타입 래핑 필요 시 unknown 사용) |
| 타입 커버리지 | 100% (모든 공개 API에 명시적 타입) |
| 해당 유닛 | 전체 |

### NFR-MNT-03: 테스트 요구사항

| 항목 | 요구사항 |
|---|---|
| 단위 테스트 | 모든 비즈니스 로직 클래스에 대해 작성 |
| 통합 테스트 | 에이전트 호출 mock 기반 워크플로우 테스트 |
| 커버리지 목표 | 라인 커버리지 80% 이상 |
| 프레임워크 | Vitest |
| 해당 유닛 | 전체 |

### NFR-MNT-04: 에러 처리 일관성

| 항목 | 요구사항 |
|---|---|
| 패턴 | 모든 에러는 AppError 하위 클래스 |
| 필수 속성 | code, severity, message |
| severity 분류 | critical: 실행 불가, recoverable: resume 가능 |
| 로깅 | 모든 에러는 발생 시점에 Logger로 기록 |
| 해당 유닛 | 전체 |

### NFR-MNT-05: 인터페이스 기반 설계

| 항목 | 요구사항 |
|---|---|
| 원칙 | 구현이 아닌 인터페이스에 의존 |
| 적용 | 에이전트(Claude/Codex), Git 매니저에 인터페이스 정의 |
| 목적 | 테스트 시 mock 교체 용이, 향후 다른 AI 모델 교체 가능 |
| 해당 유닛 | U-02, U-04 |

---

## 5. Usability Requirements (사용성)

### NFR-USE-01: CLI 도움말

| 항목 | 요구사항 |
|---|---|
| 지원 | --help 플래그로 전체/서브커맨드별 도움말 표시 |
| 내용 | 사용법, 옵션 설명, 예시 1개 이상 |
| 언어 | 영문 (CLI 표준) |
| 해당 유닛 | U-05 (CLI) |

### NFR-USE-02: 에러 메시지 가독성

| 항목 | 요구사항 |
|---|---|
| 형식 | 아이콘 + 사용자 친화적 메시지 + 해결 힌트 |
| 금지 | 스택 트레이스 기본 노출 (--verbose에서만) |
| 언어 | 한국어 (사용자 메시지), 영문 (에러 코드) |
| 해당 유닛 | U-05 (CLI) |

### NFR-USE-03: 진행 상황 표시

| 항목 | 요구사항 |
|---|---|
| TTY 모드 | 스피너 + 현재 단계 + 사이클 번호 + 경과 시간 |
| 비TTY 모드 | 단계 변경 시 한 줄 로그 |
| 색상 | NO_COLOR 환경변수 존중, --no-color 옵션 지원 |
| 해당 유닛 | U-05 (MonitoringService), U-01 (Logger) |

### NFR-USE-04: 완료 출력 명확성

| 항목 | 요구사항 |
|---|---|
| 성공 시 | PR URL + 사이클 수 + 총 소요 시간 |
| 실패 시 | 에러 원인 + resume 안내 |
| 중단 시 | 진행 현황 + resume 안내 |
| 해당 유닛 | U-05 (CLI) |

---

## 6. Scalability Requirements (확장성)

### NFR-SCA-01: 에이전트 교체 가능성

| 항목 | 요구사항 |
|---|---|
| 대상 | Claude Code, Codex CLI |
| 방법 | 인터페이스 기반 추상화 (PlanningAgent, ImplementationAgent) |
| 교체 시 영향 | 새 클래스 구현 + container.ts 수정만으로 교체 가능 |
| 해당 유닛 | U-02 (Agent Integration) |

### NFR-SCA-02: 리뷰 체크 항목 확장

| 항목 | 요구사항 |
|---|---|
| 대상 | ReviewCheckName 타입 |
| 현재 | 7개 (build, tests, security, design, codeQuality, errorHandling, performance) |
| 확장 방법 | 타입에 새 항목 추가 + 프롬프트 수정으로 확장 |
| 해당 유닛 | U-03 (ReviewEngine) |

### NFR-SCA-03: 서브커맨드 확장

| 항목 | 요구사항 |
|---|---|
| 대상 | CLI 서브커맨드 |
| 방법 | Commander.js command() 추가로 새 서브커맨드 등록 |
| 원칙 | 기존 커맨드 수정 없이 새 커맨드 추가 가능 (OCP) |
| 해당 유닛 | U-05 (CLI) |

### NFR-SCA-04: 설정 항목 확장

| 항목 | 요구사항 |
|---|---|
| 대상 | WorkflowConfig |
| 방법 | 새 필드 추가 시 기본값 제공 → 기존 설정 파일 하위 호환 |
| 검증 | 미지정 필드는 기본값으로 채움 (undefined 전파 금지) |
| 해당 유닛 | U-01 (ConfigManager) |

---

## 7. Logging & Observability Requirements (로깅/관측성)

### NFR-LOG-01: 구조화된 로깅

| 항목 | 요구사항 |
|---|---|
| 파일 형식 | JSON Lines (.jsonl) |
| 필수 필드 | timestamp, level, message, workflowId, phase, cycleNumber |
| 터미널 형식 | `[시간] [레벨 아이콘] [phase] message` |
| 해당 유닛 | U-01 (Logger) |

### NFR-LOG-02: 에이전트 입출력 기록

| 항목 | 요구사항 |
|---|---|
| 기록 대상 | Claude/Codex에 전달된 프롬프트(요약), stdout, stderr |
| 민감 정보 | 프롬프트 전문은 debug 레벨에서만 |
| 크기 제한 | stdout 기록 시 최대 10,000자 (초과 시 truncate) |
| 해당 유닛 | U-02 (Agent Integration) |

### NFR-LOG-03: 워크플로우 이벤트 추적

| 항목 | 요구사항 |
|---|---|
| 이벤트 | workflow:start/end, phase:start/complete, cycle:complete |
| 포함 정보 | workflowId, timestamp, duration, 결과 요약 |
| 용도 | MonitoringService 구독 + 로그 기록 |
| 해당 유닛 | U-03 (Orchestrator), U-05 (MonitoringService) |

---

## 8. Compatibility Requirements (호환성)

### NFR-CMP-01: Node.js 버전

| 항목 | 요구사항 |
|---|---|
| 최소 버전 | Node.js 18 LTS |
| 권장 버전 | Node.js 20 LTS |
| 이유 | ES Modules, 네이티브 fetch, fs/promises 안정화 |

### NFR-CMP-02: OS 호환성

| 항목 | 요구사항 |
|---|---|
| 필수 지원 | macOS (개발 환경) |
| 선택 지원 | Linux (CI 환경) |
| 미지원 | Windows (Claude CLI가 Unix 기반) |

### NFR-CMP-03: 외부 도구 의존성

| 항목 | 요구사항 |
|---|---|
| 필수 | git (>= 2.30), claude (CLI), codex (CLI) |
| 선택 | gh (GitHub CLI, PR 생성용) |
| 검증 | 워크플로우 시작 전 PrerequisiteCheck에서 확인 |

---

## 9. NFR 우선순위 매트릭스

| 카테고리 | 우선순위 | 이유 |
|---|---|---|
| Reliability (안정성) | **Critical** | 장시간 실행 + 비용이 드는 AI 호출, 실패 시 복구 필수 |
| Security (보안) | **High** | 외부 프로세스 실행, 프롬프트 인젝션 위험 |
| Maintainability (유지보수성) | **High** | 지속적 확장 예정, 타입 안전성 필수 |
| Usability (사용성) | **Medium** | 개인 사용자 도구, 그래도 에러 메시지는 중요 |
| Performance (성능) | **Medium** | AI 호출이 병목, CLI 자체 성능은 덜 중요 |
| Scalability (확장성) | **Medium** | 개인 사용이지만, 에이전트 교체 가능성 대비 |
| Logging (관측성) | **Medium** | 디버깅과 리포트 생성에 필요 |
| Compatibility (호환성) | **Low** | macOS 전용, 범용성은 추후 고려 |
