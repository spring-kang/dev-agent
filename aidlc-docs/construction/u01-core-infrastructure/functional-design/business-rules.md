# Business Rules - U-01: Core Infrastructure

## BR-01: 설정 우선순위 규칙

**Rule**: 설정값은 항상 다음 우선순위로 병합된다 (높을수록 우선):

```
Priority 5 (최고): CLI 옵션 (--max-iterations 5)
Priority 4: 환경변수 (DEV_AGENT_MAX_ITERATIONS=5)
Priority 3: 프로젝트 설정 (<project>/.ai-workflow/config.json)
Priority 2: 글로벌 설정 (~/.dev-agent/config.json)
Priority 1 (최저): 기본값 (DEFAULT_CONFIG)
```

**Constraint**: 상위 우선순위 설정이 존재하면 하위 우선순위는 무시된다 (항목 단위).

---

## BR-02: 설정 검증 severity 규칙

**Rule**: 설정 검증 실패는 severity에 따라 다르게 처리된다.

| Severity | 동작 | 대상 항목 |
|---|---|---|
| CRITICAL | 에러 메시지 출력 + process.exit(1) | claudePath, codexPath, ghPath (실행 불가) |
| WARNING | 경고 메시지 출력 + 기본값으로 대체 | maxIterations, iterationTimeout, logLevel, branchPrefix, baseBranch, reviewChecks |

**Constraint**: CRITICAL 검증은 WARNING 검증보다 먼저 수행. CRITICAL 실패 시 WARNING 검증을 건너뜀.

---

## BR-03: 프로젝트 검증 규칙

**Rule**: 프로젝트가 워크플로우 실행 가능하려면 다음 조건을 모두 만족해야 한다:

| 조건 | 검증 방법 | 실패 시 |
|---|---|---|
| 경로 존재 | fs.existsSync(path) | error (워크플로우 실행 불가) |
| 디렉토리 | fs.statSync(path).isDirectory() | error |
| Git 레포 | .git 디렉토리 존재 | error |
| Git remote | `git remote -v` 출력 존재 | warning (PR 생성 불가) |

**Constraint**: error가 1개라도 있으면 `valid=false`, warnings만 있으면 `valid=true`.

---

## BR-04: CLI 도구 가용성 규칙

**Rule**: 워크플로우 실행 전 모든 필수 CLI 도구가 사용 가능해야 한다.

| 도구 | 필수 여부 | 검증 방법 |
|---|---|---|
| git | 필수 | `git --version` |
| claude | 필수 | 설정의 claudePath로 `<path> --version` |
| codex | 필수 | 설정의 codexPath로 `<path> --version` |
| gh | 필수 | `gh --version` |

**Constraint**: 하나라도 unavailable이면 워크플로우 시작 불가. 에러 메시지에 설치 방법 안내 포함.

---

## BR-05: 로그 레벨 필터링 규칙

**Rule**: 설정된 logLevel 이상의 메시지만 터미널에 출력. 파일 로그는 항상 debug 레벨.

```
Level hierarchy: debug(0) < info(1) < warn(2) < error(3)

터미널 출력 조건: message.level >= configured.logLevel
파일 기록 조건: 항상 (모든 레벨)
```

**Constraint**: progress() 출력은 logLevel 필터와 무관하게 항상 터미널에 표시 (info 이상일 때).

---

## BR-06: 컬러 출력 비활성화 규칙

**Rule**: 다음 조건 중 하나라도 충족되면 컬러 출력을 비활성화한다:

1. `--no-color` CLI 옵션이 지정된 경우
2. 환경변수 `NO_COLOR`가 설정된 경우 (값 무관)
3. 환경변수 `CI=true`가 설정된 경우
4. stdout이 TTY가 아닌 경우 (`process.stdout.isTTY === false`)

**Constraint**: 비활성화 시 모든 ANSI escape code가 제거된 plain text로 출력.

---

## BR-07: 상태 저장 트리거 규칙

**Rule**: 워크플로우 상태는 다음 시점에 저장된다:

| 트리거 | 저장 내용 | 비고 |
|---|---|---|
| Planning 단계 완료 | currentPhase, artifacts.requirementsPath 등 | |
| Implementation 단계 완료 | artifacts.changedFiles | |
| Review 단계 완료 | reviewHistory 업데이트 | |
| PR 생성 완료 | 최종 상태 | 아카이브 직전 |
| SIGINT/SIGTERM 수신 | 현재 상태 그대로 | 긴급 저장 |

**Constraint**: 저장은 원자적이어야 함 (write → rename 패턴으로 파일 깨짐 방지).

---

## BR-08: 상태 복원 가능 판단 규칙

**Rule**: resume 시 다음 조건을 모두 만족해야 복원 가능:

1. `state.json` 파일이 존재하고 유효한 JSON
2. `workflowId`가 비어있지 않은 문자열
3. `currentPhase`가 유효한 값 ("planning" | "implementation" | "review" | "pr_creation")
4. `branchName`에 해당하는 git branch가 존재
5. artifacts에 기록된 파일 경로가 실제 존재 (최소 1개 이상)

**Constraint**: 조건 미충족 시 null 반환 + 경고 메시지 (어떤 조건이 실패했는지 명시).

---

## BR-09: 히스토리 아카이브 규칙

**Rule**: 워크플로우 정상 완료 시 현재 작업 디렉토리를 히스토리로 이동한다.

```
트리거 조건: 워크플로우가 다음 중 하나로 종료될 때
- APPROVED → PR 생성 완료
- 사용자 선택 "현재 상태로 PR 생성" → PR 생성 완료
- 사용자 선택 "워크플로우 중단" → 중단 완료

아카이브 경로: .ai-workflow/history/<workflowId>/
이동 대상: .ai-workflow/current/ 내 모든 파일/디렉토리
```

**Constraint**: 로그 파일(.ai-workflow/logs/)은 이동하지 않고 원위치 유지.

---

## BR-10: .ai-workflow 디렉토리 초기화 규칙

**Rule**: initWorkflowDir은 멱등성을 보장한다.

```
- 이미 존재하는 디렉토리: 건너뜀 (내용 보존)
- 존재하지 않는 디렉토리: 생성
- 이미 존재하는 파일: 건너뜀 (덮어쓰지 않음)
- config.json이 없을 때만: 빈 객체 {} 생성
```

**Constraint**: 기존 데이터를 절대 삭제하거나 덮어쓰지 않는다.

---

## BR-11: Child Logger 격리 규칙

**Rule**: 병렬 워크플로우 실행 시 각 워크플로우는 독립된 로거를 사용한다.

```
격리 보장:
- 터미널 출력: workflowId prefix로 구분 ([wf-<id-4chars>])
- 파일 로그: 별도 파일 (workflow-<workflowId>.log)
- 설정: 부모 logger의 logLevel 상속
- 리소스: 각 child logger가 독립 파일 핸들 유지
```

**Constraint**: child logger 간 로그가 섞이지 않아야 한다. 터미널 출력은 순서가 섞일 수 있으나 prefix로 구분 가능.

---

## BR-12: 환경변수 타입 변환 규칙

**Rule**: 환경변수는 항상 문자열이므로 설정 타입에 맞게 변환한다.

| 대상 타입 | 변환 규칙 | 실패 시 |
|---|---|---|
| number | `parseInt(value, 10)`, NaN이면 실패 | 환경변수 무시 (기본값 사용) |
| boolean | `"true"` 또는 `"1"` → true, 나머지 → false | 항상 성공 |
| string | 그대로 사용 | 항상 성공 |

**Constraint**: 변환 실패 시 에러를 발생시키지 않고, 해당 환경변수를 무시한다 (하위 우선순위 값 사용).

---

## BR-13: 원자적 파일 쓰기 규칙

**Rule**: 상태 파일(state.json) 쓰기는 원자적으로 수행한다.

```
1. 임시 파일에 작성: state.json.tmp
2. 임시 파일 rename: state.json.tmp → state.json
3. rename은 OS 수준에서 원자적 (같은 파일시스템 내)
```

**Constraint**: 쓰기 도중 프로세스가 종료되어도 기존 state.json이 손상되지 않아야 한다.
