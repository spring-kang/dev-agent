# Component Dependencies

## Dependency Matrix

| Component | Depends On | Depended By |
|---|---|---|
| C-01: CLI | ConfigManager, WorkflowService | - (진입점) |
| C-02: Orchestrator | PipelineService, GitService, StateManager, ConfigManager, MonitoringService | WorkflowService |
| C-03: ClaudeAgent | Logger | PipelineService |
| C-04: CodexAgent | Logger | PipelineService |
| C-05: ReviewEngine | - (순수 로직) | PipelineService |
| C-06: GitManager | Logger | GitService |
| C-07: ConfigManager | - (순수 로직) | CLI, Orchestrator, WorkflowService |
| C-08: StateManager | Logger | Orchestrator, PipelineService |
| C-09: Logger | - (기본 I/O) | 모든 컴포넌트 |
| C-10: WorkspaceManager | Logger | WorkflowService |

## Communication Patterns

### Pattern 1: 동기식 메서드 호출 (기본)
- 대부분의 컴포넌트 간 통신은 TypeScript async/await 기반 메서드 호출
- 타입 안전한 인터페이스 계약

### Pattern 2: 이벤트 기반 (모니터링)
- MonitoringService는 EventEmitter 패턴으로 각 단계의 이벤트를 수신
- 컴포넌트들이 이벤트를 emit하고 MonitoringService가 subscribe

### Pattern 3: 파일 시스템 교환 (에이전트)
- ClaudeAgent, CodexAgent는 파일 시스템을 통해 산출물 교환
- 인메모리 객체로도 동시에 전달 (병행 방식)

## Data Flow

```
1. 워크플로우 시작
   CLI --[RunOptions]--> WorkflowService --[WorkflowRequest]--> Orchestrator

2. 사이클 실행 (Orchestrator -> PipelineService)
   Orchestrator --[CycleContext]--> PipelineService

3. 기획 단계
   PipelineService --[PlanRequest]--> ClaudeAgent
   ClaudeAgent --[PlanResult]--> PipelineService
   PipelineService --[StateUpdate]--> StateManager

4. 구현 단계
   PipelineService --[ImplementRequest]--> CodexAgent
   CodexAgent --[ImplementResult]--> PipelineService
   PipelineService --[GitRequest]--> GitManager (commit)
   PipelineService --[StateUpdate]--> StateManager

5. 리뷰 단계
   PipelineService --[ReviewRequest]--> ClaudeAgent
   ClaudeAgent --[ReviewRawOutput]--> ReviewEngine
   ReviewEngine --[ReviewResult]--> PipelineService
   PipelineService --[StateUpdate]--> StateManager

6. 판정 분기
   PipelineService --[CycleResult]--> Orchestrator
   IF APPROVED:
     Orchestrator --[PrRequest]--> GitService --> GitManager
   IF CHANGES_REQUESTED:
     Orchestrator --[CycleContext + feedback]--> PipelineService (다음 사이클)

7. 종료
   Orchestrator --[WorkflowResult]--> WorkflowService
   WorkflowService --[Report]--> MonitoringService --> Logger
```

## Dependency Injection Strategy

```typescript
// 컴포지션 루트 (src/container.ts)
// 모든 의존성을 여기서 생성하고 주입

const logger = new Logger(config.logLevel, config.logDir);
const configManager = new ConfigManager();
const stateManager = new StateManager(logger);
const workspaceManager = new WorkspaceManager(logger);
const gitManager = new GitManager(logger);
const claudeAgent = new ClaudeAgent(logger, config.claudePath);
const codexAgent = new CodexAgent(logger, config.codexPath);
const reviewEngine = new ReviewEngine();
const gitService = new GitService(gitManager);
const monitoringService = new MonitoringService(logger);
const pipelineService = new PipelineService(
  claudeAgent, codexAgent, reviewEngine, gitManager, stateManager, logger
);
const orchestrator = new Orchestrator(
  pipelineService, gitService, stateManager, configManager, monitoringService
);
const workflowService = new WorkflowService(
  orchestrator, configManager, workspaceManager, monitoringService
);
```

## Layer Architecture

```
┌─────────────────────────────────────────────┐
│  Layer 1: Presentation (CLI)                │
│  - CLI, 터미널 출력                          │
├─────────────────────────────────────────────┤
│  Layer 2: Application Services              │
│  - WorkflowService, MonitoringService       │
├─────────────────────────────────────────────┤
│  Layer 3: Domain (Core Business Logic)      │
│  - Orchestrator, PipelineService,           │
│    ReviewEngine, GitService                 │
├─────────────────────────────────────────────┤
│  Layer 4: Infrastructure (External I/O)     │
│  - ClaudeAgent, CodexAgent, GitManager,     │
│    StateManager, ConfigManager, Logger,     │
│    WorkspaceManager                         │
└─────────────────────────────────────────────┘
```

**의존성 규칙**: 상위 레이어는 하위 레이어에 의존 가능, 하위는 상위에 의존 불가
