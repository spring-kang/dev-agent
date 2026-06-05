# Application Design Plan

## Design Scope
Greenfield Node.js (TypeScript) CLI 오케스트레이터 - 멀티 에이전트 개발 파이프라인

## Execution Checklist

### Phase 1: 컴포넌트 식별
- [x] 1.1 핵심 컴포넌트 식별 및 책임 정의
- [x] 1.2 컴포넌트 인터페이스 정의

### Phase 2: 메서드 시그니처 정의
- [x] 2.1 각 컴포넌트의 주요 메서드 시그니처 정의
- [x] 2.2 입출력 타입 정의

### Phase 3: 서비스 레이어 설계
- [x] 3.1 서비스 정의 및 오케스트레이션 패턴
- [x] 3.2 서비스 간 상호작용 설계

### Phase 4: 의존성 및 데이터 흐름
- [x] 4.1 컴포넌트 의존성 매트릭스
- [x] 4.2 데이터 흐름 다이어그램

### Phase 5: 통합 설계 문서
- [x] 5.1 전체 설계 통합 문서 작성
- [x] 5.2 설계 검증 (완전성, 일관성)

---

## Questions

아래 질문의 `[Answer]:` 태그 뒤에 답변을 기입해 주세요.

## Question 1
CLI 도구의 명령어 체계를 어떤 방식으로 구성할까요?

A) 단일 명령 + 서브커맨드 (예: `dev-agent run`, `dev-agent status`, `dev-agent resume`)

B) 각 기능별 독립 명령어 (예: `dev-agent-run`, `dev-agent-status`)

C) 인터랙티브 REPL 모드 (시작 후 명령어 입력)

X) Other (please describe after [Answer]: tag below)

[Answer]: A (AI 추천 - 서브커맨드 패턴, Git/Docker/gh 등 성숙한 CLI 표준)

## Question 2
에이전트(Claude, Codex) 호출 시 출력 결과를 어떤 방식으로 캡처할까요?

A) stdout/stderr 파이프 캡처 (child_process.spawn + pipe)

B) 파일 기반 교환 (에이전트에게 파일에 쓰도록 지시하고 읽기)

C) stdout 파이프 + 파일 기반 병행 (실시간 출력은 파이프, 산출물은 파일)

X) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 3
컴포넌트 간 데이터 전달 방식은 어떻게 할까요?

A) 인메모리 객체 전달 (TypeScript 인터페이스 기반)

B) 파일 시스템 기반 (각 단계가 파일을 읽고 쓰기)

C) 인메모리 + 파일 시스템 병행 (인메모리로 전달하되 파일에도 persist)

X) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 4
병렬 워크플로우 실행 시 프로세스 관리 방식은 무엇으로 할까요?

A) Node.js Worker Threads (CPU 바운드 작업에 적합)

B) 비동기 Promise 기반 (I/O 바운드에 적합, CLI 호출은 대부분 I/O)

C) 별도 Node.js 프로세스 Fork (완전 격리)

X) Other (please describe after [Answer]: tag below)

[Answer]: B (AI 추천 - CLI 호출은 I/O 바운드, Promise/async-await로 spawn 래핑이 최적)

## Question 5
설정 관리 방식은 어떤 패턴을 사용할까요?

A) cosmiconfig 패턴 (package.json, .rc, config.js 등 다양한 소스 자동 탐색)

B) 단일 JSON 설정 파일 (.ai-workflow/config.json)

C) 환경변수 + JSON 설정 파일 계층 구조

X) Other (please describe after [Answer]: tag below)

[Answer]: C
