# Business Logic Model - U-04: Git & PR

## 1. GitManager (C-06)

### 1.1 브랜치 생성

**createBranch(projectPath: string, taskSummary: string): Promise<string>**

```
Input: 프로젝트 경로, 작업 설명 문자열

브랜치명 생성 로직:
1. timestamp = YYYYMMDD-HHmmss (현재 시각)
2. slug = taskSummary를 slug화:
   - 한글/특수문자 제거 또는 영문 변환
   - 공백 → 하이픈
   - 소문자 변환
   - 최대 50자로 truncate
   - 연속 하이픈 제거
   - 예: "로그인 기능 추가" → "login-feature" (한글은 제거)
   - 예: "Add user authentication" → "add-user-authentication"
3. branchName = `${branchPrefix}/${timestamp}-${slug}`
   - 예: "ai/20260601-143205-add-user-authentication"

실행:
1. git checkout -b <branchName> (cwd: projectPath)
2. 성공 시 branchName 반환
3. 브랜치명 충돌 시: suffix 추가 (-2, -3 등)

반환: 생성된 브랜치명 (string)
```

### 1.2 변경사항 커밋

**commit(projectPath: string, cycleNumber: number, message?: string): Promise<string>**

```
Input: 프로젝트 경로, 사이클 번호, 선택적 커밋 메시지

커밋 메시지 구성:
- 기본 포맷: `[ai-cycle-${cycleNumber}] ${message || "Auto-generated code changes"}`
- 예: "[ai-cycle-1] Auto-generated code changes"
- 예: "[ai-cycle-2] Rework based on review feedback"

실행:
1. git add -A (cwd: projectPath) - 모든 변경사항 스테이징
2. git status --porcelain - 커밋할 내용 확인
3. 변경사항 없으면 빈 문자열 반환 (커밋하지 않음)
4. git commit -m "<message>" (cwd: projectPath)
5. 성공 시 커밋 SHA 반환

반환: 커밋 SHA (string) 또는 "" (변경 없음)
```

### 1.3 PR 생성

**createPullRequest(request: PrRequest): Promise<string>**

```
Input: PrRequest { projectPath, branchName, baseBranch, title, body }

실행:
1. gh pr create \
     --base <baseBranch> \
     --head <branchName> \
     --title "<title>" \
     --body "<body>" \
     (cwd: projectPath)
2. stdout에서 PR URL 추출
3. PR URL 반환

PR Title 형식:
- `[AI] ${taskSummary}`
- 예: "[AI] Add user authentication"

에러 처리:
- gh CLI 미인증: PrerequisiteError
- remote 미설정: GitError
- 이미 PR 존재: 경고 + 기존 PR URL 반환
```

### 1.4 브랜치 Push

**push(projectPath: string, branchName: string): Promise<void>**

```
실행:
1. git push -u origin <branchName> (cwd: projectPath)
2. 실패 시 GitError 발생

에러 케이스:
- remote 미설정: "remote 'origin'이 설정되지 않았습니다"
- 인증 실패: "Git push 인증 실패. 'gh auth login'을 확인해주세요"
- 네트워크 에러: "네트워크 연결을 확인해주세요"
```

### 1.5 Dirty State 확인

**checkDirtyState(projectPath: string): Promise<DirtyStateInfo>**

```
실행:
1. git status --porcelain (cwd: projectPath)
2. 출력 파싱:
   - ?? <file> → untrackedFiles
   - M <file> 또는 " M" <file> → modifiedFiles
   - A <file> → modifiedFiles
   - D <file> → modifiedFiles

반환:
- isDirty: (untrackedFiles.length + modifiedFiles.length) > 0
- untrackedFiles: string[]
- modifiedFiles: string[]
```

---

## 2. GitService (S-03)

### 2.1 워크플로우 초기화

**initWorkflow(projectPath: string, taskSummary: string, config: WorkflowConfig): Promise<GitInitResult>**

```
순서:
1. checkDirtyState(projectPath)
   - isDirty → 경고 로그 + 계속 진행 (blocking 하지 않음)

2. createBranch(projectPath, taskSummary)
   - 브랜치 생성
   - branchName 반환

반환:
GitInitResult {
  branchName: string;
  hadDirtyState: boolean;
  dirtyFiles?: DirtyStateInfo;
}
```

### 2.2 워크플로우 완료

**finalize(projectPath: string, branchName: string, config: WorkflowConfig, context: FinalizeContext): Promise<FinalizeResult>**

```
Input:
- projectPath: 프로젝트 경로
- branchName: 작업 브랜치명
- config: 워크플로우 설정
- context: { taskDescription, reviewHistory, totalCycles }

순서:
1. push(projectPath, branchName)

2. PR 본문 생성:
   body = buildPrBody(context)

3. createPullRequest({
     projectPath,
     branchName,
     baseBranch: config.baseBranch,
     title: `[AI] ${taskSummary}`,
     body
   })

반환:
FinalizeResult {
  prUrl: string;
  branchName: string;
}
```

### 2.3 PR 본문 생성 로직

**buildPrBody(context: FinalizeContext): string**

```
PR 본문 템플릿:

## 작업 요약
{context.taskDescription}

## 변경 사항
- 총 {context.totalCycles}회 AI 개발 사이클 수행
- 최종 리뷰 결과: APPROVED

## 리뷰 사이클 히스토리
| Cycle | 결과 | 주요 변경 |
|---|---|---|
{context.reviewHistory.map(r => `| ${r.cycleNumber} | ${r.status} | ${r.summary} |`)}

## 최종 리뷰
{context.reviewHistory[last].summary}

---
> 이 PR은 AI 에이전트(dev-agent)에 의해 자동 생성되었습니다.
> - Planning: Claude Code
> - Implementation: Codex
> - Review: Claude Code
```

---

## 3. Git 명령 실행 (내부 유틸)

```
모든 git/gh 명령 실행 패턴:

exec(command: string, args: string[], cwd: string): Promise<ExecResult>

1. child_process.spawn("git" | "gh", args, { cwd })
2. stdout/stderr 캡처
3. exitCode 확인
4. exitCode !== 0 → GitError 발생 (stderr 포함)
5. 성공 시 stdout 반환

타임아웃: 30초 (git 명령은 빠르므로 짧은 timeout)
```
