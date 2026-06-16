# dev-agent

> 사용자가 **Claude Code로 직접 기획**하고, Notion에서 **Approved**로 승인하면 **Codex가 구현 → Claude(Sonnet)가 리뷰 → 커밋 → PR**까지 자동 수행하는 AI 개발 파이프라인.

[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/typescript-5.6-blue)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey)]()

## 주요 특징

- **기획·개발 완전 분리**: 기획은 사용자가 Claude Code로 직접, 구현은 Codex가 Approved task만 수행
- **Approved 게이트**: `devagent build`는 Notion Status가 정확히 `Approved`일 때만 진입
- **자율 사이클 루프**: 리뷰 결과에 따라 자동 재구현 (CHANGES_REQUESTED → 다음 사이클)
- **Sonnet 리뷰**: 코드 리뷰는 `claude-sonnet-4-5-20250929` 모델 고정 기본값 (config로 변경 가능)
- **Notion 본문 = 구현 명세**: task 본문 markdown을 그대로 Codex에 inline spec으로 전달
- **Git 통합**: 사이클별 커밋, 자동 PR 생성, 원격 미설정 시 graceful skip
- **Graceful degradation**: Notion 동기화 실패가 본 작업을 막지 않음

## 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                     WorkflowService (Facade)                 │
│      executeBuildFromNotion / execute / resume / status      │
└─────────────────┬────────────────────────┬───────────────────┘
                  │                        │
        ┌─────────▼──────────┐   ┌─────────▼──────────────┐
        │   Orchestrator     │   │  Integrations (Notion) │
        │   PipelineService  │   │  - NotionClient        │
        │                    │   │  - NotionStatusSync    │
        │  ┌──────────────┐  │   │  - NotionArtifactSync  │
        │  │Implementation│──┼───┼─► toggle blocks +      │
        │  │   (Codex)    │  │   │   summary comments     │
        │  ├──────────────┤  │   └────────────────────────┘
        │  │   Review     │  │
        │  │(Claude Sonnet)│ │
        │  └──────────────┘  │
        └────────────────────┘
```

## 워크플로우 흐름 (기획은 사람이, 구현은 Codex가)

### Stage 1 — 기획 (`claude` + `devagent-planner` 스킬)

기획은 **claude 안에서 대화형으로** 진행합니다. `./setup.sh`가 `devagent-planner` 스킬을
`~/.claude/skills/`에 자동 설치하므로 **아무 디렉토리에서나** 사용할 수 있습니다.

```bash
claude
# > "Notion task <pageId> 기획해줘"   ← 스킬이 자동 매칭되어 실행됨
```

스킬이 수행하는 절차:

1. Notion task 로드 (제목 + 본문 + Project Path 속성)
2. 사용자와 대화하며 요구사항·구현 명세·테스트 시나리오 작성
3. 완성된 구현 명세를 **Notion 본문에 push**
   (build는 Notion 본문을 spec으로 사용하므로 필수)

사용자는 Notion에서 기획 내용을 검토하고 **직접 `Approved`로 승격**:

```bash
devagent notion status <pageId> Approved
```

### Stage 2 — `devagent build <pageId>`

1. Notion Status가 `Approved`인지 검증 (아니면 즉시 거부)
2. task 본문 markdown을 inline spec으로 로드 (별도 Planning 없음)
3. **Implementation** — Codex가 코드 작성 및 사이클 커밋
4. **Review** — Claude(Sonnet)가 코드 리뷰 (APPROVED 시 종료, CHANGES_REQUESTED 시 재구현)
5. **Finalize** — origin 있으면 push + PR, 없으면 로컬 보존

Notion Status 자동 전이 (build 단계만):
`Approved → In Progress → In Review → Done` (실패/중단 시 `Approved`로 복귀)

> 기존 `devagent task <id>` (기획부터 PR까지 무중단 자동) 명령은 **제거**되었습니다.
> 기획(plan)과 구현(build) 사이에는 반드시 사용자의 `Approved` 승인이 필요합니다.

## 설치

> 📘 **새 PC에서 처음 설치하는 경우** → [SETUP.md](./SETUP.md) 단계별 가이드 참조

### 사전 요구사항

- Node.js 18+
- git
- [Claude Code CLI](https://docs.claude.com/claude-code)
- [Codex CLI](https://github.com/openai/codex)

### 빌드 (자동)

```bash
git clone https://github.com/spring-kang/dev-agent.git
cd dev-agent
./setup.sh       # macOS/Linux/WSL — 의존성 설치 + TypeScript 빌드 + 웹 빌드
```

Windows(네이티브 PowerShell):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup.ps1      # setup.sh와 동일한 7단계 수행
```

> Windows 상세 절차(WSL 포함)는 [SETUP.md](./SETUP.md#-windows-세팅-네이티브--wsl) 참조.

### 빌드 (수동)

```bash
git clone https://github.com/spring-kang/dev-agent.git
cd dev-agent
npm install
npx tsc          # → dist/ 생성
```

## 빠른 시작

> `./setup.sh` 실행 후에는 `devagent` 명령어가 전역으로 등록됩니다.
> (또는 `node dist/index.js`로 대체 가능)

### 1. Notion Integration 등록 (선택)

```bash
devagent notion login --token ntn_xxxxxxxxxxxx --default-db <NOTION_DB_ID>
```

### 2. 워크플로우 실행 (기획 → 승인 → build)

```bash
# Stage 1: 기획 — claude 에서 devagent-planner 스킬 사용
claude
# > "Notion task 376e8963-3f9d-80bb-ac3e-d8818389de61 기획해줘"
# → 대화하며 기획 완성 + Notion 본문 push 후 종료

# → Notion에서 기획 검토 후 Status 를 "Approved" 로 변경
devagent notion status 376e8963-3f9d-80bb-ac3e-d8818389de61 Approved

# Stage 2: 구현 + 리뷰 + PR (Status=Approved 검증 후 실행)
devagent build 376e8963-3f9d-80bb-ac3e-d8818389de61 --project /path/to/project
```

**옵션 명시:**
```bash
devagent build <pageId> --project /path/to/project --max-iterations 5
```

**직접 작업 지시 (Notion 없이):**
```bash
devagent run \
  --project /path/to/project \
  "README에 사용법 섹션 추가하고 'docs: 사용법 추가' 메시지로 커밋"
```

## CLI 명령어

### 메인

| 명령어 | 설명 |
|---|---|
| `build <pageId>` | 승인된 Notion task 개발 실행 (Status=Approved 검증 필요) |
| `run <task>` | 일반 워크플로우 실행 (Notion 비연동, 작업 설명 직접 입력) |
| `resume <project>` | 중단된 워크플로우 복구 |
| `status [project]` | 진행 상태 조회 |
| `list` | 등록된 프로젝트 목록 |
| `serve` | 웹 대시보드 서버 실행 |

> `devagent task <id>` (기획~PR 무중단 자동)는 **제거**되었습니다.
> 기획(claude + `devagent-planner` 스킬) → 사용자 검토/`Approved` 승인 → `build` 순서로 진행하세요.

### Notion 단축 명령어

| 명령어 | 설명 |
|---|---|
| `devagent notion login --token <T> [--default-db <ID>]` | 토큰 저장 |
| `devagent notion logout` | 토큰 제거 |
| `devagent notion test` | 인증 확인 |
| `devagent notion list` | DB의 task 목록 |
| `devagent notion status` | 통합 상태 조회 |
| `devagent notion status <pageId> <Status>` | 페이지 Status 직접 변경 (예: `Approved`) |
| `devagent notion pull <pageId> [-o <file>]` | task 본문 markdown 추출 |
| `devagent notion push <pageId> --from <file>` | markdown 파일을 본문에 append |
| `devagent rc` | 로드된 `.devagentrc` 출력 |

### `build` 옵션

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `-p, --project <path>` | 프로젝트 경로 | rc 설정 또는 Notion `Project Path` 속성 |
| `-m, --max-iterations <N>` | 최대 사이클 수 | 5 |

### `run` 옵션

| 옵션/인자 | 설명 | 기본값 |
|---|---|---|
| `<task>` (인자) | 작업 설명 텍스트 | 필수 |
| `-p, --project <path>` | 작업 대상 경로 | **필수** |
| `-m, --max-iterations <N>` | 최대 사이클 수 | 5 |
| `--verbose` | 상세 로그 | false |

## `.devagentrc.json` (기본값 저장)

자주 쓰는 옵션을 프로젝트 루트(또는 상위 디렉토리)나 `~/.dev-agent/devagentrc.json`에 저장해두면 매번 옵션을 지정하지 않아도 됩니다.

**우선순위 (높은 → 낮은):**
1. CLI 옵션 (`--task 등`)
2. 환경변수 `DEVAGENT_*`
3. 프로젝트 `.devagentrc.json` (cwd 기준 walk-up)
4. 글로벌 `~/.dev-agent/devagentrc.json`

**지원 키:**
```json
{
  "task": "376e8963-3f9d-80bb-ac3e-d8818389de61",
  "projectPath": "/Users/me/projects/foo",
  "maxIterations": 5,
  "verbose": true,
  "notion": { "defaultDatabaseId": "<DB_ID>" }
}
```

**환경변수 매핑:**
- `DEVAGENT_TASK`
- `DEVAGENT_PROJECT_PATH`
- `DEVAGENT_MAX_ITERATIONS`
- `DEVAGENT_VERBOSE` (1/true)
- `DEVAGENT_DEFAULT_DB`

**확인:**
```bash
devagent rc          # 어떤 소스에서 어떤 값이 적용됐는지 표시
```

## Notion DB 구성

### 필수 속성

| 속성명 | 타입 | 용도 |
|---|---|---|
| `Name` | Title | 작업 제목 |
| `Status` | Status / Select | 워크플로우 상태 자동 전이용 |
| `Project Path` | Rich text | 작업 대상 로컬 경로 |

### Status 옵션

- `To Do` (또는 `Not started`) — 기획 전/기획 중인 task
- `Approved` — 사용자가 기획 검토 후 직접 설정. **`devagent build` 진입 조건.**
- `In Progress` — build 시작 시 자동 전이
- `In Review` — build 의 코드 리뷰 단계에서 자동 전이
- `Done` — 완료 시 자동 전이

> 라벨이 다르면 `integrations.json`의 `statusMapping`으로 매핑 가능.
> `build` 명령은 Status 가 정확히 `Approved` 인 경우에만 진행하며, 그 외에는 즉시 거부합니다.
> 실패/중단 시 Status 는 `Approved` 로 복귀하므로 수정 후 재시도할 수 있습니다.

### Notion Integration Capabilities

Settings → Integrations → Capabilities에서 활성화:
- ✅ Read content
- ✅ Update content
- ✅ Insert content
- ✅ Insert comments

## 티켓 작성 템플릿

````markdown
# 작업 제목

## 목표
한 문장으로 무엇을 달성할지

## 컨텍스트
배경 정보, 왜 필요한지

## 요구사항
- 대상 파일/경로
- 변경 내용
- 커밋 메시지: `docs: 한국어 컨벤션 메시지`

## 수용 기준
- [ ] 자동 검증 가능한 조건 1
- [ ] git log -1 --pretty=%s 결과 일치
````

**좋은 티켓의 조건:**
1. 목표가 한 문장으로 요약 가능
2. 수용 기준이 자동 검증 가능
3. 커밋 메시지는 backtick으로 감싸기 (자동 추출 패턴)
4. Project Path 속성 필수

## 결과물 구조

```
<project>/
├── .ai-workflow/
│   ├── current/
│   │   ├── artifacts/              # 기획 산출물 (run 모드에서만 생성)
│   │   │   ├── requirements.md
│   │   │   ├── implementation-spec.md
│   │   │   └── test-scenarios.md
│   │   └── state.json
│   └── archive/
└── (소스 코드 변경 + git 커밋)
```

> `build` 모드에서는 Notion 본문 자체가 구현 명세(inline spec)로 사용되므로
> artifacts/ 파일 생성 없이 바로 Implementation 으로 진입합니다.

### Git 결과
- 새 브랜치: `ai/YYYYMMDD-HHMMSS-<task-slug>`
- 사이클별 커밋 (spec에서 메시지 자동 추출)
- origin 있으면 push + PR, 없으면 로컬 브랜치 보존

### Notion 결과
- Status 자동 전이
- 본문에 사이클별 toggle 블록 추가
- 코멘트로 사이클별 진행 요약

## 프로젝트 구조

```
src/
├── cli/                    # CLI 진입점
├── components/             # 핵심 컴포넌트
│   ├── claude-agent.ts     # Claude Code 래퍼
│   ├── codex-agent.ts      # Codex 래퍼
│   ├── git-manager.ts      # git 작업
│   ├── state-manager.ts    # 워크플로우 상태 관리
│   └── ...
├── services/               # 비즈니스 로직
│   ├── workflow.service.ts # Facade
│   ├── pipeline.service.ts # 사이클 루프
│   └── ...
├── integrations/           # 외부 통합
│   ├── notion-client.ts
│   ├── notion-status-sync.ts
│   ├── notion-artifact-sync.ts
│   └── notion-block-appender.ts
├── orchestrator/           # 워크플로우 오케스트레이션
├── types/                  # 타입 정의
├── web/                    # 웹 서버 (Express + Socket.IO)
└── container.ts            # DI Composition Root
```

## 개발

```bash
npm run dev          # tsx로 즉시 실행
npm test             # 단위 테스트
npm run typecheck    # 타입 체크
npm run lint         # ESLint
npm run format       # Prettier
npm run web:dev      # 웹 대시보드 dev 서버
```

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| `Insufficient permissions for /comments` | Notion Integration에서 `Insert comments` 활성화 |
| `프로젝트 경로가 지정되지 않았습니다` | Project Path 속성 추가 또는 `--project-path` 사용 |
| 커밋 메시지가 `[ai-cycle-N] Auto-generated` | spec에 `커밋 메시지: \`...\`` 형식으로 백틱 사용 |
| `원격 저장소(origin)가 설정되어 있지 않아` | 정상 — 로컬 브랜치에 보존됨 |
| Notion task 로드 실패 | DB/페이지 `Connections`에 Integration 추가 |

## 라이선스

MIT
