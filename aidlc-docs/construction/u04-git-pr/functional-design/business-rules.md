# Business Rules - U-04: Git & PR

## BR-01: 브랜치 네이밍 규칙

**Rule**: 작업 브랜치는 `{branchPrefix}/{timestamp}-{slug}` 형식으로 생성한다.

```
형식: ai/YYYYMMDD-HHmmss-<slug>
slug 생성 규칙:
- 영문/숫자/하이픈만 허용
- 한글, 특수문자 제거
- 공백 → 하이픈
- 소문자 변환
- 최대 50자
- 연속 하이픈 제거
- 끝/시작 하이픈 제거
```

**Constraint**: 브랜치명이 기존 브랜치와 충돌하면 `-2`, `-3` 등 suffix를 추가한다.

---

## BR-02: 커밋 메시지 규칙

**Rule**: AI 생성 커밋은 사이클 번호를 포함하는 표준 형식을 따른다.

```
형식: [ai-cycle-{N}] {message}
예시:
- [ai-cycle-1] Auto-generated code changes
- [ai-cycle-2] Rework based on review feedback
- [ai-cycle-3] Final fixes after review
```

**Constraint**: 커밋 메시지는 항상 영문으로 작성 (git log 호환성).

---

## BR-03: 빈 커밋 방지 규칙

**Rule**: 스테이징된 변경사항이 없으면 커밋을 생성하지 않는다.

```
1. git add -A
2. git status --porcelain
3. 출력이 비어있으면 → 빈 문자열 반환 (커밋 없음)
4. 출력이 있으면 → git commit 실행
```

**Constraint**: 빈 커밋은 절대 생성하지 않는다. 에러도 아님.

---

## BR-04: Dirty State 경고 규칙

**Rule**: 워크플로우 시작 시 dirty working tree가 감지되면 경고하지만 실행을 차단하지 않는다.

```
dirty state 감지 시:
1. Logger.warn("⚠️  작업 중인 변경사항이 감지되었습니다:")
2. 변경 파일 목록 출력 (최대 10개, 초과 시 "외 N개")
3. 워크플로우 계속 진행
```

**Constraint**: 사용자에게 경고만 출력. 실행을 중단하거나 확인을 요청하지 않는다 (완전 자동 모드).

---

## BR-05: PR 본문 필수 포함 사항 규칙

**Rule**: PR 본문에는 다음 항목이 반드시 포함되어야 한다.

| 섹션 | 필수 | 내용 |
|---|---|---|
| 작업 요약 | 필수 | 원본 taskDescription |
| 변경 사항 | 필수 | 총 사이클 수, 최종 상태 |
| 리뷰 히스토리 | 필수 (reviewSummary 설정 시) | 사이클별 결과 테이블 |
| AI 생성 표시 | 필수 | 자동 생성 고지 + 도구 정보 |

**Constraint**: `config.prIncludeReviewSummary === false`이면 리뷰 히스토리 섹션 생략.

---

## BR-06: Push 전 브랜치 확인 규칙

**Rule**: push 전에 현재 브랜치가 작업 브랜치인지 확인한다.

```
1. git branch --show-current
2. 현재 브랜치 === 예상 작업 브랜치인지 확인
3. 불일치 시 GitError (잘못된 브랜치에서 push 시도 방지)
```

**Constraint**: main/master 브랜치에서의 push를 방지한다.

---

## BR-07: Git 명령 타임아웃 규칙

**Rule**: git/gh 명령은 30초 타임아웃을 적용한다.

```
일반 git 명령 (add, commit, status, branch): 30초
push: 60초 (네트워크 작업)
gh pr create: 60초 (네트워크 작업)
```

**Constraint**: 타임아웃 시 GitTimeoutError 발생.

---

## BR-08: PR 중복 생성 방지 규칙

**Rule**: 동일 브랜치에 이미 열린 PR이 있으면 새 PR을 생성하지 않는다.

```
1. gh pr list --head <branchName> --state open
2. 결과 있으면 → 기존 PR URL 반환 + 경고 로그
3. 결과 없으면 → 새 PR 생성
```

**Constraint**: 중복 PR은 에러가 아니라 경고로 처리.

---

## BR-09: Slug 생성 시 fallback 규칙

**Rule**: taskSummary가 한글만으로 구성되어 slug이 빈 문자열이 되면 fallback을 사용한다.

```
slug 생성 후:
IF slug === "":
  slug = "auto-task"
IF slug.length < 3:
  slug = "task-" + slug
```

**Constraint**: 브랜치명의 slug 부분은 항상 3자 이상이어야 한다.
