# Code Generation Plan - dev-agent

## 빌드 순서

| Phase | Unit | 산출물 | 의존성 |
|---|---|---|---|
| 0 | Project Setup | package.json, tsconfig.json, 기본 설정 파일 | 없음 |
| 1 | U-01 Core Infrastructure | types/, components/ (Logger, ConfigManager, WorkspaceManager, StateManager) | Setup |
| 2 | U-02 Agent Integration | components/ (ClaudeAgent, CodexAgent) | U-01 |
| 3 | U-04 Git & PR | components/ (GitManager), services/ (GitService) | U-01 |
| 4 | U-03 Domain Logic | components/ (ReviewEngine), services/ (PipelineService), orchestrator/ | U-01, U-02, U-04 |
| 5 | U-05 CLI & Workflow | cli/, services/ (WorkflowService, MonitoringService), container.ts, index.ts | 전체 |

---

## Phase 0: Project Setup

- [x] Step 0.1: package.json 생성 (ESM, bin, scripts)
- [x] Step 0.2: tsconfig.json 생성 (strict, NodeNext)
- [x] Step 0.3: vitest.config.ts 생성
- [x] Step 0.4: .gitignore 생성
- [x] Step 0.5: .eslintrc.js, .prettierrc 생성
- [x] Step 0.6: src/ 디렉토리 구조 생성

## Phase 1: U-01 Core Infrastructure

- [x] Step 1.1: src/types/errors.ts - AppError 및 하위 에러 클래스
- [x] Step 1.2: src/types/config.ts - WorkflowConfig, ValidationResult, PrerequisiteResult
- [x] Step 1.3: src/types/workflow.ts - WorkflowState, WorkflowPhase, WorkflowArtifacts
- [x] Step 1.4: src/types/events.ts - WorkflowEvent 타입들
- [x] Step 1.5: src/components/logger.ts - Logger (컬러+아이콘, JSON Lines, 마스킹)
- [x] Step 1.6: src/components/config-manager.ts - ConfigManager (4-source 병합, 검증)
- [x] Step 1.7: src/components/workspace-manager.ts - WorkspaceManager (프로젝트 검증, CLI 확인)
- [x] Step 1.8: src/components/state-manager.ts - StateManager (atomic write, restore, archive)

## Phase 2: U-02 Agent Integration

- [x] Step 2.1: src/types/agent.ts - PlanRequest, ImplementRequest, ReviewRequest 등
- [x] Step 2.2: src/components/claude-agent.ts - ClaudeAgent (plan, review, spawn)
- [x] Step 2.3: src/components/codex-agent.ts - CodexAgent (implement, spawn)

## Phase 3: U-04 Git & PR

- [x] Step 3.1: src/types/git.ts - PrRequest, GitInitResult, FinalizeContext 등
- [x] Step 3.2: src/components/git-manager.ts - GitManager (branch, commit, push, PR)
- [x] Step 3.3: src/services/git.service.ts - GitService (initWorkflow, finalize)

## Phase 4: U-03 Domain Logic

- [x] Step 4.1: src/types/review.ts - ReviewResult, ReviewCheck, ReviewFinding
- [x] Step 4.2: src/components/review-engine.ts - ReviewEngine (evaluate, recommendReworkScope)
- [x] Step 4.3: src/services/pipeline.service.ts - PipelineService (executeCycle)
- [x] Step 4.4: src/orchestrator/orchestrator.ts - Orchestrator (execute, resume, executeParallel)

## Phase 5: U-05 CLI & Workflow

- [x] Step 5.1: src/services/monitoring.service.ts - MonitoringService (이벤트, 리포트)
- [x] Step 5.2: src/services/workflow.service.ts - WorkflowService (preflight, execute, resume)
- [x] Step 5.3: src/cli/formatters/ - 에러 포매터, 리포트 포매터, 진행 표시
- [x] Step 5.4: src/cli/commands/ - 서브커맨드 핸들러 (run, status, resume, list, config, report)
- [x] Step 5.5: src/cli/cli.ts - CLI 메인 (Commander.js 설정)
- [x] Step 5.6: src/container.ts - DI 컴포지션 루트
- [x] Step 5.7: src/index.ts - 진입점 (shebang + bootstrap)
