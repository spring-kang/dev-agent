# dev-agent

> Notion task를 입력으로 받아 **기획 → 구현 → 리뷰 → 커밋 → PR**까지 자율적으로 수행하는 AI 멀티 에이전트 개발 파이프라인.

[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/typescript-5.6-blue)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey)]()

## 주요 특징

- **멀티 에이전트 협업**: Claude Code (기획·리뷰) + Codex (구현)의 역할 분담
- **자율 사이클 루프**: 리뷰 결과에 따라 자동 재구현 (CHANGES REQUESTED → 다음 사이클)
- **Notion 양방향 통합**: Task body 자동 로드 → Status 자동 전이 → 산출물 본문/코멘트 게시
- **Git 통합**: 사이클별 커밋, 자동 PR 생성, 원격 미설정 시 graceful skip
- **EventEmitter 기반 결합 분리**: 동기화 로직이 파이프라인 코드를 건드리지 않음
- **Graceful degradation**: 외부 API 실패가 본 작업을 막지 않음

## 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                     WorkflowService (Facade)                 │
│         executeFromNotion / execute / resume / status        │
└─────────────────┬────────────────────────┬───────────────────┘
                  │                        │
        ┌─────────▼──────────┐   ┌─────────▼──────────────┐
        │   Orchestrator     │   │  Integrations (Notion) │
        │   PipelineService  │   │  - PlanningEnhancer    │
        │                    │   │  - NotionStatusSync    │
        │  ┌──────────────┐  │   │  - NotionArtifactSync  │
        │  │  Planning    │──┼───┼─► toggle blocks +      │
        │  │  (Claude)    │  │   │   summary comments     │
        │  ├──────────────┤  │   └────────────────────────┘
        │  │ Implementation│ │
        │  │   (Codex)    │  │
        │  ├──────────────┤  │
        │  │   Review     │  │
        │  │  (Claude)    │  │
        │  └──────────────┘  │
        └────────────────────┘
```

## 워크플로우 흐름 (2단계 분리: plan / build)

### Stage 1 — `devagent plan <pageId>`
1. **Planning** — Claude Code가 기획서 3종 생성
   - `requirements.md` — 요구사항 분석
   - `implementation-spec.md` — 구현 명세
   - `test-scenarios.md` — 테스트 시나리오
2. Notion Status → **Plan Review** 로 자동 전이
3. 사용자가 Notion 에서 기획을 검토하고 직접 **Approved** 로 전이

### Stage 2 — `devagent build <pageId>`
1. Notion Status 가 `Approved` 인지 검증 (아니면 거부)
2. **Implementation** — Codex가 코드 작성 및 사이클 커밋
3. **Review** — Claude Code가 코드 리뷰 (APPROVED 시 종료, CHANGES_REQUESTED 시 재구현)
4. **Finalize** — origin 있으면 push + PR, 없으면 로컬 보존

Notion Status 자동 전이:
`To Do → Planning → Plan Review → (사용자 승인) → Approved → In Progress → In Review → Done`

> 기존 `devagent task <id>` 단일 명령은 **제거**되었습니다. plan/build 두 단계로 명시 호출하세요.

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
./setup.sh       # 의존성 설치 + TypeScript 빌드 + 웹 빌드
```

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

### 2. 워크플로우 실행 (plan → 검토 → build)

```bash
# Stage 1: 기획
devagent plan 376e8963-3f9d-80bb-ac3e-d8818389de61

# → Notion 페이지에서 산출물 검토 후 Status 를 "Approved" 로 변경

# Stage 2: 구현 + 리뷰 + PR (Status=Approved 확인 후 실행)
devagent build 376e8963-3f9d-80bb-ac3e-d8818389de61 --project /path/to/project
```

**옵션 명시:**
```bash
devagent plan <pageId> --project /path/to/project --skip-enhancement
devagent build <pageId> --project /path/to/project --max-iterations 5
```

**직접 작업 지시 (Notion 없이):**
```bash
devagent run \
  --task "README에 사용법 섹션 추가하고 'docs: 사용법 추가' 메시지로 커밋"
```

## CLI 명령어

### 메인

| 명령어 | 설명 |
|---|---|
| `plan <pageId>` | Notion task 기획 단계 실행 → Status=Plan Review |
| `build <pageId>` | Notion task 빌드 단계 실행 (Status=Approved 검증 필요) |
| `run` | (레거시) 단일-패스 워크플로우 실행 (Notion 비연동 시 사용) |
| `resume <project>` | 중단된 워크플로우 복구 |
| `status [project]` | 진행 상태 조회 |
| `list` | 등록된 프로젝트 목록 |
| `serve` | 웹 대시보드 서버 실행 |

> `devagent task <id>` 는 **제거**되었습니다. `plan` + `build` 두 단계를 사용하세요.

### 단축 명령어 (alias)

| 명령어 | 동등한 명령어 | 설명 |
|---|---|---|
| `devagent notion login --token <T>` | `integrations notion set` | 토큰 저장 |
| `devagent notion logout` | `integrations notion clear` | 토큰 제거 |
| `devagent notion test` | `integrations notion test` | 인증 확인 |
| `devagent notion list` | `integrations notion tasks` | DB의 task 목록 |
| `devagent notion status` | `integrations notion status` | 통합 상태 |
| `devagent rc` | — | 로드된 `.devagentrc` 출력 |

### `plan` / `build` 옵션

| 명령어 | 옵션 | 설명 | 기본값 |
|---|---|---|---|
| `plan` | `-p, --project <path>` | 프로젝트 경로 override | Notion `Project Path` 속성 |
| `plan` | `--skip-enhancement` | Claude 기획 고도화 스킵 | false |
| `build` | `-p, --project <path>` | 프로젝트 경로 (**필수**, Notion fallback 없음) | — |
| `build` | `-m, --max-iterations <N>` | 최대 사이클 수 | 3 |

### `run` 주요 옵션

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--task <id\|text>` | Notion Page ID 또는 작업 설명 | 필수 (rc로도 가능) |
| `--project <path>` | 작업 대상 경로 | Notion 속성 또는 cwd |
| `--max-iterations <N>` | 최대 사이클 수 | 3 |
| `--verbose` | 상세 로그 | false |
| `--skip-enhancement` | 기획 고도화 단계 스킵 | false |

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
  "maxIterations": 3,
  "verbose": true,
  "skipEnhancement": false,
  "notion": { "defaultDatabaseId": "<DB_ID>" }
}
```

**환경변수 매핑:**
- `DEVAGENT_TASK`
- `DEVAGENT_PROJECT_PATH`
- `DEVAGENT_MAX_ITERATIONS`
- `DEVAGENT_VERBOSE` (1/true)
- `DEVAGENT_SKIP_ENHANCEMENT` (1/true)
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

- `To Do` (또는 `Not started`)
- `Planning`
- `Plan Review` — `devagent plan` 완료 시 자동 설정. 사용자 검토 대기.
- `Approved` — 사용자가 기획 승인 후 직접 설정. `devagent build` 진입 조건.
- `In Progress`
- `In Review`
- `Done`

> 라벨이 다르면 `integrations.json`의 `statusMapping`으로 매핑 가능.
> `build` 명령은 Status 가 정확히 `Approved` 인 경우에만 진행하며, 그 외에는 즉시 거부합니다.

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
│   │   ├── artifacts/
│   │   │   ├── requirements.md
│   │   │   ├── implementation-spec.md
│   │   │   └── test-scenarios.md
│   │   └── state.json
│   └── archive/
└── (소스 코드 변경 + git 커밋)
```

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
