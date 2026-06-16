# dev-agent 새 PC(Windows) 1회 세팅 스크립트 (PowerShell 네이티브)
#
# 사용법 (PowerShell):
#   # 최초 1회: 실행 정책 허용 (현재 세션 한정)
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
#   .\setup.ps1                # 메인 + 웹 전체 빌드 + 글로벌 설치 + 기획 스킬 설치
#   .\setup.ps1 -NoWeb         # 웹 대시보드 제외
#   .\setup.ps1 -SkipClaude    # Claude Code CLI 자동 설치 스킵
#   .\setup.ps1 -NoGlobal      # 글로벌 'devagent' 명령어 등록 스킵
#   .\setup.ps1 -NoSkill       # devagent-planner 스킬 글로벌 설치 스킵
#
# 자세한 가이드: SETUP.md 참조 (Windows 섹션)
#
# 참고: WSL2를 쓰는 경우 이 스크립트 대신 WSL 터미널에서 ./setup.sh 를 실행하세요.

[CmdletBinding()]
param(
    [switch]$NoWeb,
    [switch]$SkipClaude,
    [switch]$NoGlobal,
    [switch]$NoSkill
)

$ErrorActionPreference = "Stop"

# ── 로그 헬퍼 ──
function Log-Info  { param($msg) Write-Host "i  $msg" -ForegroundColor Blue }
function Log-Ok    { param($msg) Write-Host "OK $msg" -ForegroundColor Green }
function Log-Warn  { param($msg) Write-Host "!  $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "X  $msg" -ForegroundColor Red }
function Log-Step  { param($msg) Write-Host "`n> $msg" -ForegroundColor White }

# ── 작업 디렉토리 = 스크립트 위치 ──
$ScriptDir = $PSScriptRoot
Set-Location $ScriptDir
Log-Info "작업 디렉토리: $ScriptDir"

# ── 1. 필수 도구 확인 ──
Log-Step "1/7. 필수 도구 확인"

function Require-Cmd {
    param([string]$Name, [string]$Hint)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Log-Error "$Name 가 설치되지 않았습니다. ($Hint)"
        return $false
    }
    $ver = & $Name --version 2>&1 | Select-Object -First 1
    Log-Ok "${Name}: $ver"
    return $true
}

$missing = $false
if (-not (Require-Cmd "node" "https://nodejs.org/en/download — v18 이상 필요")) { $missing = $true }
if (-not (Require-Cmd "npm"  "Node.js와 함께 설치됨")) { $missing = $true }
if (-not (Require-Cmd "git"  "https://git-scm.com")) { $missing = $true }

if ($missing) {
    Log-Error "필수 도구가 누락되었습니다. SETUP.md '1️⃣ 사전 도구 설치' 섹션 참조."
    exit 1
}

# Node 버전 검사
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
    $nodeVer = node -p "process.versions.node"
    Log-Error "Node.js 18 이상이 필요합니다. 현재: v$nodeVer"
    exit 1
}

# ── 2. 메인 패키지 의존성 ──
Log-Step "2/7. 메인 패키지 의존성 설치"

if (Test-Path "node_modules") {
    Log-Warn "node_modules가 이미 존재합니다. npm install로 갱신합니다."
}
npm install
if ($LASTEXITCODE -ne 0) { Log-Error "npm install 실패"; exit 1 }
$pkgCount = (Get-ChildItem node_modules -Directory -ErrorAction SilentlyContinue).Count
Log-Ok "메인 의존성 설치 완료 ($pkgCount개 패키지)"

# ── 3. 빌드 (TypeScript → dist/) ──
Log-Step "3/7. TypeScript 빌드"

npx tsc
if (-not (Test-Path "dist\index.js")) {
    Log-Error "빌드 산출물 dist\index.js가 생성되지 않았습니다."
    exit 1
}
Log-Ok "빌드 완료: dist\index.js"

# ── 4. 웹 대시보드 (선택) ──
if (-not $NoWeb) {
    Log-Step "4/7. 웹 대시보드 의존성 설치"
    if (Test-Path "web") {
        Push-Location web
        npm install
        Pop-Location
        Log-Ok "웹 의존성 설치 완료"
    } else {
        Log-Warn "web\ 디렉토리가 없습니다. 스킵."
    }
} else {
    Log-Step "4/7. 웹 대시보드 (-NoWeb → 스킵)"
}

# ── 5. 글로벌 'devagent' / 'dev-agent' 명령어 등록 ──
if (-not $NoGlobal) {
    Log-Step "5/7. 글로벌 명령어 등록 (npm install -g .)"
    npm install -g .
    if ($LASTEXITCODE -eq 0) {
        Log-Ok "글로벌 명령어 등록 완료"
        if (Get-Command devagent -ErrorAction SilentlyContinue) {
            Log-Ok "사용 가능: 'devagent' 또는 'dev-agent'"
        } else {
            Log-Warn "devagent 명령이 PATH에서 보이지 않습니다. 새 터미널을 열거나 PATH 설정을 확인하세요."
        }
    } else {
        Log-Warn "npm install -g . 실패 — 관리자 PowerShell에서 다시 시도하거나 'npm link'를 사용하세요."
    }
} else {
    Log-Step "5/7. 글로벌 등록 (-NoGlobal → 스킵)"
    Log-Info "수동 실행 시: 'node $ScriptDir\dist\index.js ...'"
}

# ── 6. devagent-planner 스킬 글로벌 설치 ──
# 기획 단계는 Claude Code의 devagent-planner 스킬로 수행한다.
# ~/.claude/skills/ 에 설치해두면 어느 프로젝트 디렉토리에서 claude 를 열어도 사용 가능.
if (-not $NoSkill) {
    Log-Step "6/7. devagent-planner 스킬 설치 (~\.claude\skills\)"

    $skillSrc = Join-Path $ScriptDir ".claude\skills\devagent-planner"
    $skillsRoot = Join-Path $HOME ".claude\skills"
    $skillDst = Join-Path $skillsRoot "devagent-planner"

    if (Test-Path (Join-Path $skillSrc "SKILL.md")) {
        New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null
        if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
        Copy-Item -Recurse -Force $skillSrc $skillDst
        Log-Ok "스킬 설치 완료: $skillDst"
        Log-Info "사용법: 아무 디렉토리에서 'claude' 실행 후 ""Notion task <pageId> 기획해줘"""
    } else {
        Log-Warn "스킬 소스($skillSrc\SKILL.md)가 없습니다. 스킵."
    }
} else {
    Log-Step "6/7. devagent-planner 스킬 (-NoSkill → 스킵)"
}

# ── 7. 외부 에이전트 CLI 확인 ──
Log-Step "7/7. 외부 에이전트 CLI 확인"

# Claude Code CLI
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $claudeVer = claude --version 2>&1 | Select-Object -First 1
    Log-Ok "claude CLI 설치됨: $claudeVer"
} else {
    if (-not $SkipClaude) {
        Log-Info "claude CLI 미설치 — npm install -g @anthropic-ai/claude-code 실행"
        npm install -g "@anthropic-ai/claude-code"
        Log-Ok "claude CLI 설치 완료"
        Log-Warn "최초 1회 'claude' 실행 후 Anthropic 계정 OAuth 인증 필요"
    } else {
        Log-Warn "claude CLI 미설치 (-SkipClaude). 'npm install -g @anthropic-ai/claude-code'로 별도 설치 필요"
    }
}

# Codex CLI
if (Get-Command codex -ErrorAction SilentlyContinue) {
    $codexVer = codex --version 2>&1 | Select-Object -First 1
    Log-Ok "codex CLI 설치됨: $codexVer"
} else {
    Log-Warn "codex CLI 미설치 — Codex 공식 설치 가이드를 별도로 따라주세요."
}

# ── 마무리 안내 ──
Write-Host "`nOK dev-agent 빌드 완료`n" -ForegroundColor Green

Write-Host @"
다음 단계:

  1. 외부 CLI 인증 (아직 안 했다면):
     claude                  # Anthropic OAuth
     codex login             # OpenAI/Codex 로그인

  2. Notion 통합 등록:
     devagent notion login --token ntn_xxxxxxxxxxxx --default-db <DB_ID>

  3. 도움말:
     devagent --help

  4. 첫 워크플로우 실행 (기획 → 승인 → build):
     claude                                            # (1) 기획: "Notion task <ID> 기획해줘" (devagent-planner 스킬)
     devagent notion status <NOTION_PAGE_ID> Approved  # (2) 검토 후 승인
     devagent build <NOTION_PAGE_ID> --project <path>  # (3) 구현 + 리뷰 + PR

  5. (선택) .devagentrc.json으로 기본값 저장:
     '{ "task": "<DEFAULT_TASK_ID>", "projectPath": "<path>" }' | Out-File -Encoding utf8 .devagentrc.json
     이후 devagent build 만 입력해도 실행됨

자세한 가이드: SETUP.md (Windows 섹션)
"@
