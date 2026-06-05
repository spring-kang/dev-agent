# Integration Test Instructions

## Purpose
유닛 간 상호작용을 테스트하여 올바른 데이터 흐름과 에러 전파를 검증합니다.

## Test Scenarios

### Scenario 1: Orchestrator → PipelineService → Agent 통합
- **Description**: Orchestrator가 PipelineService를 호출하고, PipelineService가 ClaudeAgent/CodexAgent를 순차 호출하는 전체 사이클 흐름 검증
- **Setup**: ClaudeAgent, CodexAgent, GitManager를 모킹. 실제 ReviewEngine(순수 로직)은 그대로 사용.
- **Test Steps**:
  1. Orchestrator.execute() 호출
  2. PipelineService.executeCycle()이 Planning → Implementation → Commit → Review → Evaluate 순서 확인
  3. ReviewEngine.evaluate() 결과에 따라 다음 사이클 또는 PR 생성 분기 확인
- **Expected Results**: APPROVED 시 GitService.finalize() 호출, CHANGES_REQUESTED 시 다음 사이클 진행
- **Cleanup**: 임시 상태 파일 삭제

### Scenario 2: ConfigManager → WorkflowService → Orchestrator 설정 전파
- **Description**: CLI에서 설정한 옵션이 WorkflowService → Orchestrator까지 올바르게 전달되는지 검증
- **Setup**: ConfigManager에 커스텀 설정 (maxIterations=2), 파일시스템 모킹
- **Test Steps**:
  1. WorkflowService.execute() 호출
  2. Orchestrator가 maxIterations=2를 준수하는지 확인
  3. 2 사이클 후 최대 반복 도달 처리 확인
- **Expected Results**: maxIterations에 맞게 사이클이 제한됨
- **Cleanup**: 환경변수 복원

### Scenario 3: StateManager → Orchestrator Resume 흐름
- **Description**: 상태 저장/복원을 통한 워크플로우 재개 기능 검증
- **Setup**: StateManager에 저장된 중간 상태 (cycle 2, phase: review)
- **Test Steps**:
  1. StateManager.restore()로 상태 복원
  2. Orchestrator.resume()으로 워크플로우 재개
  3. 복원된 사이클부터 실행 재개 확인
- **Expected Results**: cycle 2부터 재개, 이전 상태 유지
- **Cleanup**: 임시 상태 파일 삭제

### Scenario 4: EventEmitter → MonitoringService 이벤트 흐름
- **Description**: 파이프라인 실행 중 발생하는 이벤트가 MonitoringService에 올바르게 전달되는지 검증
- **Setup**: EventEmitter 인스턴스 공유, MonitoringService 연결
- **Test Steps**:
  1. MonitoringService.start() 호출
  2. PipelineService가 phase:start, phase:complete, cycle:complete 이벤트 발행
  3. MonitoringService에서 이벤트 수신 및 기록 확인
- **Expected Results**: 모든 이벤트가 올바른 순서로 수신됨
- **Cleanup**: MonitoringService.stop() 호출

## Setup Integration Test Environment

### 1. Start Required Services
```bash
# 외부 서비스 불필요 (단일 프로세스 CLI 도구)
# Agent CLI 모킹으로 충분
```

### 2. Configure Test Environment
```bash
# 테스트용 임시 디렉토리 생성
mkdir -p /tmp/dev-agent-test
```

## Run Integration Tests

### 1. Execute Integration Test Suite
```bash
npx vitest run tests/integration/
```

### 2. Verify Service Interactions
- **Test Scenarios**: 4개 통합 시나리오
- **Expected Results**: 전체 통과
- **Logs Location**: 터미널 출력

### 3. Cleanup
```bash
rm -rf /tmp/dev-agent-test
```

## Notes
- Agent CLI (claude, codex, gh)는 모킹 처리 (실제 호출 없음)
- 파일시스템 접근은 vi.mock("node:fs/promises")로 모킹
- child_process.execFile은 vi.mock("node:child_process")로 모킹
- 순수 도메인 로직(ReviewEngine)은 실제 인스턴스 사용
