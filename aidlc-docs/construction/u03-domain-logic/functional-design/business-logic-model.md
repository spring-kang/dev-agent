# Business Logic Model - U-03: Domain Logic

## 1. ReviewEngine (C-05)

### 1.1 리뷰 결과 평가

**evaluate(rawOutput: ReviewRawOutput): ReviewResult**

```
Input: ReviewRawOutput (ClaudeAgent에서 받은 리뷰 원문)

처리 로직:
1. JSON 추출 시도:
   IF rawOutput.parsedJson 존재:
     json = rawOutput.parsedJson
   ELSE:
     json = tryParseFromStdout(rawOutput.stdout)

2. JSON 파싱 성공 시:
   - checks 배열에서 각 항목의 passed 여부 확인
   - findings 배열을 ReviewFinding[]으로 변환
   - status 결정: 모든 checks.passed === true → "APPROVED", 아니면 "CHANGES_REQUESTED"

3. JSON 파싱 실패 시 (텍스트 기반 fallback):
   - stdout에서 "APPROVED" / "CHANGES_REQUESTED" 키워드 탐색
   - 키워드 기반 판정 (heuristic)
   - findings는 빈 배열 (구조화 불가)
   - summary는 stdout 전체 (또는 마지막 500자)

반환: ReviewResult
```

### 1.2 텍스트 기반 Fallback 파싱

```
tryParseFromStdout(stdout: string):

1. JSON 블록 추출 시도: ```json ... ```
2. 객체 패턴 매칭: { "status": ... }
3. 부분 JSON이라도 status 필드만 추출 시도

모두 실패 시:
- stdout에서 키워드 탐색:
  - "APPROVED" 또는 "approve" 포함 + "CHANGES_REQUESTED" 미포함 → APPROVED
  - "CHANGES_REQUESTED" 또는 "changes requested" 포함 → CHANGES_REQUESTED
  - 둘 다 없으면 → CHANGES_REQUESTED (보수적 판정)
```

### 1.3 재작업 범위 추천

**recommendReworkScope(result: ReviewResult): "partial" | "full"**

```
판단 기준:
1. critical findings 수 확인
2. checks에서 design 항목 실패 여부 확인

로직:
IF result.findings.filter(f => f.severity === "critical").length >= 3:
  return "full"     // critical이 3개 이상이면 근본적 재설계 필요

IF result.checks.find(c => c.name === "design" && !c.passed):
  return "full"     // 설계 준수 실패면 전체 재기획

ELSE:
  return "partial"  // 나머지는 부분 수정으로 해결 가능
```

---

## 2. PipelineService (S-02)

### 2.1 단일 사이클 실행

**executeCycle(context: CycleContext): Promise<CycleResult>**

```
Input: CycleContext { cycleNumber, projectPath, previousFeedback?, artifacts }

순서:
1. [Planning] ClaudeAgent.plan()
   - 첫 사이클: taskDescription 기반 기획
   - 재사이클: previousFeedback + reworkScope 반영 재기획
   - 결과: PlanResult (산출물 경로들)
   - StateManager.save() 호출

2. [Implementation] CodexAgent.implement()
   - implementationSpecPath 전달
   - 결과: ImplementResult (changedFiles)
   - StateManager.save() 호출

3. [Commit] GitManager.commit()
   - cycleNumber 포함 커밋
   - 결과: commitSHA

4. [Review] ClaudeAgent.review()
   - changedFiles + requirements + testScenarios 전달
   - 결과: ReviewRawOutput

5. [Evaluate] ReviewEngine.evaluate()
   - 리뷰 원문 → 구조화된 ReviewResult
   - StateManager.save() 호출 (reviewHistory 업데이트)

반환:
CycleResult {
  reviewResult: ReviewResult;
  changedFiles: string[];
  artifacts: WorkflowArtifacts (업데이트됨);
  commitSHA: string;
}
```

### 2.2 단계 간 데이터 전달

```
Plan → Implement:
- PlanResult.implementationSpec → ImplementRequest.implementationSpecPath

Implement → Review:
- ImplementResult.changedFiles → ReviewRequest.changedFiles
- PlanResult.requirements → ReviewRequest.requirementsPath
- PlanResult.testScenarios → ReviewRequest.testScenariosPath

Review → 다음 Cycle:
- ReviewResult → CycleContext.previousFeedback
- ReviewEngine.recommendReworkScope() → PlanRequest.reworkScope
```

---

## 3. Orchestrator (C-02)

### 3.1 워크플로우 실행

**execute(request: WorkflowRequest): Promise<WorkflowResult>**

```
Input: WorkflowRequest { projectPath, taskDescription, config }

순서:
1. 워크플로우 ID 생성 (UUID v4)
2. StateManager에 초기 상태 저장
3. GitService.initWorkflow() → 브랜치 생성
4. 사이클 루프 시작:

   WHILE cycleNumber <= config.maxIterations:
     context = { cycleNumber, projectPath, previousFeedback, artifacts }
     result = PipelineService.executeCycle(context)

     IF result.reviewResult.status === "APPROVED":
       → GitService.finalize() → PR 생성
       → 아카이브
       → return WorkflowResult (status="completed", prUrl)

     ELSE:  // CHANGES_REQUESTED
       previousFeedback = result.reviewResult
       reworkScope = ReviewEngine.recommendReworkScope(result.reviewResult)
         OR 사용자 선택 (handleMaxIterationsReached에서)
       cycleNumber++

5. 최대 반복 도달:
   decision = handleMaxIterationsReached(context)
   SWITCH decision:
     "create_pr": GitService.finalize() → return (status="completed")
     "continue": maxIterations 증가, 루프 계속
     "stop": return WorkflowResult (status="stopped")

반환: WorkflowResult
```

### 3.2 최대 반복 도달 처리

**handleMaxIterationsReached(context: CycleContext): Promise<MaxIterationDecision>**

```
사용자에게 선택지 제공:
- "create_pr": 현재 상태로 PR 생성
- "continue": 추가 N회 반복 허용 (stdin으로 N 입력 받기)
- "stop": 워크플로우 중단

터미널 출력:
"⚠️  최대 반복 횟수(${maxIterations}회)에 도달했습니다."
"현재까지 ${cycleNumber - 1}회 사이클 수행, 마지막 리뷰: CHANGES_REQUESTED"
""
"선택해주세요:"
"  1) 현재 상태로 PR 생성"
"  2) 추가 반복 (횟수 입력)"
"  3) 워크플로우 중단"

stdin에서 선택 입력 대기
```

### 3.3 워크플로우 재시작

**resume(projectPath: string): Promise<WorkflowResult>**

```
순서:
1. StateManager.restore(projectPath) → WorkflowState | null
2. state === null → 에러 ("재시작 가능한 워크플로우가 없습니다")
3. state 유효성 검증
4. 복원된 상태에서 실행 재개:
   - currentPhase에 따라 적절한 단계부터 시작
   - 기존 artifacts 활용
   - 기존 reviewHistory 유지
5. execute()와 동일한 루프로 진행
```

### 3.4 병렬 워크플로우 실행

**executeParallel(requests: WorkflowRequest[]): Promise<WorkflowResult[]>**

```
순서:
1. 각 요청에 대해 독립된 워크플로우 ID 생성
2. Logger.createChildLogger(workflowId)로 격리된 로거 생성
3. Promise.allSettled(requests.map(r => execute(r)))
4. 각 결과를 WorkflowResult[]로 집계
5. 하나가 실패해도 나머지는 계속 실행

주의:
- 같은 프로젝트 경로는 병렬 실행 금지 (검증 후 에러)
- 각 워크플로우는 완전히 독립 (서로의 상태에 접근하지 않음)
```

### 3.5 상태 조회

**getStatus(projectPath?: string): Promise<WorkflowStatus[]>**

```
IF projectPath 지정:
  - 해당 프로젝트의 현재 상태만 반환
ELSE:
  - projects/ 내 모든 프로젝트 스캔
  - .ai-workflow/current/state.json 존재하는 프로젝트만 수집
  - 각 state에서 요약 정보 추출

WorkflowStatus:
- workflowId, projectPath, taskDescription
- currentPhase, currentCycle
- startedAt, updatedAt, elapsed
- lastReviewStatus (있으면)
```

---

## 4. 이벤트 발행 (MonitoringService 연동)

```
Orchestrator/PipelineService에서 발행하는 이벤트:

PipelineService.executeCycle() 내부:
  emit("phase:start", { phase: "planning", cycleNumber })
  ... planning 실행 ...
  emit("phase:complete", { phase: "planning", cycleNumber, duration })

  emit("phase:start", { phase: "implementation", cycleNumber })
  ... implementation 실행 ...
  emit("phase:complete", { phase: "implementation", cycleNumber, duration })

  emit("phase:start", { phase: "review", cycleNumber })
  ... review 실행 ...
  emit("phase:complete", { phase: "review", cycleNumber, duration })

  emit("cycle:complete", { cycleNumber, reviewResult, duration })

Orchestrator.execute() 내부:
  emit("workflow:start", { workflowId, projectPath, taskDescription })
  ... 사이클 루프 ...
  emit("workflow:end", { workflowId, result })
```
