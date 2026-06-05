# Business Rules - U-02: Agent Integration

## BR-01: 프로세스 생성 규칙

**Rule**: 모든 AI CLI 프로세스는 대상 프로젝트 디렉토리를 cwd로 설정하여 실행한다.

```
spawn 옵션:
- cwd: 항상 대상 프로젝트의 절대 경로
- env: 부모 프로세스 환경변수 전체 상속
- stdio: ['pipe', 'pipe', 'pipe'] (stdin/stdout/stderr 모두 파이프)
```

**Constraint**: cwd가 유효한 디렉토리가 아니면 프로세스를 생성하지 않는다.

---

## BR-02: 프롬프트 길이 임계값 규칙

**Rule**: 프롬프트가 100KB를 초과하면 파일 참조 패턴으로 전환한다.

```
PROMPT_FILE_THRESHOLD = 100 * 1024 (bytes)

IF prompt.length > PROMPT_FILE_THRESHOLD:
  → 임시 파일(.ai-workflow/current/.prompt-tmp)에 저장
  → CLI 인자: 파일 참조 프롬프트
ELSE:
  → CLI 인자: 직접 전달 (-p "prompt")
```

**Constraint**: 임시 프롬프트 파일은 프로세스 완료 후 반드시 삭제한다.

---

## BR-03: 타임아웃 처리 규칙

**Rule**: AI CLI 프로세스의 실행 시간이 설정된 timeout을 초과하면 단계적으로 종료한다.

```
1단계: SIGTERM 전송 (graceful 종료 요청)
2단계: 5초 대기
3단계: 여전히 alive이면 SIGKILL 전송 (강제 종료)
4단계: AgentTimeoutError 발생
```

**Constraint**: 타임아웃 기본값은 WorkflowConfig.iterationTimeout (300000ms = 5분). 프로세스당 적용.

---

## BR-04: 산출물 검증 규칙

**Rule**: Planning 완료 후 3개 산출물 파일이 모두 존재하고 유효해야 한다.

| 파일 | 존재 필수 | 최소 길이 | 형식 검증 |
|---|---|---|---|
| requirements.md | 필수 | 10자 | # 헤더 포함 |
| implementation-spec.md | 필수 | 10자 | # 헤더 포함 |
| test-scenarios.md | 필수 | 10자 | # 헤더 포함 |

**Constraint**: 하나라도 미충족 시 AgentOutputError 발생. 재시도는 상위 레이어(PipelineService)에서 결정.

---

## BR-05: Review 결과 파싱 규칙

**Rule**: Claude의 리뷰 출력에서 JSON을 추출하는 우선순위:

```
1순위: ```json ... ``` 코드 블록 내 JSON
2순위: stdout에서 { "status": ... } 패턴 매칭
3순위: stdout 전체를 ReviewRawOutput으로 전달 (ReviewEngine이 텍스트 파싱)
```

**Constraint**: JSON 파싱 실패는 에러가 아니다. ReviewEngine이 텍스트 기반으로 처리할 수 있다.

---

## BR-06: 변경 파일 수집 규칙

**Rule**: Codex 구현 완료 후 변경된 파일은 git으로 수집한다.

```
수집 방법:
1. git diff --name-only HEAD (committed 이후 변경)
2. git status --porcelain (untracked 포함)

필터링:
- .ai-workflow/ 내부 파일 제외
- .git/ 내부 파일 제외
- node_modules/ 제외
```

**Constraint**: changedFiles가 빈 배열이면 경고 로그 출력 (구현 실패 의심). 에러는 아님.

---

## BR-07: 재기획 스코프 규칙

**Rule**: 재기획 시 reworkScope에 따라 프롬프트 전략이 달라진다.

| reworkScope | 프롬프트 전략 | 기존 산출물 |
|---|---|---|
| partial | 피드백 항목만 수정 요청 | Claude가 기존 파일 수정 |
| full | 처음부터 재설계 요청 | Claude가 새로 생성 (덮어쓰기) |

**Constraint**: reworkScope 결정은 이 유닛의 책임이 아님 (ReviewEngine 또는 사용자가 결정).

---

## BR-08: 에러 전파 규칙

**Rule**: Agent 에러는 항상 상위(PipelineService)로 전파하되, 이미 생성된 산출물은 보존한다.

```
에러 발생 시:
1. 에러 로그 기록 (error 레벨)
2. stdout/stderr 마지막 500자 에러 컨텍스트에 포함
3. 이미 생성된 파일은 삭제하지 않음 (워킹 디렉토리 보존)
4. 에러를 throw (상위에서 재시도/중단 결정)
```

**Constraint**: Agent는 자체적으로 재시도하지 않는다. 재시도 로직은 PipelineService/Orchestrator 책임.

---

## BR-09: stdout 실시간 로깅 규칙

**Rule**: AI CLI의 stdout은 실시간으로 로거에 전달하되, 터미널 출력 레벨은 debug이다.

```
stdout 데이터 수신 시:
1. 버퍼에 누적 (최종 결과용)
2. Logger.debug()에 전달 (파일 로그에 기록)
3. 특정 패턴 감지 시 info 레벨로 승격:
   - "Writing file:" → Logger.info("파일 생성: <path>")
   - "Error:" → Logger.warn("에이전트 경고: <message>")
```

**Constraint**: 일반 사용자의 터미널에는 에이전트의 raw output이 표시되지 않는다 (logLevel=info 기준).

---

## BR-10: CLI 인자 구성 규칙

**Rule**: 각 에이전트 CLI 호출 시 다음 인자를 사용한다.

**Claude Code:**
```
Planning: claude -p "<prompt>" --output-format text
Review:   claude -p "<prompt>" --output-format text
```

**Codex:**
```
Implement: codex -q "<prompt>" --approval-mode full-auto
```

**Constraint**: 인자 형식은 각 CLI 도구의 버전에 따라 달라질 수 있으므로, 설정으로 오버라이드 가능해야 한다 (향후 확장).

---

## BR-11: 프로세스 동시 실행 금지 규칙

**Rule**: 하나의 워크플로우 내에서 AI CLI 프로세스는 한 번에 하나만 실행한다.

```
순서: plan() → implement() → review() (순차 실행)
동시 실행 금지: 같은 프로젝트에서 두 개의 AI CLI를 동시에 실행하지 않음
이유: 같은 cwd에서 동시 파일 수정 시 충돌 가능
```

**Constraint**: 병렬 워크플로우는 서로 다른 프로젝트를 대상으로 하므로 cwd가 다르다. 같은 프로젝트 내에서만 순차 보장.
