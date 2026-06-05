# Business Rules - U-05: CLI & Workflow

## BR-01: 프로젝트 경로 검증 규칙

**Rule**: `--project` 옵션으로 전달된 경로는 절대 경로로 변환 후 존재 여부를 확인한다.

```
검증 순서:
1. 상대 경로면 process.cwd() 기준으로 절대 경로 변환 (path.resolve)
2. 디렉토리 존재 여부 확인 (fs.stat)
3. 디렉토리가 아니면 CliValidationError
4. 접근 권한 확인 (fs.access R_OK | W_OK)
```

**Constraint**: 존재하지 않는 경로는 즉시 에러. 자동 생성하지 않는다.

---

## BR-02: 서브커맨드 필수 인자 규칙

**Rule**: 각 서브커맨드의 필수 인자가 누락되면 사용법(usage) 메시지와 함께 exitCode=2로 종료한다.

| 커맨드 | 필수 인자 | 없을 때 |
|---|---|---|
| run | --project, task(positional) | usage + exit 2 |
| resume | project(positional) | usage + exit 2 |
| status | (없음, 전체 조회) | - |
| list | (없음) | - |
| config set | key, value | usage + exit 2 |
| config get | key | usage + exit 2 |
| report | project(positional) | usage + exit 2 |

**Constraint**: Commander.js의 requiredOption/argument를 활용하여 프레임워크 수준에서 검증.

---

## BR-03: Preflight 검증 순서 규칙

**Rule**: WorkflowService는 Orchestrator 실행 전에 반드시 사전 검증(preflight)을 수행한다.

```
검증 순서:
1. 설정 로드 (ConfigManager.load) → 실패 시 에러
2. 프로젝트 경로 검증 (WorkspaceManager.validateProject) → 실패 시 에러
3. CLI 도구 존재 확인 (WorkspaceManager.checkPrerequisites) → 실패 시 에러
4. Dirty state 확인 → 경고만 (차단하지 않음)
5. 기존 워크플로우 상태 확인 → 경고만 ("이미 진행 중인 워크플로우 있음")

모든 에러 검증 통과 후에만 Orchestrator.execute() 호출
```

**Constraint**: Preflight 실패는 워크플로우를 시작하지 않는다. 경고는 로그로만 출력.

---

## BR-04: 병렬 실행 프로젝트 수 제한 규칙

**Rule**: 병렬 실행 시 최대 5개 프로젝트까지만 허용한다.

```
검증:
IF projects.length > MAX_PARALLEL_WORKFLOWS (5):
  CliValidationError("최대 ${MAX_PARALLEL_WORKFLOWS}개 프로젝트까지 병렬 실행 가능합니다")

IF projects.length < 2:
  일반 단일 실행으로 전환 (병렬 불필요)
```

**Constraint**: 시스템 리소스 보호를 위한 하드 리밋. 설정으로 변경 불가.

---

## BR-05: 진행 상황 표시 규칙

**Rule**: 워크플로우 실행 중 터미널에 현재 단계와 경과 시간을 실시간 표시한다.

```
표시 형식:
[spinner] Phase: {phase} | Cycle: {N}/{max} | Elapsed: {time}

표시 조건:
- stdout이 TTY인 경우에만 스피너 표시
- TTY가 아닌 경우 (파이프, 리다이렉트) → 단계 변경 시에만 한 줄 출력
- --verbose 모드: 모든 이벤트를 상세 텍스트로 출력

갱신 주기: 1초 (PROGRESS_UPDATE_INTERVAL)
```

**Constraint**: 진행 표시는 모니터링 기능. 표시 실패가 워크플로우를 중단하지 않는다.

---

## BR-06: 종료 코드 규칙

**Rule**: CLI는 실행 결과에 따라 적절한 종료 코드를 반환한다.

| 상황 | 종료 코드 | 의미 |
|---|---|---|
| 워크플로우 완료 (APPROVED + PR 생성) | 0 | 성공 |
| 워크플로우 정상 중단 (사용자 stop) | 0 | 정상 종료 |
| 워크플로우 실패 (에러) | 1 | 에러 |
| CLI 입력 오류 (잘못된 인자) | 2 | 사용법 오류 |
| 최대 반복 후 PR 생성 | 0 | 성공 (경고 포함) |

**Constraint**: 종료 코드는 CI/CD 파이프라인 연동을 고려하여 Unix 표준을 따른다.

---

## BR-07: 설정 명령어 규칙

**Rule**: `config` 서브커맨드는 글로벌 설정 파일(~/.dev-agent/config.json)만 조작한다.

```
config show:
  - 현재 적용되는 전체 설정 출력 (모든 소스 병합 결과)
  - 각 값의 출처 표시 (default, global, project, cli)

config get <key>:
  - 특정 키의 값과 출처 출력
  - 존재하지 않는 키면 에러

config set <key> <value>:
  - 글로벌 설정 파일에 값 저장
  - 유효하지 않은 키면 에러 (허용된 키 목록 검증)
  - 유효하지 않은 값이면 에러 (타입 검증)
```

**Constraint**: 프로젝트별 설정(.dev-agent.json)은 config 커맨드로 조작하지 않는다 (수동 편집).

---

## BR-08: Resume 실행 조건 규칙

**Rule**: resume 커맨드는 복구 가능한 상태가 있을 때만 실행한다.

```
검증 순서:
1. 프로젝트 경로에 .ai-workflow/current/state.json 존재 확인
2. 상태 파일 파싱 가능 확인
3. status가 "running" 또는 "stopped"인지 확인
4. status가 "completed"이면 → "이미 완료된 워크플로우입니다" 안내
5. state.json 없으면 → "복구할 워크플로우가 없습니다" 안내

복구 가능한 상태: status="running" (비정상 종료) 또는 status="stopped" (의도적 중단)
```

**Constraint**: 완료된 워크플로우는 resume 불가. 새로 run 해야 함.

---

## BR-09: 리포트 생성 규칙

**Rule**: report 커맨드는 MonitoringService의 축적된 데이터로 종합 리포트를 생성한다.

```
리포트 포함 내용:
1. 워크플로우 기본 정보 (ID, 프로젝트, 작업 설명, 상태)
2. 시간 정보 (시작, 종료, 총 소요 시간)
3. 사이클별 요약 (번호, 소요 시간, 리뷰 결과, findings 수)
4. 단계별 소요 시간 분석 (planning, implementation, review 각각)
5. 최종 리뷰 결과 (findings 목록, 최대 20개)
6. PR 정보 (URL, 생성 여부)

리포트 소스:
- 실행 중: MonitoringService 내부 상태
- 실행 후: .ai-workflow/archive/ 내 저장된 리포트 파일

출력 형식:
- text (기본): 터미널 가독성 높은 포맷 (컬러, 테이블)
- json: 기계 처리 가능한 JSON
```

**Constraint**: 아카이브된 워크플로우도 리포트 조회 가능.

---

## BR-10: 에러 출력 형식 규칙

**Rule**: CLI에서 발생하는 모든 에러는 사용자 친화적 메시지로 변환하여 출력한다.

```
에러 출력 형식:
❌ {사용자 친화적 메시지}

상세 정보 표시 조건:
- --verbose 모드: 스택 트레이스 + 원본 에러 코드
- 일반 모드: 사용자 메시지 + 해결 힌트만

에러 유형별 메시지 예시:
- PreflightError: "프로젝트 검증 실패: {failedChecks 요약}\n  💡 {해결 힌트}"
- AgentTimeoutError: "에이전트 응답 시간 초과 ({timeout}s)\n  💡 'dev-agent resume'로 재시작해보세요"
- GitPushError: "Git push 실패\n  💡 네트워크 연결 또는 원격 저장소 접근 권한을 확인하세요"
```

**Constraint**: 내부 에러 코드나 스택 트레이스는 기본 모드에서 노출하지 않는다.

---

## BR-11: Graceful Shutdown 규칙

**Rule**: SIGINT(Ctrl+C) 수신 시 현재 단계 완료를 기다리지 않고 즉시 상태를 저장하고 종료한다.

```
SIGINT 처리:
1. 진행 표시 중단 (스피너 정리)
2. 현재 실행 중인 자식 프로세스에 SIGTERM 전달
3. StateManager.save() 호출 (현재 상태 저장)
4. Logger.info("워크플로우가 중단되었습니다. 'dev-agent resume'로 재시작 가능합니다.")
5. process.exit(0)

두 번째 SIGINT:
- 1초 내 두 번째 SIGINT → 즉시 강제 종료 (process.exit(1))
- 상태 저장 없이 종료됨을 경고
```

**Constraint**: 첫 번째 SIGINT는 graceful, 두 번째는 강제 종료.

---

## BR-12: List 출력 형식 규칙

**Rule**: list 커맨드는 등록된 프로젝트들의 현재 상태를 테이블 형식으로 출력한다.

```
출력 형식:
┌─────────────────────────────────────────────────────────────┐
│ Project              │ Status    │ Cycle │ Last Updated      │
├─────────────────────────────────────────────────────────────┤
│ my-app               │ running   │ 3/5   │ 2 min ago         │
│ api-server           │ completed │ 2/5   │ 1 hour ago        │
│ frontend             │ stopped   │ 4/5   │ 30 min ago        │
└─────────────────────────────────────────────────────────────┘

조회 방법:
- WorkspaceManager.listProjects()로 프로젝트 목록 가져오기
- 각 프로젝트의 .ai-workflow/current/state.json 확인
- state.json 없으면 "no workflow" 표시
```

**Constraint**: 워크플로우 이력이 없는 프로젝트는 목록에 포함하지 않는다.

---

## BR-13: 워크플로우 완료 시 출력 규칙

**Rule**: 워크플로우 완료(성공/실패/중단) 시 결과 요약을 터미널에 출력한다.

```
성공 시 (APPROVED):
╔══════════════════════════════════════════════╗
║  ✅ 워크플로우 완료!                           ║
║                                              ║
║  PR: https://github.com/user/repo/pull/123   ║
║  사이클: 2회 (총 소요: 5분 32초)                 ║
║  리뷰: APPROVED                               ║
╚══════════════════════════════════════════════╝

실패 시:
❌ 워크플로우 실패
   원인: {에러 메시지}
   💡 'dev-agent resume ./project'로 재시작 가능

중단 시:
⏹️  워크플로우 중단됨
   진행: {cycleNumber}/{maxIterations} 사이클
   💡 'dev-agent resume ./project'로 재시작 가능
```

**Constraint**: 완료 출력은 항상 표시. 파이프 모드에서도 최소한 한 줄 요약은 출력.
