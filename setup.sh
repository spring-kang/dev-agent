#!/usr/bin/env bash
# dev-agent 새 PC 1회 세팅 스크립트
#
# 사용법:
#   chmod +x setup.sh
#   ./setup.sh                # 메인 + 웹 전체 빌드 + 글로벌 설치
#   ./setup.sh --no-web       # 웹 대시보드 제외
#   ./setup.sh --skip-claude  # Claude Code CLI 자동 설치 스킵
#   ./setup.sh --no-global    # 글로벌 'devagent' 명령어 등록 스킵
#
# 자세한 가이드: SETUP.md 참조

set -euo pipefail

# ── 색상 (TTY일 때만) ──
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
  BLUE="\033[34m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" BLUE="" RESET=""
fi

log_info()  { printf "${BLUE}ℹ${RESET}  %s\n" "$*"; }
log_ok()    { printf "${GREEN}✓${RESET}  %s\n" "$*"; }
log_warn()  { printf "${YELLOW}⚠${RESET}  %s\n" "$*"; }
log_error() { printf "${RED}✗${RESET}  %s\n" "$*" >&2; }
log_step()  { printf "\n${BOLD}▶ %s${RESET}\n" "$*"; }

# ── 옵션 파싱 ──
INSTALL_WEB=true
INSTALL_CLAUDE=true
INSTALL_GLOBAL=true

while [ $# -gt 0 ]; do
  case "$1" in
    --no-web)        INSTALL_WEB=false ;;
    --skip-claude)   INSTALL_CLAUDE=false ;;
    --no-global)     INSTALL_GLOBAL=false ;;
    -h|--help)
      grep -E "^#" "$0" | sed -E "s/^# ?//" | head -12
      exit 0
      ;;
    *)
      log_error "알 수 없는 옵션: $1"
      exit 1
      ;;
  esac
  shift
done

# ── 작업 디렉토리 = 스크립트 위치 ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
log_info "작업 디렉토리: $SCRIPT_DIR"

# ── 1. 필수 도구 확인 ──
log_step "1/6. 필수 도구 확인"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "$1 가 설치되지 않았습니다. ($2)"
    return 1
  fi
  log_ok "$1: $($1 --version 2>&1 | head -1)"
}

MISSING=0
require_cmd node "https://nodejs.org/en/download — v18 이상 필요" || MISSING=1
require_cmd npm  "Node.js와 함께 설치됨" || MISSING=1
require_cmd git  "https://git-scm.com" || MISSING=1

if [ "$MISSING" -ne 0 ]; then
  log_error "필수 도구가 누락되었습니다. SETUP.md '1️⃣ 사전 도구 설치' 섹션 참조."
  exit 1
fi

# Node 버전 검사
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  log_error "Node.js 18 이상이 필요합니다. 현재: v$(node -p 'process.versions.node')"
  exit 1
fi

# ── 2. 메인 패키지 의존성 ──
log_step "2/6. 메인 패키지 의존성 설치"

if [ -d node_modules ]; then
  log_warn "node_modules가 이미 존재합니다. npm ci 대신 npm install로 갱신합니다."
fi
npm install
log_ok "메인 의존성 설치 완료 ($(ls node_modules | wc -l | tr -d ' ')개 패키지)"

# ── 3. 빌드 (TypeScript → dist/) ──
log_step "3/6. TypeScript 빌드"

npx tsc
if [ ! -f dist/index.js ]; then
  log_error "빌드 산출물 dist/index.js가 생성되지 않았습니다."
  exit 1
fi
log_ok "빌드 완료: dist/index.js"

# ── 4. 웹 대시보드 (선택) ──
if [ "$INSTALL_WEB" = true ]; then
  log_step "4/6. 웹 대시보드 의존성 설치"
  if [ -d web ]; then
    (cd web && npm install)
    log_ok "웹 의존성 설치 완료"
  else
    log_warn "web/ 디렉토리가 없습니다. 스킵."
  fi
else
  log_step "4/6. 웹 대시보드 (--no-web → 스킵)"
fi

# ── 5. 글로벌 'devagent' / 'dev-agent' 명령어 등록 ──
if [ "$INSTALL_GLOBAL" = true ]; then
  log_step "5/6. 글로벌 명령어 등록 (npm install -g .)"

  # npm prefix 권한 확인 (sudo 없이도 되는지)
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo '')"
  if [ -n "$NPM_PREFIX" ] && [ ! -w "$NPM_PREFIX" ]; then
    log_warn "npm prefix($NPM_PREFIX)에 쓰기 권한이 없습니다."
    log_warn "수동 등록: sudo npm install -g . (또는 'npm config set prefix ~/.npm-global')"
  else
    if npm install -g . >/dev/null 2>&1; then
      log_ok "글로벌 명령어 등록 완료"
      if command -v devagent >/dev/null 2>&1; then
        log_ok "사용 가능: 'devagent' 또는 'dev-agent'"
      else
        log_warn "devagent 명령이 PATH에서 보이지 않습니다. 새 셸을 열거나 PATH 설정을 확인하세요."
      fi
    else
      log_warn "npm install -g . 실패 — 수동으로 'sudo npm install -g .' 또는 'npm link' 시도하세요."
    fi
  fi
else
  log_step "5/6. 글로벌 등록 (--no-global → 스킵)"
  log_info "수동 실행 시: 'node $(pwd)/dist/index.js ...'"
fi

# ── 6. 외부 에이전트 CLI 확인 ──
log_step "6/6. 외부 에이전트 CLI 확인"

# Claude Code CLI
if command -v claude >/dev/null 2>&1; then
  log_ok "claude CLI 설치됨: $(claude --version 2>&1 | head -1)"
else
  if [ "$INSTALL_CLAUDE" = true ]; then
    log_info "claude CLI 미설치 — npm install -g @anthropic-ai/claude-code 실행"
    npm install -g @anthropic-ai/claude-code
    log_ok "claude CLI 설치 완료"
    log_warn "최초 1회 'claude' 실행 후 Anthropic 계정 OAuth 인증 필요"
  else
    log_warn "claude CLI 미설치 (--skip-claude). 'npm install -g @anthropic-ai/claude-code'로 별도 설치 필요"
  fi
fi

# Codex CLI
if command -v codex >/dev/null 2>&1; then
  log_ok "codex CLI 설치됨: $(codex --version 2>&1 | head -1)"
else
  log_warn "codex CLI 미설치 — Codex 공식 설치 가이드를 별도로 따라주세요."
fi

# ── 마무리 안내 ──
printf "\n${BOLD}${GREEN}✅ dev-agent 빌드 완료${RESET}\n\n"

cat <<EOF
${BOLD}다음 단계:${RESET}

  1. 외부 CLI 인증 (아직 안 했다면):
     ${BLUE}claude${RESET}                  # Anthropic OAuth
     ${BLUE}codex${RESET}                   # OpenAI/Codex 로그인

  2. Notion 통합 등록:
     ${BLUE}devagent notion login --token ntn_xxxxxxxxxxxx --default-db <DB_ID>${RESET}

  3. 도움말:
     ${BLUE}devagent --help${RESET}

  4. 첫 워크플로우 실행 (단축형):
     ${BLUE}devagent task <NOTION_PAGE_ID>${RESET}

     또는 옵션 명시:
     ${BLUE}devagent --verbose run --task <NOTION_PAGE_ID> --max-iterations 3${RESET}

  5. (선택) .devagentrc.json으로 기본값 저장:
     ${BLUE}echo '{ "task": "<DEFAULT_TASK_ID>", "maxIterations": 3 }' > .devagentrc.json${RESET}
     이후 ${BLUE}devagent task${RESET} 만 입력해도 실행됨

${BOLD}자세한 가이드:${RESET} SETUP.md
EOF
