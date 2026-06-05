# Services

## S-01: WorkflowService (워크플로우 서비스)

**Purpose**: CLI 요청을 받아 Orchestrator를 통해 전체 워크플로우를 실행하는 최상위 서비스

**Responsibilities**:
- CLI로부터 요청을 받아 WorkflowRequest 구성
- ConfigManager를 통해 설정 로드
- WorkspaceManager를 통해 사전 조건 검증
- Orchestrator에게 워크플로우 실행 위임
- 워크플로우 결과를 Logger를 통해 출력

**Orchestration Pattern**: Facade
- CLI와 내부 컴포넌트 사이의 단순한 인터페이스 제공
- 요청 검증 -> 설정 로드 -> 사전 조건 체크 -> 오케스트레이션 실행

```
CLI --> WorkflowService --> ConfigManager (설정 로드)
                       --> WorkspaceManager (검증)
                       --> Orchestrator (실행)
                       --> Logger (결과 출력)
```

---

## S-02: PipelineService (파이프라인 서비스)

**Purpose**: 단일 사이클 내의 Planning -> Implementation -> Review 파이프라인을 실행

**Responsibilities**:
- ClaudeAgent를 호출하여 기획 산출물 생성
- CodexAgent를 호출하여 코드 구현
- ClaudeAgent를 호출하여 코드 리뷰 수행
- ReviewEngine을 통해 리뷰 결과 판정
- 각 단계 간 데이터(산출물, 피드백) 전달
- 각 단계 완료 시 StateManager를 통해 상태 저장

**Orchestration Pattern**: Pipeline / Chain of Responsibility
- 각 단계가 순차적으로 실행되며 이전 단계의 출력이 다음 단계의 입력

```
PipelineService.executeCycle():
  1. ClaudeAgent.plan()       --> PlanResult (산출물)
  2. CodexAgent.implement()   --> ImplementResult (코드 변경)
  3. GitManager.commit()      --> 커밋 SHA
  4. ClaudeAgent.review()     --> ReviewRawOutput
  5. ReviewEngine.evaluate()  --> ReviewResult (APPROVED/CHANGES_REQUESTED)
```

---

## S-03: GitService (Git 서비스)

**Purpose**: Git 관련 작업을 조율하는 서비스

**Responsibilities**:
- 워크플로우 시작 시 브랜치 생성 조율
- 사이클별 커밋 조율
- PR 생성 조율 (본문 생성 포함)
- dirty state 경고 조율

**Orchestration Pattern**: Service Layer
- GitManager 컴포넌트를 래핑하여 비즈니스 로직 추가 (PR 본문 생성, 커밋 메시지 포맷 등)

```
GitService.initWorkflow():
  1. GitManager.checkDirtyState()  --> 경고 여부
  2. GitManager.createBranch()     --> 브랜치명

GitService.finalize():
  1. GitManager.push()             --> remote push
  2. GitManager.createPullRequest()--> PR URL
```

---

## S-04: MonitoringService (모니터링 서비스)

**Purpose**: 워크플로우 진행 상태 모니터링 및 리포트 생성

**Responsibilities**:
- 실시간 터미널 진행 상태 업데이트
- 로그 파일 기록 조율
- 워크플로우 완료 후 요약 리포트 생성
- 병렬 실행 시 워크플로우별 상태 집계

**Orchestration Pattern**: Observer
- 각 컴포넌트의 이벤트를 수신하여 로깅/모니터링

```
MonitoringService:
  - on("phase:start")    --> Logger.progress()
  - on("phase:complete") --> Logger.info()
  - on("cycle:complete") --> 상태 업데이트
  - on("workflow:end")   --> Logger.generateReport()
```

---

## Service Interaction Overview

```
                   +-----------+
                   |    CLI    |
                   +-----------+
                        |
                        v
               +------------------+
               | WorkflowService  |
               +------------------+
               /        |         \
              v         v          v
  +---------------+ +----------+ +------------------+
  | ConfigManager | | Workspace| | MonitoringService |
  +---------------+ | Manager  | +------------------+
                     +----------+        |
                        |                v
                        v           +--------+
               +----------------+   | Logger |
               |  Orchestrator  |   +--------+
               +----------------+
                    |       |
            +-------+       +--------+
            v                        v
   +------------------+     +-------------+
   | PipelineService  |     | GitService  |
   +------------------+     +-------------+
    /       |       \           |
   v        v        v          v
+-------+ +-------+ +------+ +----------+
|Claude | |Codex  | |Review| |  Git     |
|Agent  | |Agent  | |Engine| |  Manager |
+-------+ +-------+ +------+ +----------+
                        |
                        v
               +----------------+
               | StateManager   |
               +----------------+
```
