# Unit of Work Definitions

## Overview

- **Project Type**: Monolith (단일 Node.js CLI 애플리케이션)
- **Total Units**: 5
- **Decomposition Strategy**: 4-Layer Architecture 기반 논리적 모듈 분해
- **Build Order**: Bottom-Up (U-01 → U-02 → U-04 → U-03 → U-05)
- **Communication**: 혼합 (핵심 흐름: 인터페이스 기반, 모니터링/로깅: 이벤트 기반)

---

## U-01: Core Infrastructure

**Purpose**: 전체 시스템의 기반이 되는 인프라 컴포넌트 모듈. 설정 관리, 로깅, 상태 관리, 워크스페이스 관리를 담당.

**Layer**: Infrastructure

**Components**:
| Component | ID | Responsibility |
|---|---|---|
| Logger | C-09 | 로그 출력 (터미널/파일), 진행 상태 표시, 리포트 생성 |
| ConfigManager | C-07 | 환경변수 + JSON 설정 로드/병합/검증 |
| WorkspaceManager | C-10 | 프로젝트 목록 조회, 경로 검증, CLI 도구 가용성 검증 |
| StateManager | C-08 | 워크플로우 상태 저장/복원, SIGINT 핸들링 |

**Key Interfaces**:
- `Logger`: debug/info/warn/error, progress, generateReport, createChildLogger
- `ConfigManager`: load, show, set, initDefault
- `WorkspaceManager`: listProjects, validateProject, initWorkflowDir, checkPrerequisites
- `StateManager`: save, restore, archive, registerShutdownHandler

**Dependencies**: 없음 (최하위 기반 모듈)

**Story Points**: 8 (US-02: 3pt + US-13: 5pt)

---

## U-02: Agent Integration

**Purpose**: 외부 AI CLI 도구(Claude Code, Codex)와의 통합을 담당하는 모듈. 프로세스 생성, 입출력 캡처, 타임아웃 관리.

**Layer**: Infrastructure

**Components**:
| Component | ID | Responsibility |
|---|---|---|
| ClaudeAgent | C-03 | Claude Code CLI 래퍼 - 기획(plan) 및 리뷰(review) 수행 |
| CodexAgent | C-04 | Codex CLI 래퍼 - 코드 구현(implement) 수행 |

**Key Interfaces**:
- `ClaudeAgent`: plan(PlanRequest), review(ReviewRequest), spawn(args, options)
- `CodexAgent`: implement(ImplementRequest), spawn(args, options)

**Dependencies**: U-01 (Logger)

**Story Points**: 18 (US-04: 8pt + US-05: 5pt + US-06: 5pt)

---

## U-03: Domain Logic

**Purpose**: 핵심 비즈니스 로직을 담당하는 모듈. 파이프라인 실행, 리뷰 판정, 오케스트레이션 흐름 제어.

**Layer**: Domain

**Components**:
| Component | ID | Responsibility |
|---|---|---|
| ReviewEngine | C-05 | 리뷰 결과 파싱, APPROVED/CHANGES_REQUESTED 판정, 재작업 범위 추천 |
| Orchestrator | C-02 | 워크플로우 라이프사이클 관리, 사이클 반복 제어, 병렬 실행 |
| PipelineService | S-02 | Plan → Implement → Review 단일 사이클 실행 |

**Key Interfaces**:
- `ReviewEngine`: evaluate(rawOutput), recommendReworkScope(result)
- `Orchestrator`: execute(request), resume(projectPath), executeCycle(context), executeParallel(requests), getStatus()
- `PipelineService`: executeCycle() - ClaudeAgent.plan → CodexAgent.implement → ClaudeAgent.review → ReviewEngine.evaluate

**Dependencies**: U-01 (Logger, ConfigManager, StateManager), U-02 (ClaudeAgent, CodexAgent), U-04 (GitService)

**Story Points**: 19 (US-07: 8pt + US-08: 3pt + US-09: 5pt + US-10: 3pt)

---

## U-04: Git & PR

**Purpose**: Git 브랜치/커밋/Push/PR 생성 등 모든 Git 관련 작업을 담당하는 모듈.

**Layer**: Infrastructure (GitManager) + Domain (GitService)

**Components**:
| Component | ID | Responsibility |
|---|---|---|
| GitManager | C-06 | Git CLI/gh CLI 래퍼 - 브랜치, 커밋, push, PR 생성 |
| GitService | S-03 | Git 비즈니스 로직 - 워크플로우 init, finalize, PR 본문 생성 |

**Key Interfaces**:
- `GitManager`: createBranch, commit, createPullRequest, push, checkDirtyState
- `GitService`: initWorkflow(GitManager.checkDirtyState + createBranch), finalize(GitManager.push + createPullRequest)

**Dependencies**: U-01 (Logger)

**Story Points**: 8 (US-11: 5pt + US-12: 3pt)

---

## U-05: CLI & Workflow

**Purpose**: 사용자 인터페이스(CLI)와 최상위 워크플로우 서비스, 모니터링을 담당하는 모듈.

**Layer**: Presentation (CLI) + Application (WorkflowService, MonitoringService)

**Components**:
| Component | ID | Responsibility |
|---|---|---|
| CLI | C-01 | 서브커맨드 파싱(run, status, resume, list, config, report), 옵션 검증, 결과 출력 |
| WorkflowService | S-01 | CLI 요청 → 설정 로드 → 사전 조건 검증 → Orchestrator 실행 위임 |
| MonitoringService | S-04 | EventEmitter 기반 상태 모니터링, 리포트 생성 |

**Key Interfaces**:
- `CLI`: main(argv), handleRun, handleStatus, handleResume, handleList, handleConfig, handleReport
- `WorkflowService`: Facade 패턴 - ConfigManager + WorkspaceManager + Orchestrator 조율
- `MonitoringService`: Observer 패턴 - on(phase:start/complete), on(cycle:complete), on(workflow:end)

**Dependencies**: U-01 (ConfigManager, WorkspaceManager, Logger), U-03 (Orchestrator), U-04 (GitService - 간접)

**Story Points**: 29 (US-01: 5pt + US-03: 8pt + US-14: 8pt + US-15: 8pt)

---

## Code Organization Strategy (Greenfield)

```
dev-agent/
├── src/
│   ├── index.ts                        # CLI 진입점 (U-05)
│   ├── container.ts                    # DI 컴포지션 루트 (모든 유닛)
│   ├── types/                          # 공통 타입 정의 (모든 유닛 공유)
│   │   ├── config.ts                   # U-01
│   │   ├── workflow.ts                 # U-03, U-05
│   │   ├── review.ts                   # U-03
│   │   └── agent.ts                    # U-02
│   ├── infrastructure/                 # Infrastructure Layer
│   │   ├── logger/                     # U-01
│   │   │   └── logger.ts
│   │   ├── config/                     # U-01
│   │   │   └── config.manager.ts
│   │   ├── workspace/                  # U-01
│   │   │   └── workspace.manager.ts
│   │   ├── state/                      # U-01
│   │   │   └── state.manager.ts
│   │   ├── agents/                     # U-02
│   │   │   ├── claude.agent.ts
│   │   │   └── codex.agent.ts
│   │   └── git/                        # U-04
│   │       └── git.manager.ts
│   ├── domain/                         # Domain Layer
│   │   ├── orchestrator.ts             # U-03
│   │   ├── review-engine.ts            # U-03
│   │   └── git.service.ts              # U-04
│   ├── services/                       # Application Services Layer
│   │   ├── workflow.service.ts         # U-05
│   │   ├── pipeline.service.ts         # U-03
│   │   └── monitoring.service.ts       # U-05
│   └── utils/                          # 공통 유틸리티
├── tests/
│   ├── unit/
│   │   ├── infrastructure/             # U-01, U-02, U-04
│   │   ├── domain/                     # U-03, U-04
│   │   └── services/                   # U-03, U-05
│   ├── integration/                    # 유닛 간 통합 테스트
│   └── property/                       # PBT 테스트
├── package.json
├── tsconfig.json
├── .gitignore                          # projects/ 포함
└── projects/                           # 대상 프로젝트 워크스페이스 (.gitignore)
```

---

## Build Order (CONSTRUCTION Phase)

```
Phase 1: U-01 Core Infrastructure (기반)
  └── Logger, ConfigManager, WorkspaceManager, StateManager
      └── 다른 모든 유닛이 의존하는 기반 모듈
      └── 공통 타입 정의 (types/) 포함

Phase 2: U-02 Agent Integration
  └── ClaudeAgent, CodexAgent
      └── U-01의 Logger에만 의존
      └── 외부 CLI 프로세스 래핑

Phase 3: U-04 Git & PR
  └── GitManager, GitService
      └── U-01의 Logger에만 의존
      └── Git/gh CLI 프로세스 래핑

Phase 4: U-03 Domain Logic
  └── ReviewEngine, Orchestrator, PipelineService
      └── U-01, U-02, U-04 모두 사용
      └── 핵심 비즈니스 로직 조합

Phase 5: U-05 CLI & Workflow
  └── CLI, WorkflowService, MonitoringService
      └── 모든 유닛 통합
      └── 최종 진입점 및 사용자 인터페이스
```

> **Note**: U-02와 U-04는 서로 의존하지 않으므로 병렬 구현 가능. 단, 순차 진행 시 U-02 → U-04 순서 권장 (Agent가 핵심 파이프라인의 더 중요한 부분).

---

## Unit Summary

| Unit | Components | Stories | Points | Build Phase |
|---|---|---|---|---|
| U-01: Core Infrastructure | 4 | 2 | 8 | Phase 1 |
| U-02: Agent Integration | 2 | 3 | 18 | Phase 2 |
| U-04: Git & PR | 2 | 2 | 8 | Phase 3 |
| U-03: Domain Logic | 3 | 4 | 19 | Phase 4 |
| U-05: CLI & Workflow | 3 | 4 | 29 | Phase 5 |
| **Total** | **14** | **15** | **82** | **5 Phases** |
