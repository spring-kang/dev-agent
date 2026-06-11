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
- 사용자가 Notion URL/페이지 ID 를 던지며 plan 단계를 시작하려는 모든 경우

> **주의**: 구현(Codex spawn) 은 이 스킬의 범위가 아니다.
> 사용자가 Notion 에서 Status 를 "Approved" 로 바꾼 뒤 `devagent build <pageId>` 로 실행한다.

## 입력

- `pageId` 또는 Notion URL (32-hex 또는 UUID 포맷 모두 허용)
- 선택: 프로젝트 경로 (보통 Notion `Project Path` 속성에서 읽음)

## 전제 조건

스킬 실행 전에 다음이 갖춰져 있어야 한다:

1. `devagent` CLI 가 설치되어 있고 PATH 에 등록됨 (`devagent --version` 확인)
2. Notion 인증 완료 (`devagent notion test` 가 `✅` 응답)
3. 대상 페이지가 Notion Integration 의 Connections 에 추가됨

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

### Step 2 — 코드베이스 컨텍스트 수집

- Notion 본문에 명시된 **대상 파일/경로** 가 있으면 해당 파일들을 `Read` 로 읽는다.
- 명시가 없으면 `Glob`/`Grep` 으로 후보를 찾아 사용자에게 어느 범위인지 1회 확인한다.
- 절대 추측만으로 명세를 작성하지 않는다 — 모르면 묻는다.

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

## 절대 하지 말 것

- ❌ Codex 호출 / 코드 직접 수정 — 이 스킬은 기획만 담당
- ❌ `devagent build` 실행 — 사용자가 Approved 전환 후 직접 실행
- ❌ Notion Status 자동 변경 — 항상 사용자 손에 맡김
- ❌ `implementation-spec.md` 의 커밋 메시지를 백틱 없이 적기 — 추출 실패함
- ❌ 외부 도구 없이 명세 추측 — 모르면 묻거나 코드 읽기

## 사용 도구 요약

| 단계 | 도구 |
|---|---|
| Notion 본문 가져오기 | `Bash` (`devagent notion pull`) |
| 본문/코드 읽기 | `Read`, `Glob`, `Grep` |
| 산출물 작성 | `Write` (3개 markdown 파일) |
| Notion 업로드 (선택) | `Bash` (`devagent notion push`) |

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
