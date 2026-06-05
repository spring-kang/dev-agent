# Business Logic Model - U-05: CLI & Workflow

## 1. CLI (C-01)

### 1.1 CLI 초기화 및 커맨드 파싱

**main(argv: string[]): Promise<void>**

```
Input: process.argv

처리 로직:
1. Commander.js 프로그램 설정:
   - name: "dev-agent"
   - version: CLI_VERSION
   - description: CLI_DESCRIPTION

2. 서브커맨드 등록:
   - run: 워크플로우 시작
   - status: 상태 조회
   - resume: 워크플로우 재시작
   - list: 프로젝트 목록
   - config: 설정 관리
   - report: 리포트 생성

3. 글로벌 옵션:
   - --verbose: 상세 로그
   - --no-color: 색상 비활성화

4. 에러 핸들링:
   - Commander.js parseAsync() 호출
   - 미처리 에러 catch → formatError() → stderr 출력 → exit(1)

반환: void (process.exit으로 종료)
```

### 1.2 Run 커맨드 처리

**handleRun(options: RunOptions): Promise<void>**

```
Input: RunOptions { project, task, maxIterations?, parallel?, config?, verbose? }

처리 로직:
1. 옵션 검증:
   - project 경로 존재 확인
   - task 비어있지 않은지 확인

2. 병렬 실행 여부 판단:
   IF options.parallel && options.parallel.length > 0:
     → handleParallelRun(options)
   ELSE:
     → handleSingleRun(options)

3. 단일 실행 (handleSingleRun):
   a. WorkflowRequest 구성:
      { projectPath: resolve(project), taskDescription: task, config: overrides }
   b. WorkflowService.execute(request)
   c. 결과 출력:
      - success → 완료 메시지 + PR URL
      - stopped → 중단 메시지 + resume 안내
      - failed → 에러 메시지 + 해결 힌트

4. 병렬 실행 (handleParallelRun):
   a. 모든 프로젝트 경로를 WorkflowRequest[]로 변환
   b. WorkflowService.executeParallel(requests)
   c. 각 결과를 순서대로 요약 출력

반환: void (종료 코드는 process.exitCode로 설정)
```

### 1.3 Status 커맨드 처리

**handleStatus(options: StatusOptions): Promise<void>**

```
Input: StatusOptions { project?, json? }

처리 로직:
1. WorkflowService를 통해 상태 조회:
   IF options.project:
     statuses = [Orchestrator.getStatus(project)]
   ELSE:
     statuses = Orchestrator.getStatus() // 전체

2. 출력 형식 결정:
   IF options.json:
     JSON.stringify(statuses, null, 2) → stdout
   ELSE:
     formatStatusTable(statuses) → stdout

3. 상태 없으면:
   "진행 중인 워크플로우가 없습니다."

반환: void
```

### 1.4 Resume 커맨드 처리

**handleResume(options: ResumeOptions): Promise<void>**

```
Input: ResumeOptions { project, verbose? }

처리 로직:
1. 프로젝트 경로 검증 (절대 경로 변환)
2. WorkflowService.resume(projectPath) 호출
3. 결과 출력 (handleRun과 동일한 출력 로직)
4. 실패 시:
   - "복구할 워크플로우가 없습니다" → 안내 메시지
   - 복구 중 에러 → 에러 메시지 + 힌트

반환: void
```

### 1.5 Config 커맨드 처리

**handleConfig(options: ConfigOptions): Promise<void>**

```
Input: ConfigOptions { action, key?, value? }

처리 로직:
SWITCH action:
  "show":
    config = ConfigManager.load()
    출력: 전체 설정을 키-값 테이블로 표시
    각 값 옆에 출처 표시 (default/global/project/env)

  "get":
    value = ConfigManager.get(key)
    출력: "{key} = {value} (source: {source})"

  "set":
    ConfigManager.setGlobal(key, value)
    출력: "✅ {key} = {value} (saved to ~/.dev-agent/config.json)"

반환: void
```

### 1.6 Report 커맨드 처리

**handleReport(options: ReportOptions): Promise<void>**

```
Input: ReportOptions { project, format?, output? }

처리 로직:
1. MonitoringService.generateReport(projectPath) 호출
2. 리포트 없으면 에러: "해당 프로젝트의 리포트 데이터가 없습니다"
3. 형식 변환:
   IF format === "json":
     output = JSON.stringify(report, null, 2)
   ELSE:
     output = formatReportText(report)
4. 출력:
   IF options.output:
     파일에 저장 → "리포트가 {path}에 저장되었습니다"
   ELSE:
     stdout 출력

반환: void
```

### 1.7 에러 포매팅

**formatError(error: AppError | Error): string**

```
Input: 에러 객체

처리 로직:
1. AppError인 경우:
   - 에러 코드별 사용자 메시지 매핑
   - severity에 따라 아이콘 선택 (critical: ❌, recoverable: ⚠️)
   - 해결 힌트 추가 (ERROR_HINTS 맵)

2. 일반 Error인 경우:
   - "예상치 못한 오류가 발생했습니다: {message}"

3. verbose 모드:
   - 스택 트레이스 추가
   - 원본 에러 코드 추가

반환: 포맷된 에러 메시지 문자열
```

---

## 2. WorkflowService (S-01)

### 2.1 워크플로우 실행

**execute(request: WorkflowRequest): Promise<WorkflowResult>**

```
Input: WorkflowRequest { projectPath, taskDescription, config }

처리 로직:
1. Preflight 검증:
   preflightResult = preflight(request)
   IF !preflightResult.valid:
     throw PreflightError(preflightResult.errors)

2. 경고 출력:
   preflightResult.warnings.forEach(w => Logger.warn(w))

3. MonitoringService 시작:
   MonitoringService.start(workflowId)

4. Orchestrator 위임:
   result = Orchestrator.execute(request)

5. MonitoringService 종료:
   MonitoringService.stop()

6. 리포트 저장 (자동):
   report = MonitoringService.generateReport()
   saveReport(report, projectPath)

반환: WorkflowResult
```

### 2.2 사전 검증

**preflight(request: WorkflowRequest): PreflightResult**

```
Input: WorkflowRequest

처리 로직:
1. 설정 로드:
   TRY:
     config = ConfigManager.load(request.projectPath)
   CATCH:
     errors.push("설정 로드 실패: {message}")

2. 프로젝트 검증:
   TRY:
     projectInfo = WorkspaceManager.validateProject(request.projectPath)
   CATCH:
     errors.push("프로젝트 검증 실패: {message}")

3. CLI 도구 확인:
   TRY:
     prereq = WorkspaceManager.checkPrerequisites()
     IF !prereq.allPassed:
       errors.push("필수 도구 누락: {missing tools}")
   CATCH:
     errors.push("도구 검증 실패: {message}")

4. Dirty state 확인:
   dirtyState = GitManager.checkDirtyState(request.projectPath)
   IF dirtyState.isDirty:
     warnings.push("작업 중인 변경사항이 감지되었습니다 ({files.length}개 파일)")

5. 기존 워크플로우 확인:
   existingState = StateManager.restore(request.projectPath)
   IF existingState && existingState.status === "running":
     warnings.push("이미 진행 중인 워크플로우가 있습니다 (resume로 복구 가능)")

반환: PreflightResult { valid: errors.length === 0, config, projectInfo, warnings, errors }
```

### 2.3 병렬 실행

**executeParallel(requests: WorkflowRequest[]): Promise<WorkflowResult[]>**

```
Input: WorkflowRequest[] (2개 이상)

처리 로직:
1. 프로젝트 경로 중복 검증:
   paths = requests.map(r => r.projectPath)
   IF hasDuplicates(paths):
     throw ParallelConflictError(duplicatedPaths)

2. 개수 제한 검증:
   IF requests.length > MAX_PARALLEL_WORKFLOWS:
     throw CliValidationError("최대 5개까지 병렬 실행 가능")

3. 각 요청에 대해 preflight 수행:
   preflightResults = requests.map(r => preflight(r))
   failedPreflights = preflightResults.filter(p => !p.valid)
   IF failedPreflights.length > 0:
     throw PreflightError(failedPreflights)

4. Orchestrator 위임:
   results = Orchestrator.executeParallel(requests)

반환: WorkflowResult[]
```

### 2.4 워크플로우 재시작

**resume(projectPath: string): Promise<WorkflowResult>**

```
Input: projectPath (절대 경로)

처리 로직:
1. 복구 가능 상태 확인:
   state = StateManager.restore(projectPath)
   IF !state:
     throw WorkflowServiceError("복구할 워크플로우가 없습니다")
   IF state.status === "completed":
     throw WorkflowServiceError("이미 완료된 워크플로우입니다")

2. MonitoringService 시작:
   MonitoringService.start(state.workflowId)

3. Orchestrator 위임:
   result = Orchestrator.resume(projectPath)

4. MonitoringService 종료 + 리포트 저장

반환: WorkflowResult
```

---

## 3. MonitoringService (S-04)

### 3.1 모니터링 시작

**start(workflowId: string): void**

```
Input: workflowId

처리 로직:
1. MonitoringState 초기화:
   state = {
     workflowId,
     startedAt: Date.now(),
     phases: [],
     cycles: [],
     currentPhase: undefined,
     currentCycle: undefined
   }

2. 이벤트 구독 등록:
   EventEmitter.on("phase:start", this.onPhaseStart)
   EventEmitter.on("phase:complete", this.onPhaseComplete)
   EventEmitter.on("cycle:complete", this.onCycleComplete)
   EventEmitter.on("workflow:end", this.onWorkflowEnd)

3. 진행 표시 시작 (TTY인 경우):
   IF process.stdout.isTTY:
     startProgressDisplay()
```

### 3.2 이벤트 핸들러

```
onPhaseStart(event: PhaseStartEvent):
  - state.currentPhase = event.phase
  - state.currentCycle = event.cycleNumber
  - state.phases.push({ phase: event.phase, cycleNumber: event.cycleNumber, startedAt: Date.now() })
  - updateProgressDisplay()
  - Logger.info(`[Cycle ${event.cycleNumber}] ${event.phase} 시작`)

onPhaseComplete(event: PhaseCompleteEvent):
  - currentPhase = state.phases[last]
  - currentPhase.completedAt = Date.now()
  - currentPhase.duration = event.duration
  - updateProgressDisplay()
  - Logger.info(`[Cycle ${event.cycleNumber}] ${event.phase} 완료 (${formatDuration(event.duration)})`)

onCycleComplete(event: CycleCompleteEvent):
  - state.cycles.push({
      cycleNumber: event.cycleNumber,
      startedAt: getCycleStartTime(event.cycleNumber),
      completedAt: Date.now(),
      duration: event.duration,
      reviewStatus: event.reviewResult.status,
      findingsCount: event.reviewResult.findings.length,
      criticalCount: event.reviewResult.findings.filter(f => f.severity === "critical").length
    })
  - Logger.info(`[Cycle ${event.cycleNumber}] 사이클 완료: ${event.reviewResult.status}`)

onWorkflowEnd(event: WorkflowEndEvent):
  - stopProgressDisplay()
  - Logger.info(`워크플로우 종료: ${event.result.status}`)
```

### 3.3 진행 표시 (TTY 모드)

**startProgressDisplay(): void**

```
처리 로직:
1. setInterval(PROGRESS_UPDATE_INTERVAL)로 갱신 타이머 설정
2. 매 갱신 시:
   - 현재 스피너 프레임 계산
   - 경과 시간 계산
   - process.stdout.write(`\r${spinner} Phase: ${phase} | Cycle: ${cycle}/${max} | ${elapsed}`)
3. readline.clearLine으로 이전 줄 지우기

종료 시:
- clearInterval로 타이머 해제
- 마지막 줄 지우기
- 커서 위치 복원
```

### 3.4 리포트 생성

**generateReport(projectPath?: string): WorkflowReport**

```
Input: projectPath (선택, 없으면 현재 워크플로우)

처리 로직:
1. 데이터 소스 결정:
   IF 현재 실행 중 + projectPath 미지정:
     data = this.state (내부 상태)
   ELSE:
     data = loadFromArchive(projectPath) // .ai-workflow/archive/ 에서 로드

2. data가 없으면:
     throw WorkflowServiceError("리포트 데이터 없음")

3. WorkflowReport 구성:
   {
     workflowId: data.workflowId,
     projectPath,
     taskDescription: state.taskDescription,
     status: data.result?.status || "running",
     totalDuration: data.completedAt ? (data.completedAt - data.startedAt) : (Date.now() - data.startedAt),
     totalCycles: data.cycles.length,
     phases: data.phases,
     cycles: data.cycles,
     finalReviewResult: data.cycles[last]?.reviewResult,
     prUrl: data.result?.prUrl,
     generatedAt: new Date().toISOString()
   }

4. findings 제한:
   IF finalReviewResult.findings.length > REPORT_MAX_FINDINGS:
     findings = findings.slice(0, REPORT_MAX_FINDINGS)
     + "... 외 N개"

반환: WorkflowReport
```

### 3.5 모니터링 종료

**stop(): void**

```
처리 로직:
1. 진행 표시 종료 (stopProgressDisplay)
2. 이벤트 구독 해제:
   EventEmitter.off("phase:start", this.onPhaseStart)
   EventEmitter.off("phase:complete", this.onPhaseComplete)
   EventEmitter.off("cycle:complete", this.onCycleComplete)
   EventEmitter.off("workflow:end", this.onWorkflowEnd)
3. 내부 상태 유지 (리포트 생성용)
```

---

## 4. DI 컴포지션 루트 (container.ts - U-05 부분)

```
Phase 5: U-05 CLI & Workflow 생성

// MonitoringService 생성 (EventEmitter + Logger 의존)
const monitoringService = new MonitoringService(eventEmitter, logger);

// WorkflowService 생성 (Facade)
const workflowService = new WorkflowService({
  orchestrator,        // U-03
  configManager,       // U-01
  workspaceManager,    // U-01
  stateManager,        // U-01
  monitoringService,   // 같은 유닛
  logger               // U-01
});

// CLI 생성 (최상위)
const cli = new CLI(workflowService, logger);

// 진입점
export function bootstrap(argv: string[]): Promise<void> {
  return cli.run(argv);
}
```

---

## 5. SIGINT (Graceful Shutdown) 처리

```
CLI 초기화 시:

let sigintCount = 0;
let lastSigintTime = 0;

process.on("SIGINT", async () => {
  const now = Date.now();

  IF (now - lastSigintTime) < 1000:
    // 1초 내 두 번째 SIGINT → 강제 종료
    Logger.warn("강제 종료합니다.")
    process.exit(1)

  sigintCount++
  lastSigintTime = now

  // 첫 번째 SIGINT → graceful shutdown
  Logger.info("\n중단 요청을 받았습니다. 상태를 저장하는 중...")

  TRY:
    MonitoringService.stop()
    StateManager.save() // 현재 상태 저장
    Logger.info("상태가 저장되었습니다. 'dev-agent resume'로 재시작 가능합니다.")
  CATCH:
    Logger.warn("상태 저장 실패. 일부 진행 상황이 손실될 수 있습니다.")

  process.exit(0)
})
```

---

## 6. 리포트 텍스트 포매팅

**formatReportText(report: WorkflowReport): string**

```
출력 형식:

═══════════════════════════════════════════════
  Workflow Report
═══════════════════════════════════════════════

  Project:     {projectPath}
  Task:        {taskDescription}
  Status:      {status icon} {status}
  Duration:    {formatted duration}
  Total Cycles: {totalCycles}
  PR:          {prUrl || "N/A"}

───────────────────────────────────────────────
  Cycle Summary
───────────────────────────────────────────────

  #  │ Duration │ Review          │ Findings
  ───┼──────────┼─────────────────┼──────────
  1  │ 2m 30s   │ CHANGES_REQ.    │ 5 (2 critical)
  2  │ 1m 45s   │ APPROVED        │ 0
  ───┼──────────┼─────────────────┼──────────

───────────────────────────────────────────────
  Phase Duration Analysis
───────────────────────────────────────────────

  Planning:       35% ████████░░░░░░░
  Implementation: 45% ██████████░░░░░
  Review:         20% █████░░░░░░░░░░

───────────────────────────────────────────────
  Final Findings (if any)
───────────────────────────────────────────────

  [critical] src/auth.ts:25 - SQL injection vulnerability
  [major] src/api.ts:100 - Missing error handling
  ...

═══════════════════════════════════════════════
  Generated at: {timestamp}
═══════════════════════════════════════════════
```
