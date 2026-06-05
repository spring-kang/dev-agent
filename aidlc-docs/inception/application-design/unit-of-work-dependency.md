# Unit of Work Dependencies

## Dependency Matrix

| Unit | Depends On | Depended By |
|---|---|---|
| U-01: Core Infrastructure | - (없음) | U-02, U-03, U-04, U-05 |
| U-02: Agent Integration | U-01 | U-03 |
| U-03: Domain Logic | U-01, U-02, U-04 | U-05 |
| U-04: Git & PR | U-01 | U-03, U-05 |
| U-05: CLI & Workflow | U-01, U-03, U-04 | - (진입점) |

---

## Dependency Graph

```
U-05: CLI & Workflow
  │
  ├──▶ U-03: Domain Logic
  │      │
  │      ├──▶ U-02: Agent Integration
  │      │      │
  │      │      └──▶ U-01: Core Infrastructure
  │      │
  │      ├──▶ U-04: Git & PR
  │      │      │
  │      │      └──▶ U-01: Core Infrastructure
  │      │
  │      └──▶ U-01: Core Infrastructure
  │
  ├──▶ U-04: Git & PR (간접)
  │
  └──▶ U-01: Core Infrastructure
```

---

## Communication Patterns (유닛 간)

### Pattern 1: 인터페이스 기반 직접 호출 (핵심 흐름)

핵심 워크플로우 데이터 흐름에 사용. TypeScript 인터페이스 계약에 의한 타입 안전한 호출.

| From | To | Interface | Data |
|---|---|---|---|
| U-05 (WorkflowService) | U-01 (ConfigManager) | `ConfigManager.load()` | WorkflowConfig |
| U-05 (WorkflowService) | U-01 (WorkspaceManager) | `WorkspaceManager.validateProject()` | ValidationResult |
| U-05 (WorkflowService) | U-03 (Orchestrator) | `Orchestrator.execute()` | WorkflowRequest → WorkflowResult |
| U-03 (Orchestrator) | U-01 (StateManager) | `StateManager.save/restore()` | WorkflowState |
| U-03 (PipelineService) | U-02 (ClaudeAgent) | `ClaudeAgent.plan/review()` | PlanRequest/ReviewRequest → PlanResult/ReviewRawOutput |
| U-03 (PipelineService) | U-02 (CodexAgent) | `CodexAgent.implement()` | ImplementRequest → ImplementResult |
| U-03 (PipelineService) | U-03 (ReviewEngine) | `ReviewEngine.evaluate()` | ReviewRawOutput → ReviewResult |
| U-03 (Orchestrator) | U-04 (GitService) | `GitService.initWorkflow/finalize()` | 브랜치명, PR URL |
| U-03 (PipelineService) | U-04 (GitManager) | `GitManager.commit()` | 커밋 SHA |

### Pattern 2: 이벤트 기반 (모니터링/로깅)

모니터링, 로깅 등 부가 기능에 사용. EventEmitter 패턴으로 느슨한 결합.

| Emitter | Event | Subscriber | Purpose |
|---|---|---|---|
| U-03 (Orchestrator) | `phase:start` | U-05 (MonitoringService) | 단계 시작 알림 |
| U-03 (Orchestrator) | `phase:complete` | U-05 (MonitoringService) | 단계 완료 알림 |
| U-03 (PipelineService) | `cycle:complete` | U-05 (MonitoringService) | 사이클 완료 알림 |
| U-03 (Orchestrator) | `workflow:end` | U-05 (MonitoringService) | 워크플로우 종료 알림 |
| 모든 유닛 | `log:*` | U-01 (Logger) | 로그 이벤트 (선택적) |

---

## Data Flow (유닛 관점)

```
1. 워크플로우 시작
   U-05 (CLI) ──[RunOptions]──▶ U-05 (WorkflowService)
                                    │
                                    ├──▶ U-01 (ConfigManager): 설정 로드
                                    ├──▶ U-01 (WorkspaceManager): 프로젝트 검증
                                    │
                                    ▼
                                U-03 (Orchestrator)
                                    │
                                    ├──▶ U-04 (GitService): 브랜치 생성
                                    │
                                    ▼ ◀── 반복 (최대 N회) ──┐
                                U-03 (PipelineService)       │
                                    │                        │
                                    ├──▶ U-02 (ClaudeAgent)  │ CHANGES_
                                    │     └── 기획 산출물    │ REQUESTED
                                    │                        │
                                    ├──▶ U-02 (CodexAgent)   │
                                    │     └── 코드 생성      │
                                    │                        │
                                    ├──▶ U-04 (GitManager)   │
                                    │     └── 커밋           │
                                    │                        │
                                    ├──▶ U-02 (ClaudeAgent)  │
                                    │     └── 코드 리뷰      │
                                    │                        │
                                    ├──▶ U-03 (ReviewEngine) │
                                    │     └── 판정 ──────────┘
                                    │           │
                                    │        APPROVED
                                    ▼
                                U-04 (GitService): PR 생성
                                    │
                                    ▼
                                결과 출력 (PR URL)
```

---

## Dependency Injection (유닛 관점)

```typescript
// container.ts - DI 컴포지션 루트 (유닛 순서대로 생성)

// ── Phase 1: U-01 Core Infrastructure ──
const logger = new Logger(config.logLevel, config.logDir);
const configManager = new ConfigManager();
const stateManager = new StateManager(logger);
const workspaceManager = new WorkspaceManager(logger);

// ── Phase 2: U-02 Agent Integration ──
const claudeAgent = new ClaudeAgent(logger, config.claudePath);
const codexAgent = new CodexAgent(logger, config.codexPath);

// ── Phase 3: U-04 Git & PR ──
const gitManager = new GitManager(logger);
const gitService = new GitService(gitManager);

// ── Phase 4: U-03 Domain Logic ──
const reviewEngine = new ReviewEngine();
const pipelineService = new PipelineService(
  claudeAgent, codexAgent, reviewEngine, gitManager, stateManager, logger
);
const orchestrator = new Orchestrator(
  pipelineService, gitService, stateManager, configManager, monitoringService
);

// ── Phase 5: U-05 CLI & Workflow ──
const monitoringService = new MonitoringService(logger);
const workflowService = new WorkflowService(
  orchestrator, configManager, workspaceManager, monitoringService
);
```

---

## Circular Dependency Check

| Check | Result | Notes |
|---|---|---|
| U-01 ↔ U-02 | No cycle | U-02 → U-01 (단방향) |
| U-01 ↔ U-03 | No cycle | U-03 → U-01 (단방향) |
| U-01 ↔ U-04 | No cycle | U-04 → U-01 (단방향) |
| U-01 ↔ U-05 | No cycle | U-05 → U-01 (단방향) |
| U-02 ↔ U-03 | No cycle | U-03 → U-02 (단방향) |
| U-02 ↔ U-04 | No cycle | 의존 없음 |
| U-02 ↔ U-05 | No cycle | 의존 없음 (U-05는 U-02를 직접 참조하지 않음) |
| U-03 ↔ U-04 | No cycle | U-03 → U-04 (단방향) |
| U-03 ↔ U-05 | No cycle | U-05 → U-03 (단방향) |
| U-04 ↔ U-05 | No cycle | U-05 → U-04 (간접, Orchestrator 경유) |

**Result**: 순환 의존성 없음. 모든 의존 방향이 상위 → 하위 또는 같은 레벨 내에서 단방향.
