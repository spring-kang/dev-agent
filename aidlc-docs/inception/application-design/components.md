# Components

## C-01: CLI (Command Line Interface)

**Purpose**: 사용자 입력을 받아 적절한 서비스로 라우팅하는 진입점

**Responsibilities**:
- 서브커맨드 파싱 (`run`, `status`, `resume`, `list`, `config`, `report`)
- CLI 옵션/인자 검증
- 글로벌 설정과 프로젝트별 설정 병합
- 서비스 레이어 호출 및 결과 출력

**Interface**:
- Input: 커맨드라인 인자 (argv)
- Output: 터미널 출력 (stdout/stderr), exit code

---

## C-02: Orchestrator (오케스트레이터)

**Purpose**: 기획 -> 구현 -> 리뷰 사이클의 전체 흐름을 제어하는 핵심 엔진

**Responsibilities**:
- 워크플로우 라이프사이클 관리 (시작, 반복, 완료, 중단)
- 단계별 에이전트 호출 순서 제어 (Planning -> Implementation -> Review)
- 반복 사이클 카운트 및 최대 횟수 관리
- 단계 간 컨텍스트(피드백, 산출물) 전달
- 워크플로우 상태 저장/복원 (실패 지점 재시작)
- 병렬 워크플로우 실행 관리 (Promise 기반)

**Interface**:
- Input: WorkflowRequest (프로젝트 경로, 작업 설명, 설정)
- Output: WorkflowResult (상태, PR URL, 리뷰 히스토리)

---

## C-03: ClaudeAgent (Claude Code CLI 래퍼)

**Purpose**: Claude Code CLI를 호출하여 기획/리뷰를 수행하는 에이전트

**Responsibilities**:
- Claude Code CLI 프로세스 생성 및 관리
- 기획 모드: 작업 설명 -> 산출물(requirements, impl-spec, test-scenarios) 생성 지시
- 리뷰 모드: 코드 변경사항 -> 리뷰 결과 생성 지시
- stdout 파이프로 실시간 출력 캡처
- 산출물 파일 읽기 및 파싱
- 타임아웃 및 에러 처리

**Interface**:
- Input: AgentRequest (모드, 프롬프트, cwd, 타임아웃)
- Output: AgentResponse (stdout, 산출물 파일 경로들, exit code)

---

## C-04: CodexAgent (Codex CLI 래퍼)

**Purpose**: Codex CLI를 호출하여 코드를 생성하는 에이전트

**Responsibilities**:
- Codex CLI 프로세스 생성 및 관리
- 구현 지시서(implementation-spec.md)를 프롬프트로 전달
- 코드 생성 결과 캡처
- 변경된 파일 목록 수집
- 타임아웃 및 에러 처리

**Interface**:
- Input: AgentRequest (프롬프트, cwd, 타임아웃)
- Output: AgentResponse (stdout, 변경 파일 목록, exit code)

---

## C-05: ReviewEngine (리뷰 판정 엔진)

**Purpose**: Claude Code의 리뷰 결과를 파싱하고 APPROVED/CHANGES_REQUESTED를 판정

**Responsibilities**:
- 리뷰 결과 파싱 (Markdown/JSON)
- 7개 체크리스트 항목별 통과/실패 판정
- 전체 판정 결과 생성 (APPROVED / CHANGES_REQUESTED)
- 피드백 구조화 (severity, location, description, suggestion)
- 재작업 범위 결정 지원 (부분 수정 vs 전체 재기획)

**Interface**:
- Input: ReviewRawOutput (Claude의 리뷰 원문)
- Output: ReviewResult (status, findings[], summary, recommendation)

---

## C-06: GitManager (Git/PR 관리자)

**Purpose**: Git 브랜치, 커밋, PR 생성 등 Git 관련 작업 관리

**Responsibilities**:
- 브랜치 자동 생성 (`ai/<timestamp>-<task-summary>`)
- 사이클별 자동 커밋 (커밋 메시지에 사이클 번호 포함)
- 변경사항 감지 및 경고 (dirty working tree)
- `gh pr create`를 통한 자동 PR 생성
- PR 본문 생성 (작업 요약, 리뷰 히스토리, AI 생성 표시)
- remote push

**Interface**:
- Input: GitRequest (프로젝트 경로, 작업 유형, 컨텍스트)
- Output: GitResult (브랜치명, 커밋 SHA, PR URL)

---

## C-07: ConfigManager (설정 관리자)

**Purpose**: 글로벌/프로젝트별 설정을 로드하고 병합하는 설정 관리자

**Responsibilities**:
- 환경변수에서 설정 읽기 (DEV_AGENT_* prefix)
- 글로벌 JSON 설정 파일 로드 (~/.dev-agent/config.json)
- 프로젝트별 설정 파일 로드 (<project>/.ai-workflow/config.json)
- CLI 옵션에서 설정 오버라이드
- 설정 우선순위: CLI 옵션 > 환경변수 > 프로젝트 설정 > 글로벌 설정 > 기본값
- 설정 검증

**Interface**:
- Input: ConfigSources (env, globalPath, projectPath, cliOptions)
- Output: WorkflowConfig (병합된 최종 설정)

---

## C-08: StateManager (상태 관리자)

**Purpose**: 워크플로우 실행 상태를 저장/복원하여 실패 지점 재시작 지원

**Responsibilities**:
- 각 단계 완료 시 상태 저장 (.ai-workflow/current/state.json)
- 실패 시 마지막 저장 상태 복원
- 현재 사이클 번호, 단계, 산출물 경로 등 추적
- SIGINT/SIGTERM 시 현재 상태 저장
- 워크플로우 완료 시 히스토리로 아카이브

**Interface**:
- Input: StateUpdate (단계, 사이클, 상태 데이터)
- Output: WorkflowState (복원된 상태 또는 저장 확인)

---

## C-09: Logger (로거)

**Purpose**: 터미널 출력, 로그 파일, 대시보드/리포트 생성

**Responsibilities**:
- 터미널 실시간 출력 (현재 단계, 사이클 번호, 경과 시간)
- 로그 파일 저장 (.ai-workflow/logs/)
- 로그 레벨 지원 (debug, info, warn, error)
- 워크플로우 완료 후 요약 리포트 생성
- 병렬 실행 시 워크플로우별 로그 분리

**Interface**:
- Input: LogEntry (level, message, context, timestamp)
- Output: 터미널 출력, 로그 파일, 리포트 파일

---

## C-10: WorkspaceManager (워크스페이스 관리자)

**Purpose**: projects/ 디렉토리 및 대상 프로젝트 관리

**Responsibilities**:
- projects/ 디렉토리 내 프로젝트 목록 조회
- 대상 프로젝트 경로 검증 (Git 레포 여부, remote 설정 여부)
- .ai-workflow/ 디렉토리 초기화
- CLI 도구 가용성 검증 (claude, codex, gh)
- 프로젝트 사전 조건 체크

**Interface**:
- Input: ProjectPath (상대/절대 경로)
- Output: ProjectInfo (경로, Git 상태, 사전 조건 검증 결과)
