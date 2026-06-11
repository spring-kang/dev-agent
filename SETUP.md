# dev-agent 세팅 가이드

새로운 PC에서 dev-agent를 처음 사용할 때 따라야 할 단계별 가이드입니다.

## 📋 전체 흐름

```
1. 사전 도구 설치 → 2. 저장소 clone → 3. 빌드 → 4. 외부 도구 인증 → 5. Notion 통합 → 6. 동작 확인
```

자동화 스크립트(`setup.sh`)를 사용하면 1~3단계를 한 번에 처리할 수 있습니다.

---

## 1️⃣ 사전 도구 설치

### macOS (Homebrew)
```bash
brew install node git
brew install gh   # 선택 (GitHub 저장소 작업용)
```

### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
sudo apt install -y gh   # 선택
```

### Windows
- [Node.js LTS](https://nodejs.org) 인스톨러
- [Git for Windows](https://git-scm.com/download/win)
- WSL2 권장 (Linux 환경으로 동작)

### 버전 확인
```bash
node --version    # v18.0.0 이상
git --version
```

---

## 2️⃣ 저장소 Clone

### SSH (권장)
```bash
git clone git@github.com:spring-kang/dev-agent.git
cd dev-agent
```

### HTTPS (SSH 키 없는 경우)
```bash
git clone https://github.com/spring-kang/dev-agent.git
cd dev-agent
```

### SSH 키 신규 등록
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
cat ~/.ssh/id_ed25519.pub   # 출력 → GitHub Settings → SSH keys에 추가
ssh -T git@github.com       # 연결 테스트
```

---

## 3️⃣ 빌드

### 자동화 스크립트 사용 (권장)
```bash
./setup.sh
```

### 수동 빌드
```bash
# 메인 패키지
npm install
npx tsc           # → dist/ 생성

# 웹 대시보드 (선택)
cd web
npm install
cd ..
```

### 동작 확인
```bash
node dist/index.js --help
```

### 글로벌 명령어 등록 (선택, 권장)

`./setup.sh`를 사용하면 자동으로 다음이 실행되어 어디서든 `devagent` 명령어를 쓸 수 있습니다.

```bash
npm install -g .   # 'devagent' / 'dev-agent' 둘 다 PATH에 등록
devagent --help
```

권한 문제로 실패하면:
```bash
# 옵션 1: sudo
sudo npm install -g .

# 옵션 2: 사용자 prefix 사용 (권장)
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # 또는 ~/.bashrc
source ~/.zshrc
npm install -g .
```

스킵하려면: `./setup.sh --no-global`

### 기획 스킬 설치 (devagent-planner)

기획 단계는 Claude Code의 **`devagent-planner` 스킬**로 수행합니다.
`./setup.sh` 실행 시 자동으로 `~/.claude/skills/devagent-planner/` 에 설치되어
**어느 프로젝트 디렉토리에서 `claude` 를 열어도** 스킬이 동작합니다.

수동 설치 시:
```bash
mkdir -p ~/.claude/skills
cp -R .claude/skills/devagent-planner ~/.claude/skills/
```

스킵하려면: `./setup.sh --no-skill`

---

## 4️⃣ 외부 에이전트 CLI 설치 & 인증

dev-agent는 외부 CLI(Claude Code, Codex)를 spawn해서 사용합니다. 각각 별도 인증이 필요합니다.

### Claude Code CLI (기획·리뷰)
```bash
npm install -g @anthropic-ai/claude-code
claude --version

# 인증 (브라우저 OAuth)
claude
# → 안내에 따라 Anthropic 계정 로그인
```

### Codex CLI (구현)
```bash
# 설치 방식은 Codex 공식 가이드 따름
# (예: pip install / npm install / 또는 별도 바이너리)

codex --version
# 인증: OpenAI/Codex 계정 로그인
```

### 동작 확인
```bash
claude --print "Hello" --output-format text --dangerously-skip-permissions
codex --version
```

---

## 5️⃣ Notion 통합 설정

### A. Notion Integration 토큰 발급

1. https://www.notion.so/profile/integrations
2. `+ New integration` → Internal type → 이름 입력 (예: `dev-agent`)
3. **Capabilities 모두 활성화**:
   - ✅ Read content
   - ✅ Update content
   - ✅ Insert content
   - ✅ Insert comments
4. 생성 후 **Integration token** (`secret_...` 또는 `ntn_...`) 복사

### B. Notion DB 준비

1. dev-agent용 DB 생성 (또는 기존 DB 사용)
2. 필수 속성 추가:
   | 속성명 | 타입 | 비고 |
   |---|---|---|
   | `Name` | Title | 작업 제목 |
   | `Status` | Status / Select | `To Do`, `Approved`, `In Progress`, `In Review`, `Done` |
   | `Project Path` | Rich text | 작업 대상 로컬 경로 |

   > `Approved` 는 build 진입 게이트입니다. 사용자가 기획 검토 후 직접 설정합니다.
3. **DB 우상단 `⋯` → `Connections` → dev-agent Integration 추가**

### C. DB ID 추출

Notion DB URL:
```
https://notion.so/workspace/375e89633f9d809db9c3eea35188b99d?v=...
                            └────────── DB ID (32자) ─────────┘
```

### D. dev-agent에 등록

```bash
# 글로벌 등록을 한 경우 (권장)
devagent notion login \
  --token ntn_xxxxxxxxxxxx \
  --default-db 375e89633f9d809db9c3eea35188b99d

# 또는 글로벌 미등록 시
node dist/index.js integrations notion set \
  --token ntn_xxxxxxxxxxxx \
  --default-db 375e89633f9d809db9c3eea35188b99d
```

→ `~/.dev-agent/integrations.json`에 저장됨 (이 파일은 git에 절대 올라가지 않음)

### E. 등록 확인

```bash
devagent notion status   # 또는 'devagent notion test' 로 인증 확인
```

---

## 6️⃣ 동작 확인 (스모크 테스트)

### 테스트용 빈 디렉토리 준비

```bash
mkdir /tmp/dev-agent-test
cd /tmp/dev-agent-test
git init -b main
echo "# 테스트 프로젝트" > README.md
git add . && git commit -m "init: 초기화"
```

### Notion에 테스트 티켓 작성

페이지 본문:
````markdown
# 테스트: README에 한 줄 추가

## 요구사항
- 대상 파일: `/tmp/dev-agent-test/README.md`
- 추가할 내용: `dev-agent 동작 확인`
- 커밋 메시지: `docs: 동작 확인 라인 추가`

## 수용 기준
- [ ] README 마지막 줄이 `dev-agent 동작 확인`
- [ ] `git log -1 --pretty=%s` 결과 일치
````

Properties:
- Status: `To Do`
- Project Path: `/tmp/dev-agent-test`

### 실행 (기획 → 승인 → build)

```bash
# Stage 1: 기획 — devagent-planner 스킬 (setup.sh가 ~/.claude/skills/에 자동 설치)
claude          # 아무 디렉토리에서나 실행 가능
# > "Notion task <NOTION_PAGE_ID> 기획해줘"   ← 스킬이 자동 매칭되어 실행됨
# → 대화하며 기획 완성 + Notion 본문 push 후 종료
```

→ Notion 페이지에서 기획 내용을 확인하고 Status 를 **`Approved`** 로 변경:

```bash
devagent notion status <NOTION_PAGE_ID> Approved
```

```bash
# Stage 2: 구현 + 리뷰 + PR
devagent build <NOTION_PAGE_ID> --project /tmp/dev-agent-test
#  → Status=Approved 검증 후 Implementation → Review → PR
```

성공 시:
- ✅ Notion Status: `Approved → In Progress → In Review → Done`
- ✅ README에 라인 추가됨
- ✅ git 커밋 메시지가 spec과 일치

> 이 스모크 테스트처럼 본문이 이미 완결된 명세라면 기획 단계 없이
> 바로 `Approved` 로 설정하고 `build` 를 실행해도 됩니다.

---

## 📂 새 PC에서 추가로 생성되는 파일

```
~/.dev-agent/
└── integrations.json    # Notion 토큰 (gitignore 됨, 절대 공유 금지)

<repo>/
├── node_modules/        # npm install로 생성
├── dist/                # npx tsc로 생성
└── web/node_modules/    # web/ 의존성
```

---

## ⚠️ 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `command not found: claude` | Claude Code CLI 미설치/PATH 누락 | `npm install -g @anthropic-ai/claude-code` |
| `command not found: codex` | Codex CLI 미설치 | Codex 공식 설치 가이드 참조 |
| `permission denied (publickey)` (clone) | SSH 키 미등록 | HTTPS clone 사용 또는 SSH 키 등록 |
| `Cannot find module 'dist/index.js'` | 빌드 누락 | `npx tsc` 실행 |
| `Insufficient permissions for /comments` | Notion Integration capability 부족 | `Insert comments` 활성화 |
| `Could not find block with ID` | Notion 페이지가 Integration에 미공유 | DB/페이지 `Connections`에 추가 |
| `프로젝트 경로가 지정되지 않았습니다` | Notion `Project Path` 누락 | 속성 추가 또는 `--project-path` 사용 |
| `원격 저장소(origin)가 설정되어 있지 않아` | git remote 없음 | 정상 — 로컬 브랜치에 보존됨 |

---

## ✅ 빠른 체크리스트

- [ ] Node.js 18+, git 설치
- [ ] `git clone git@github.com:spring-kang/dev-agent.git`
- [ ] `./setup.sh` 실행 (의존성 + 빌드 + 글로벌 `devagent` 등록 + `devagent-planner` 스킬 설치까지 자동)
- [ ] `npm install -g @anthropic-ai/claude-code` + 인증
- [ ] Codex CLI 설치 + 인증
- [ ] Notion Integration 생성 + capability 활성화
- [ ] DB에 Status / Project Path 속성 추가 + Integration 연결
- [ ] `devagent notion login --token <T> --default-db <ID>`
- [ ] (선택) `.devagentrc.json`으로 기본값 저장
- [ ] 테스트 티켓으로 스모크 테스트:
  - [ ] `claude` 에서 `devagent-planner` 스킬로 기획 ("Notion task <ID> 기획해줘") — 또는 본문 직접 작성
  - [ ] `devagent notion status <ID> Approved` 로 승인
  - [ ] `devagent build <ID> --project <path>` → 완료

---

## 🚀 권장 워크플로우 (새 PC 처음부터 끝까지)

> dev-agent는 외부 CLI(Claude Code, Codex)를 spawn해서 사용합니다.
> **세 가지 인증(Claude, Codex, Notion)이 모두 살아있어야** 워크플로우가 끝까지 돕니다.

### 역할 분담

| 단계 | 사용 CLI | 미인증 시 영향 |
|---|---|---|
| 기획 (수동) | `claude` + `devagent-planner` 스킬 (사용자가 직접 실행) | 기획을 진행할 수 없음 |
| Implementation (구현) | `codex` (dev-agent가 spawn) | Implementation 단계에서 실패 |
| Review (리뷰) | `claude` (Sonnet, dev-agent가 spawn) | Review 단계에서 실패 |
| Notion 동기화 | dev-agent 내부 | 토큰 없으면 `build` 진입 자체가 불가 (Approved 검증 필요) |

### 7단계 워크플로우

```bash
# 1. dev-agent 설치 (저장소 clone 후)
./setup.sh
# → 빌드 + 글로벌 devagent 등록 + devagent-planner 스킬(~/.claude/skills/) 설치

# 2. Claude Code 인증 (Anthropic OAuth — 브라우저 열림)
claude
# → 로그인 완료 후 종료. ~/.claude/에 토큰 저장됨

# 3. Codex CLI 인증
codex login
# → OpenAI 계정 OAuth 또는 API key 입력

# 4. Notion 토큰 등록
devagent notion login \
  --token ntn_xxxxxxxxxxxx \
  --default-db <DB_ID>

# 5. Claude 동작 확인
claude --print "ok" --output-format text --dangerously-skip-permissions
# → "ok" 비슷한 응답이 오면 정상

# 6. Notion 동작 확인
devagent notion test
# → "✅ Notion 인증 성공: <계정명>"

# 7. 첫 워크플로우 실행 (기획 → 승인 → build)
devagent notion list                                        # 가능한 task 조회
claude                                                      # ① 기획: "Notion task <ID> 기획해줘" (devagent-planner 스킬)
devagent notion status <NOTION_PAGE_ID> Approved            # ② 검토 후 승인
devagent build <NOTION_PAGE_ID> --project /path/to/project  # ③ 구현 + 리뷰 + PR
```

이 7단계를 다 거치면 **미인증으로 인한 실패는 사실상 발생하지 않습니다**.

### 인증 토큰 저장 위치

| 인증 | 저장 위치 | 만료 |
|---|---|---|
| Claude Code | `~/.claude/` | 만료/revoke 전까지 영구 |
| Codex | `~/.codex/` 또는 `~/.config/codex/` | 동일 |
| Notion | `~/.dev-agent/integrations.json` | revoke 또는 수동 `devagent notion logout` 전까지 |

한 번 인증해두면 새 PC를 쓰기 전까지 다시 로그인할 필요 없습니다.

### 인증이 끊겼을 때 증상

- **Claude 미인증**: `Review phase failed: claude exited with code 1: Authentication error...`
- **Codex 미인증**: `Implementation phase failed: codex exited with code 1: Not logged in...`
- **Notion 미인증**: `build` 진입 시 Approved 검증을 할 수 없어 즉시 거부됨

→ 실패 시 워크플로우는 `failed` 상태로 종료. Notion Status는 `Approved` 로 복귀합니다.
→ 재인증 후 `devagent resume <project>` 또는 `devagent build <ID>` 재실행으로 이어서 가능.

> ⚠️ Claude/Codex **둘 다 완전 우회는 불가능**합니다. 두 CLI 없이는 dev-agent 자체가 동작하지 않습니다.

---

## 🔗 관련 문서

- [README.md](./README.md) — 프로젝트 개요 및 CLI 명령어
- [setup.sh](./setup.sh) — 자동 세팅 스크립트
