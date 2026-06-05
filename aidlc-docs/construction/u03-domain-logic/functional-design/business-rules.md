# Business Rules - U-03: Domain Logic

## BR-01: 리뷰 판정 규칙

**Rule**: 모든 체크 항목이 passed=true여야 APPROVED. 하나라도 false이면 CHANGES_REQUESTED.

```
status = checks.every(c => c.passed) ? "APPROVED" : "CHANGES_REQUESTED"
```

**Constraint**: 체크 항목이 비어있으면 (빈 배열) CHANGES_REQUESTED로 판정 (보수적).

---

## BR-02: 보수적 판정 규칙

**Rule**: 리뷰 결과 파싱에 실패하거나 모호한 경우 항상 CHANGES_REQUESTED로 판정한다.

```
판정 불가 상황:
- JSON 파싱 실패 + 키워드 탐색 실패 → CHANGES_REQUESTED
- "APPROVED"와 "CHANGES_REQUESTED" 둘 다 포함 → CHANGES_REQUESTED
- stdout이 비어있음 → CHANGES_REQUESTED
```

**Constraint**: 잘못된 APPROVED보다 잘못된 CHANGES_REQUESTED가 안전하다 (추가 반복으로 해결 가능).

---

## BR-03: 재작업 범위 추천 규칙

**Rule**: critical findings 3개 이상 또는 design 체크 실패 시 전체 재기획(full)을 추천한다.

| 조건 | 추천 | 이유 |
|---|---|---|
| critical findings >= 3 | full | 근본적 설계 문제 의심 |
| design check failed | full | 요구사항 불일치 → 기획 수정 필요 |
| 그 외 | partial | 피드백만으로 수정 가능 |

**Constraint**: 최종 결정은 사용자에게 있음. 추천은 기본값으로만 사용.

---

## BR-04: 사이클 순서 규칙

**Rule**: 각 사이클 내에서 단계는 반드시 Planning → Implementation → Review 순서로 실행한다.

```
순서 위반 금지:
- Implementation 없이 Review 불가
- Planning 없이 Implementation 불가
- 각 단계는 이전 단계 완료 후에만 시작

예외: resume() 시 중단된 단계부터 재시작 (이전 단계 결과 재사용)
```

**Constraint**: 단계 건너뛰기 불가. 실패 시 해당 단계부터 재시작.

---

## BR-05: 최대 반복 도달 규칙

**Rule**: cycleNumber > maxIterations이면 사이클을 중단하고 사용자에게 선택을 요청한다.

```
선택지:
1. "create_pr" → 현재 코드 상태로 PR 생성 (리뷰 미통과 상태임을 PR에 표시)
2. "continue" → maxIterations 증가 (사용자가 추가 횟수 입력)
3. "stop" → 워크플로우 중단 (상태 저장, resume 가능)
```

**Constraint**: maxIterations에 도달하기 전까지는 사용자 개입 없이 자동 실행.

---

## BR-06: 상태 저장 시점 규칙

**Rule**: PipelineService는 각 단계 완료 후 즉시 StateManager.save()를 호출한다.

```
Planning 완료 → save(phase="planning", artifacts 업데이트)
Implementation 완료 → save(phase="implementation", changedFiles 업데이트)
Review 완료 → save(phase="review", reviewHistory 추가)
```

**Constraint**: save() 실패는 워크플로우를 중단하지 않는다 (최선 노력). 경고만 로그.

---

## BR-07: 병렬 실행 격리 규칙

**Rule**: 병렬 워크플로우는 서로의 상태에 접근하지 않으며, 같은 프로젝트를 동시에 실행할 수 없다.

```
검증:
- executeParallel() 호출 시 모든 request의 projectPath가 고유한지 확인
- 중복 있으면 즉시 에러 (ParallelConflictError)

격리:
- 각 워크플로우는 독립된 Logger (createChildLogger)
- 각 워크플로우는 독립된 상태 파일
- Promise.allSettled 사용 (하나 실패해도 나머지 계속)
```

**Constraint**: 같은 프로젝트에 대한 병렬 실행은 파일 시스템 충돌을 유발하므로 절대 금지.

---

## BR-08: 이벤트 발행 규칙

**Rule**: 각 단계 시작/완료 시 이벤트를 발행하되, 이벤트 핸들러 에러가 워크플로우를 중단하지 않는다.

```
이벤트 발행:
- emit()은 동기적 (EventEmitter 기본 동작)
- 핸들러에서 에러 발생 시 catch하고 경고 로그만 출력
- 워크플로우 실행은 계속 진행
```

**Constraint**: 모니터링은 부가 기능. 모니터링 실패가 핵심 기능에 영향을 주지 않는다.

---

## BR-09: Resume 복원 후 실행 규칙

**Rule**: resume() 시 중단된 단계부터 재시작하되, 이전 단계의 산출물을 검증한다.

```
복원 후 시작 위치:
- currentPhase="planning" → Planning부터 재실행 (산출물 새로 생성)
- currentPhase="implementation" → Implementation부터 (PlanResult 재사용)
- currentPhase="review" → Review부터 (PlanResult + ImplementResult 재사용)
- currentPhase="pr_creation" → PR 생성부터 (모든 결과 재사용)

산출물 검증:
- 각 단계 시작 전 이전 단계의 산출물 파일 존재 여부 확인
- 없으면 해당 단계부터가 아닌 이전 단계부터 재실행
```

**Constraint**: 산출물이 손상된 경우 안전하게 이전 단계로 fallback한다.

---

## BR-10: PR 생성 시 미통과 상태 표시 규칙

**Rule**: maxIterations 도달 후 "create_pr" 선택 시, PR 본문에 리뷰 미통과 상태를 명시한다.

```
PR 본문에 추가:
"⚠️ 이 PR은 최대 반복 횟수(N회) 도달 후 사용자 선택에 의해 생성되었습니다.
마지막 리뷰 결과: CHANGES_REQUESTED
미해결 findings: N개 (critical: X, major: Y)"
```

**Constraint**: 사용자가 의도적으로 미통과 상태로 PR을 만드는 것이므로 에러는 아님.
