---
name: devagent-planner
description: dev-agent 워크플로우의 "기획(Planning)" 단계를 Claude Code 안에서 수동으로 수행하기 위한 스킬. Notion task 본문을 읽어 요구사항·구현 명세·테스트 시나리오를 작성하고, 사용자가 검토 후 Notion Status 를 "Approved" 로 직접 전환하면 `devagent build <pageId>` 로 자동 구현이 시작된다.
---

# devagent-planner

dev-agent 의 새로운 흐름은 **기획은 사람(+Claude Code)이, 구현은 Codex 가** 담당하도록 분리되었다.
이 스킬은 **기획 단계 전반**을 Claude Code 안에서 수행하기 위한 절차/체크리스트를 제공한다.

## When to use

다음과 같은 요청이 들어오면 이 스킬을 사용한다:

- "Notion task `<pageId>` 기획해줘"
- "이 티켓 요구사항/구현 명세/테스트 시나리오 정리해줘"
- "dev-agent 로 돌릴 수 있게 명세 다듬어줘"
- "aidlc 설계 참고해서 기획해줘" / "이 모듈 설계대로 명세 만들어줘"
- 사용자가 Notion URL/페이지 ID 를 던지며 plan 단계를 시작하려는 모든 경우
- **(수정 모드)** "이 티켓 댓글 반영해줘" / "`<pageId>` 댓글대로 기획 고쳐줘" /
  "Notion 댓글 보고 명세 수정해줘" → 아래 **"수정 모드 (Notion 댓글 반영)"** 절차 사용

> 프로젝트에 `aidlc-docs/` 가 있으면 (AI-DLC 사전 설계 프로젝트) — Step 2.5 가 자동으로
> 관련 유닛 설계 문서를 찾아 읽어 명세에 반영한다. 사용자가 따로 경로를 주지 않아도 된다.

> **주의**: 구현(Codex spawn) 은 이 스킬의 범위가 아니다.
> 사용자가 Notion 에서 Status 를 "Approved" 로 바꾼 뒤 `devagent build <pageId>` 로 실행한다.

## 입력

- `pageId` 또는 Notion URL (32-hex 또는 UUID 포맷 모두 허용)
- 선택: 프로젝트 경로 (보통 Notion `Project Path` 속성에서 읽음 — **build 실행용 로컬 경로**)
- 선택: GitHub repo URL (Notion `Repository` 속성에서 읽음 — **기획 시 현황 파악용 진실의 원천**)

## 전제 조건

스킬 실행 전에 다음이 갖춰져 있어야 한다:

1. `devagent` CLI 가 설치되어 있고 PATH 에 등록됨 (`devagent --version` 확인)
2. Notion 인증 완료 (`devagent notion test` 가 `✅` 응답)
3. 대상 페이지가 Notion Integration 의 Connections 에 추가됨
4. `gh` CLI 가 설치·인증됨 (`gh auth status`) — Step 2 의 GitHub repo 현황 조회용

전제가 안 맞으면 `devagent notion status` 출력을 사용자에게 보여주고 멈춘다.

## 실행 절차

### Step 1 — Notion task 본문 가져오기

`Bash` 도구로 task 본문을 markdown 파일로 추출한다:

```bash
devagent notion pull <pageIdOrUrl> -o /tmp/devagent-task.md
```

- 본문(`/tmp/devagent-task.md`) 을 `Read` 도구로 읽는다.
- 본문 첫 줄의 H1 (`# 제목`) 을 task 제목으로 인식한다.
- `## 목표`, `## 컨텍스트`, `## 요구사항`, `## 수용 기준` 섹션이 있으면 그 구조를 그대로 살린다.

### Step 2 — 코드베이스 현황 파악 (GitHub repo main 우선)

> 🎯 **원칙: "다음 task 가 어느 브랜치 위에서 시작되는가" 를 기준으로 현황을 본다.**
> 로컬 체크아웃은 stale(머지 안 된 선행 PR 미반영, 기기마다 다름)할 수 있으므로,
> **무엇이 이미 만들어졌나(엔티티/스키마/API 등)** 는 **GitHub repo 의 머지된 main + 열린 PR** 을
> 진실의 원천으로 삼는다. 로컬 `Project Path` 는 build 실행 전용이다.

#### 2-1. 대상 repo 식별 + 원격 현황 조회 (우선)

1. Notion `Repository` 속성에서 GitHub repo URL 을 읽는다. (없으면 사용자에게 1회 확인)
2. `gh` 로 **머지된 main 기준 현황** + **진행 중/머지된 PR** 을 파악한다:
   ```bash
   gh repo view <owner/repo>
   gh pr list --repo <owner/repo> --state all --limit 20
   ```
   - 선행 task 가 **미머지 PR** 로만 존재하면(예: identity-1 = PR #1 미머지),
     그 PR 브랜치를 현황 기준으로 삼는다: `gh pr diff <n> --repo <owner/repo>` /
     `gh pr view <n> --repo <owner/repo>`.
   - 특정 파일 내용 확인은 `gh api repos/<owner/repo>/contents/<path>?ref=<branch>` 또는
     `gh browse` 로 확인한다.
3. 본문에 명시된 **대상 파일/경로** 가 있으면 그 파일을 repo 기준으로 확인한다.
4. 절대 추측만으로 명세를 작성하지 않는다 — 모르면 묻거나 repo 를 읽는다.

#### 2-2. 로컬 보조 참조 (선택)

- 로컬 체크아웃이 main 과 동기화돼 있고(`git -C <projectPath> fetch && git status` 로 확인),
  미머지 선행 PR 의 영향이 없다면 로컬 파일을 보조로 `Read` 해도 된다.
- 단, **로컬이 stale 하면 GitHub 현황을 우선**한다. 로컬 main 이 선행 PR 미반영이면 그 사실을 명시한다.
- 설계 문서(`aidlc-docs/`)는 보통 repo·로컬 동일하므로 Step 2.5 에서 로컬/repo 어느 쪽이든 읽으면 된다.

### Step 2.5 — AI-DLC 설계 문서 자동 참조 (프로젝트에 `aidlc-docs/` 가 있을 때)

기획 대상 프로젝트 루트에 **`aidlc-docs/` 디렉토리가 존재하면**, 그 안의 설계 문서를
명세 작성의 1차 근거로 **반드시** 읽는다. (AI-DLC 방식으로 사전 설계된 프로젝트)

> 프로젝트 루트는 다음 순서로 판단: ① 사용자가 알려준 경로 → ② Notion `Project Path` 속성
> → ③ 현재 claude 가 열린 작업 디렉토리. `aidlc-docs/aidlc-state.md` 가 보이면 AI-DLC 프로젝트로 간주.

#### 2.5-1. 유닛(모듈) 식별

AI-DLC 프로젝트는 `aidlc-docs/construction/<unit>/` 형태로 **모듈(유닛)별** 설계가 나뉘어 있다.
다음 순서로 이 task 가 어느 유닛인지 식별한다:

1. `Glob` 로 유닛 목록 확인: `aidlc-docs/construction/*/`
   (예: auth, identity, matching, interview, learning, community, admin,
   notification, filestorage, raginfra, seminar, aigateway, system, scaffolding)
2. **Notion task 제목·본문의 키워드** 를 유닛 폴더명/도메인과 매칭한다.
   - 명시적 태그 우선: 제목에 `[matching]`, `[auth]` 처럼 유닛명이 있으면 그대로 사용.
   - 키워드 매칭: "로그인/회원가입" → `auth`, "팀 매칭/공모전" → `matching`,
     "AI 면접" → `interview`, "강의/학습" → `learning` 등.
3. 매칭이 **애매하거나 2개 이상** 후보면 — 후보 유닛 목록을 제시하고 **사용자에게 1회 확인**한다.
   추측으로 단정하지 않는다.

#### 2.5-2. 관련 설계 문서 Read

식별된 유닛이 `<unit>` 일 때, 다음을 `Read` 로 읽는다 (존재하는 것만):

- **유닛 설계** (가장 중요):
  - `aidlc-docs/construction/<unit>/functional-design/functional-design.md`
  - `aidlc-docs/construction/<unit>/functional-design/domain-entities.md`
  - `aidlc-docs/construction/<unit>/functional-design/business-rules.md`
  - `aidlc-docs/construction/<unit>/functional-design/business-logic-model.md`
- **공통 설계** (시스템 전반 — 필요한 범위만):
  - `aidlc-docs/inception/application-design/services.md`
  - `aidlc-docs/inception/application-design/components.md`
  - `aidlc-docs/inception/user-stories/stories.md` (관련 US-* 스토리만 발췌)
  - `aidlc-docs/inception/requirements/requirements.md` (관련 NFR/요구사항만)
- **진행 상태**: `aidlc-docs/aidlc-state.md` (현재 단계·승인 상태·제약 파악)

> ⚠️ 토큰 절약: 전체를 무차별로 읽지 말고, **이 task 유닛과 직접 관련된 문서**만 선별해 읽는다.
> 공통 문서는 관련 섹션만 발췌 인용한다.

#### 2.5-3. 명세에 반영 + 추적성 유지

- 산출물(특히 `implementation-spec.md`)에 **참조한 설계 문서 경로를 명시**한다:
  ````markdown
  ## 참고 설계 (AI-DLC)
  - aidlc-docs/construction/<unit>/functional-design/domain-entities.md
  - aidlc-docs/inception/application-design/services.md
  ````
- 설계 문서의 **엔티티·경계 규칙(BR-*)·SPI/API 윤곽·의존 모듈**을 명세에 그대로 승계한다.
  새로 발명하지 말고, 설계와 **충돌하면 사용자에게 알린다**.
- 이 경로 목록은 Notion 본문 push 시에도 함께 올라가야, 이후 `build` 단계의 Codex·리뷰어가
  **같은 설계를 참조**할 수 있다 (build 는 코드가 있는 PC 의 `aidlc-docs/` 를 직접 보거나,
  Notion 본문에 적힌 경로/요약을 spec 으로 받는다).

### Step 3 — 산출물 3종 작성

작업 폴더 (`<projectPath>/.ai-workflow/current/artifacts/`) 가 없으면 만든다.
다음 3개 파일을 동일 폴더에 작성한다.

#### 3-1. `requirements.md` (요구사항)

다음 항목을 모두 포함:

- **배경 / 목적** (왜 필요한가)
- **기능 요구사항** (불릿, 측정 가능한 형태)
- **비기능 요구사항** (성능/보안/호환성, 해당되면)
- **범위 / 비범위** (이번 PR 에서 다루지 않는 것)
- **참고 자료** (관련 PR, 이슈 링크)

#### 3-2. `implementation-spec.md` (구현 명세)

**Codex 가 단독으로 실행 가능할 만큼 구체적이어야 한다.**

- **수정 파일 목록** (절대 경로, 신규/수정 표시)
- **각 파일별 변경 내용**
  - 함수 시그니처
  - 핵심 로직 의사 코드
  - 의존성 추가 시 패키지명/버전
- **데이터 흐름 / 시퀀스** (필요 시 mermaid)
- **커밋 메시지 제안** — 반드시 백틱으로 감싼 한 줄:
  ````markdown
  커밋 메시지: `feat(planner): 기획 산출물 자동 생성 추가`
  ````
  (dev-agent 가 정규식으로 추출해 git 커밋 메시지로 사용한다)
- **롤백 전략** (잘못됐을 때 어떻게 되돌리나)

#### 3-3. `test-scenarios.md` (테스트 시나리오)

- **단위 테스트** (입력/기대 출력 표)
- **통합 테스트** (사용자 흐름)
- **수용 기준** (자동 검증 가능한 형태로, 체크박스 형식)
- **회귀 위험** (어떤 기존 테스트가 영향받는지)

### Step 4 — 검토 요약

작성이 끝나면 사용자에게 다음 형식으로 요약을 출력한다:

```
✅ 기획 산출물 작성 완료

📄 requirements.md       (N줄)
📄 implementation-spec.md (N줄, 수정 파일 N개)
📄 test-scenarios.md     (N줄, 수용 기준 N개)

수정 예정 파일:
  - <abs path 1>
  - <abs path 2>

다음 단계:
  1. 위 산출물을 검토하세요.
  2. (선택) Notion 본문에 반영:
     devagent notion push <pageId> --from <projectPath>/.ai-workflow/current/artifacts/implementation-spec.md
  3. Notion 에서 Status 를 "Approved" 로 변경하세요.
  4. 구현 시작:
     devagent build <pageId> --project <projectPath>
```

### Step 5 — (선택) Notion 동기화

사용자가 "Notion 에도 올려줘" 라고 하면:

```bash
devagent notion push <pageIdOrUrl> --from <projectPath>/.ai-workflow/current/artifacts/implementation-spec.md
```

`notion push` 는 본문에 **append** 한다 (덮어쓰지 않음). 필요 시 어떤 파일을 push 할지 사용자에게 확인.

### Step 6 — Status 전환은 사용자가 직접

이 스킬은 **Notion Status 를 변경하지 않는다**.
사용자가 산출물을 검토하고 Notion 페이지에서 직접 `Approved` 로 전환해야 `devagent build` 가 진입 조건을 통과한다.

원한다면 사용자에게 다음을 안내:

```bash
devagent notion status <pageId> Approved
```

## 수정 모드 (Notion 댓글 반영)

이미 작성·push 된 기획에 대해 사용자가 **Notion 페이지에 댓글로 피드백**을 남긴 뒤
"댓글 반영해줘" 라고 요청하면, 다음 절차로 본문을 갱신한다.

> 전제: 처음 기획할 때처럼 Notion 인증·연결이 되어 있어야 한다. 댓글 조회는
> Integration 에 **"Read comments"** 권한이 필요하다 (`devagent notion comments`로 확인).

### R-1. 댓글 + 현재 본문 가져오기

```bash
devagent notion comments <pageIdOrUrl> -o /tmp/devagent-comments.md
devagent notion pull     <pageIdOrUrl> -o /tmp/devagent-task.md
```

- 두 파일을 `Read` 로 읽는다.
- `comments.md` 의 각 항목(`## 1. ...`)이 사용자의 수정 요청이다.
- Notion API 는 **열린(미해결) 댓글만** 반환한다. (이미 resolve 한 댓글은 안 나온다)

### R-2. 댓글 분석 + 명세 반영

- 각 댓글을 **무엇을 어떻게 바꾸라는 지시**로 해석해 본문/산출물에 반영한다.
- 댓글이 **모호하거나 기존 설계(`aidlc-docs/`)·요구사항과 충돌**하면 — 추측하지 말고
  사용자에게 1회 확인한다.
- 변경이 코드 구조에 영향을 주면 Step 2 / 2.5 처럼 repo·설계 문서를 다시 확인한다.
- **커밋 메시지 형식 유지**: `## 커밋 메시지` 헤딩 + ` ```code block``` ` 또는
  `커밋 메시지: \`feat(...)\`` 인라인 형식을 그대로 둔다 (백틱/펜스 없으면 추출 실패).

### R-3. 본문 교체 (append 아님)

수정된 명세 파일을 **`--replace`** 로 push 한다. (기존 본문 블록을 모두 지우고 새로 씀)

```bash
devagent notion push <pageIdOrUrl> --from <수정된 spec 파일> --replace
```

> ⚠️ `--replace` 는 페이지 본문을 통째로 교체한다. 부분 추가만 원하면 `--replace` 없이 append.

### R-4. 마무리 안내 (사용자 몫)

- **댓글 resolve**: Notion API 로는 댓글을 지우거나 resolve 할 수 없다 →
  사용자가 Notion UI 에서 반영 완료된 댓글을 직접 resolve 하도록 안내한다.
- **Status**: 수정 후 다시 검토하고 `Approved` 로 (재)전환하도록 안내한다.

## 절대 하지 말 것

- ❌ Codex 호출 / 코드 직접 수정 — 이 스킬은 기획만 담당
- ❌ `devagent build` 실행 — 사용자가 Approved 전환 후 직접 실행
- ❌ Notion Status 자동 변경 — 항상 사용자 손에 맡김
- ❌ `implementation-spec.md` 의 커밋 메시지를 백틱 없이 적기 — 추출 실패함
- ❌ 외부 도구 없이 명세 추측 — 모르면 묻거나 코드 읽기
- ❌ 수정 모드에서 사용자 댓글을 임의로 무시·확대 해석 — 모호하면 1회 확인

## 사용 도구 요약

| 단계 | 도구 |
|---|---|
| Notion 본문 가져오기 | `Bash` (`devagent notion pull`) |
| Notion 댓글 가져오기 (수정 모드) | `Bash` (`devagent notion comments`) |
| 본문/코드 읽기 | `Read`, `Glob`, `Grep` |
| 산출물 작성 | `Write` (3개 markdown 파일) |
| Notion 업로드 (선택) | `Bash` (`devagent notion push` / 수정 모드는 `--replace`) |

## 참고 — 이후 build 단계 흐름

사용자가 Status 를 Approved 로 바꾼 뒤:

```bash
devagent build <pageId> --project <path>
```

가 실행되면 dev-agent 가:

1. Notion Status = Approved 검증
2. Notion 본문 markdown 을 inline spec 으로 Codex 에 전달
3. Codex 구현 → Claude(sonnet) 리뷰 → CHANGES_REQUESTED 시 재구현 루프
4. 완료 시 git 커밋 + (origin 있으면) PR 생성
5. Notion Status: `In Progress → In Review → Done` 자동 전이

이 스킬의 산출물은 사용자 검토용이며, build 단계는 **Notion 본문 자체**를 spec 으로 사용한다.
따라서 Notion 본문에 push 해두면 Codex 가 동일한 명세를 받는다.
