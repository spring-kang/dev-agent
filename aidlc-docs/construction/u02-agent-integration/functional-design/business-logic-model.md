# Business Logic Model - U-02: Agent Integration

## 1. ClaudeAgent (C-03)

### 1.1 CLI 프로세스 생성 전략

```typescript
spawn(args: string[], options: SpawnOptions): Promise<ProcessResult>

SpawnOptions:
- cwd: string         // 대상 프로젝트 경로
- timeout: number     // ms (기본: iterationTimeout)
- env: NodeJS.ProcessEnv // 부모 프로세스 환경변수 상속

실행 방식:
- child_process.spawn(claudePath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
- stdout: 실시간 캡처 + Logger에 전달 (debug 레벨)
- stderr: 캡처하여 에러 분석용 보관
- 종료 코드 감시: exitCode !== 0 이면 에러 처리
```

**프로세스 환경:**
```
상속: 부모 프로세스의 모든 환경변수
추가/오버라이드: 없음 (Claude CLI의 인증은 기존 환경변수/세션 활용)
```

### 1.2 Planning 모드 프롬프트 구성

**plan(request: PlanRequest): Promise<PlanResult>**

```
Input:
- taskDescription: string      (작업 설명)
- cwd: string                  (대상 프로젝트 경로)
- previousFeedback?: ReviewResult  (이전 리뷰 피드백, 있으면)
- reworkScope: "partial" | "full"

프롬프트 구성 로직:

IF 첫 사이클 (previousFeedback 없음):
  prompt = buildInitialPlanPrompt(taskDescription, cwd)

IF 재기획 (previousFeedback 있음):
  IF reworkScope === "partial":
    prompt = buildPartialReworkPrompt(taskDescription, previousFeedback)
  ELSE:
    prompt = buildFullReworkPrompt(taskDescription, previousFeedback)
```

**Initial Plan Prompt 템플릿:**
```
당신은 소프트웨어 설계자입니다. 다음 작업을 분석하고 기획 산출물을 생성해주세요.

## 작업 요청
{taskDescription}

## 프로젝트 컨텍스트
현재 작업 디렉토리의 코드베이스를 분석하여 기존 구조를 파악한 후 작업을 수행해주세요.

## 생성할 산출물
다음 3개 파일을 .ai-workflow/current/ 디렉토리에 생성해주세요:

1. **requirements.md** - 요구사항 정의
   - 기능 요구사항 목록
   - 비기능 요구사항
   - 제약사항

2. **implementation-spec.md** - 구현 지시서
   - 구현할 파일 목록과 각 파일의 역할
   - 주요 함수/클래스 시그니처
   - 단계별 구현 순서
   - 테스트 작성 지시

3. **test-scenarios.md** - 테스트 시나리오
   - 단위 테스트 시나리오
   - 통합 테스트 시나리오
   - 엣지 케이스

각 파일은 Markdown 형식으로, Codex가 이해할 수 있도록 구체적이고 명확하게 작성해주세요.
```

**Partial Rework Prompt 템플릿:**
```
이전 구현에 대한 코드 리뷰 피드백이 있습니다. 이 피드백을 반영하여 기획 산출물을 수정해주세요.

## 원본 작업 요청
{taskDescription}

## 이전 리뷰 피드백
{previousFeedback.summary}

### 발견된 이슈들:
{previousFeedback.findings.map(f => `- [${f.severity}] ${f.location}: ${f.description}\n  제안: ${f.suggestion}`)}

## 요청사항
위 피드백을 반영하여 .ai-workflow/current/ 디렉토리의 기존 산출물을 수정해주세요.
- requirements.md: 누락된 요구사항 추가
- implementation-spec.md: 피드백 반영하여 구현 지시 수정
- test-scenarios.md: 실패한 시나리오 보강
```

**Full Rework Prompt 템플릿:**
```
이전 구현이 근본적인 설계 문제로 인해 재기획이 필요합니다.

## 원본 작업 요청
{taskDescription}

## 이전 리뷰 피드백 (전체 재기획 사유)
{previousFeedback.summary}

### Critical/Major 이슈들:
{previousFeedback.findings.filter(f => f.severity === "critical" || f.severity === "major")}

## 요청사항
처음부터 다시 설계하여 .ai-workflow/current/ 디렉토리에 산출물 3개를 새로 생성해주세요.
이전 피드백의 근본 원인을 해결하는 방향으로 설계해주세요.
```

**실행:**
```
args = ["-p", prompt, "--output-format", "text"]
// 또는 프롬프트가 길면:
// 프롬프트를 .ai-workflow/current/.prompt-tmp 에 저장 후
args = ["-p", "Read the file at .ai-workflow/current/.prompt-tmp and follow all instructions in it exactly.", "--output-format", "text"]
```

### 1.3 Review 모드 프롬프트 구성

**review(request: ReviewRequest): Promise<ReviewRawOutput>**

```
Input:
- cwd: string
- changedFiles: string[]       (변경된 파일 목록)
- requirementsPath: string     (요구사항 문서 경로)
- testScenariosPath: string    (테스트 시나리오 경로)

프롬프트 구성:
```

**Review Prompt 템플릿:**
```
당신은 시니어 코드 리뷰어입니다. 다음 변경사항을 종합적으로 리뷰해주세요.

## 변경된 파일
{changedFiles.join('\n')}

## 요구사항 (기준)
{requirementsPath}의 내용을 읽어서 요구사항 충족 여부를 판단해주세요.

## 테스트 시나리오 (기준)
{testScenariosPath}의 내용을 읽어서 테스트 커버리지를 판단해주세요.

## 리뷰 체크리스트 (모든 항목 검증 필수)
1. **빌드/컴파일**: 코드가 에러 없이 빌드되는지
2. **테스트**: 테스트가 통과하는지 (테스트 실행 가능하면 실행)
3. **보안**: OWASP Top 10 취약점 (인젝션, XSS 등)
4. **설계 준수**: requirements.md 대비 구현 일치 여부
5. **코드 품질**: 네이밍, SOLID, 중복 코드, 구조
6. **에러 처리**: 적절한 예외 처리, 실패 시 동작
7. **성능**: N+1 쿼리, 불필요한 반복, 메모리 누수

## 출력 형식 (반드시 이 JSON 형식으로 출력)
```json
{
  "status": "APPROVED" | "CHANGES_REQUESTED",
  "checks": [
    { "name": "build", "passed": true/false, "details": "..." },
    { "name": "tests", "passed": true/false, "details": "..." },
    { "name": "security", "passed": true/false, "details": "..." },
    { "name": "design", "passed": true/false, "details": "..." },
    { "name": "codeQuality", "passed": true/false, "details": "..." },
    { "name": "errorHandling", "passed": true/false, "details": "..." },
    { "name": "performance", "passed": true/false, "details": "..." }
  ],
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "location": "파일:라인",
      "description": "이슈 설명",
      "suggestion": "수정 제안"
    }
  ],
  "summary": "전체 리뷰 요약"
}
```

모든 체크항목이 passed=true여야 status="APPROVED"입니다.
하나라도 passed=false이면 status="CHANGES_REQUESTED"입니다.
```

### 1.4 stdout/stderr 캡처 및 파이프 처리

```
프로세스 출력 처리:

stdout:
1. 실시간으로 Logger.debug()에 전달 (파일 로그에 기록)
2. 전체 내용을 버퍼에 누적 (ProcessResult.stdout)
3. 진행 상태 패턴 감지:
   - "Writing file:" → Logger.info("파일 생성: <path>")
   - 기타: 무시 (debug 레벨만)

stderr:
1. 전체 내용을 버퍼에 누적 (ProcessResult.stderr)
2. 비어있지 않으면 Logger.warn()에 기록

프로세스 종료:
- exitCode: number
- 종료 시 stdout, stderr 버퍼 최종 반환
```

### 1.5 산출물 파일 파싱 로직

```
Planning 완료 후:
1. 기대 파일 경로 체크:
   - <cwd>/.ai-workflow/current/requirements.md
   - <cwd>/.ai-workflow/current/implementation-spec.md
   - <cwd>/.ai-workflow/current/test-scenarios.md

2. 각 파일 존재 여부 확인:
   - 존재: 경로를 PlanResult에 기록
   - 미존재: 에러 (Claude가 파일 생성에 실패한 것)

3. 파일 내용 기본 검증:
   - 비어있지 않은지 (최소 10자 이상)
   - Markdown 형식인지 (# 헤더 포함)

Review 완료 후:
1. stdout에서 JSON 블록 추출:
   - ```json ... ``` 패턴 찾기
   - 또는 { "status": ... } 패턴 찾기
2. JSON 파싱 시도
3. 파싱 실패 시: stdout 전체를 ReviewRawOutput으로 전달 (ReviewEngine이 처리)
```

### 1.6 타임아웃 및 에러 처리

```
타임아웃:
- setTimeout으로 제한 시간 설정
- 시간 초과 시:
  1. child process에 SIGTERM 전송
  2. 5초 대기
  3. 여전히 살아있으면 SIGKILL 전송
  4. AgentTimeoutError 발생

에러 유형:
1. AgentTimeoutError: 타임아웃 초과
2. AgentProcessError: exitCode !== 0
3. AgentOutputError: 산출물 파일 미생성 또는 파싱 실패

에러 복구:
- 모든 에러는 상위(PipelineService)로 전파
- 에러 발생 시에도 이미 생성된 산출물은 보존
- 에러 메시지에 stdout/stderr 마지막 500자 포함 (디버깅용)
```

---

## 2. CodexAgent (C-04)

### 2.1 CLI 프로세스 생성 전략

```typescript
implement(request: ImplementRequest): Promise<ImplementResult>

실행 방식:
- child_process.spawn(codexPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
- codex는 full-auto 모드로 실행 (모든 변경 자동 승인)
- cwd: 대상 프로젝트 경로

환경변수:
- 부모 프로세스 환경변수 상속
- Codex 인증은 기존 세션 활용
```

### 2.2 구현 지시 프롬프트 구성

```
Input:
- implementationSpecPath: string  (.ai-workflow/current/implementation-spec.md)
- cwd: string
- timeout: number

프롬프트 구성:
- 파일 참조 패턴 사용 (implementation-spec.md는 길 수 있으므로)

args = [
  "-q",                              // quiet 모드
  "Read the implementation spec at .ai-workflow/current/implementation-spec.md and implement all changes described in it. Follow the instructions exactly. Write all code files and tests as specified.",
  "--approval-mode", "full-auto"     // 모든 파일 변경 자동 승인
]
```

**프롬프트가 긴 경우 대체 방식:**
```
// implementation-spec.md 내용을 직접 프롬프트에 포함하지 않고 파일 참조
prompt = `Read and follow all instructions in the file: ${implementationSpecPath}.
Implement every change described. Create all files and tests exactly as specified.
Do not ask for clarification - implement based on the spec as written.`
```

### 2.3 변경 파일 목록 수집

```
구현 완료 후 변경 파일 수집 방법:

1차: git diff로 수집 (가장 정확)
   git diff --name-only HEAD
   → 마지막 커밋 이후 변경/추가된 파일 목록

2차: git status로 보충
   git status --porcelain
   → untracked 파일 포함

수집 결과:
- changedFiles: string[] (상대 경로 목록)
- .ai-workflow/ 내부 파일은 제외 (산출물은 변경 목록에 포함하지 않음)
- 빈 배열이면 경고 (Codex가 변경을 생성하지 않은 것)
```

### 2.4 타임아웃 및 에러 처리

```
타임아웃: ClaudeAgent와 동일한 패턴
- SIGTERM → 5초 대기 → SIGKILL

에러 유형:
1. AgentTimeoutError: 타임아웃 초과 (구현이 복잡하여 오래 걸림)
2. AgentProcessError: exitCode !== 0
3. AgentOutputError: 변경 파일이 0개 (구현 실패 의심)

에러 복구:
- 에러 발생 시에도 이미 생성된 파일은 보존 (워킹 디렉토리에 남음)
- 에러 정보와 함께 상위로 전파
```

---

## 3. 공통: 프로세스 라이프사이클

```
Agent CLI 호출 전체 흐름:

1. 프롬프트 구성
   └── 템플릿 + 컨텍스트 조합
   └── 길이 체크: > 100KB이면 파일 참조 패턴 사용

2. 프로세스 생성
   └── spawn(path, args, { cwd, env, stdio })
   └── 타이머 시작 (timeout)

3. 출력 스트림 처리
   └── stdout: 버퍼 누적 + 실시간 로깅
   └── stderr: 버퍼 누적

4. 프로세스 종료 대기
   └── 정상 종료: exitCode 체크
   └── 타임아웃: SIGTERM → SIGKILL
   └── 에러: throw AgentError

5. 결과 수집
   └── stdout 파싱 (JSON 추출 등)
   └── 산출물 파일 존재 확인
   └── 변경 파일 목록 수집 (git diff)

6. 결과 반환
   └── PlanResult 또는 ImplementResult 또는 ReviewRawOutput
```

---

## 4. 피드백 기반 재기획 로직

```
CHANGES_REQUESTED 수신 시 재기획 흐름:

1. ReviewResult 수신 (PipelineService에서 전달)

2. reworkScope 결정 (사용자 선택 또는 ReviewEngine 추천):
   - "partial": 피드백 항목만 수정
   - "full": 처음부터 재기획

3. ClaudeAgent.plan() 재호출:
   - previousFeedback: ReviewResult 전체 전달
   - reworkScope: 위에서 결정된 값

4. 이전 산출물 처리:
   - partial: 기존 파일을 Claude가 수정 (덮어쓰기)
   - full: 기존 파일을 새로 생성 (덮어쓰기)

5. 새 산출물 검증: 1.5와 동일한 파싱 로직
```

---

## 5. 프롬프트 길이 관리

```
임계값: PROMPT_FILE_THRESHOLD = 100 * 1024 (100KB)

판단 로직:
IF prompt.length > PROMPT_FILE_THRESHOLD:
  1. 프롬프트를 .ai-workflow/current/.prompt-tmp 에 저장
  2. 실제 CLI 인자: "Read the file at .ai-workflow/current/.prompt-tmp and follow all instructions exactly."
  3. 실행 완료 후 .prompt-tmp 삭제
ELSE:
  1. 프롬프트를 CLI 인자로 직접 전달: -p "prompt"
```
