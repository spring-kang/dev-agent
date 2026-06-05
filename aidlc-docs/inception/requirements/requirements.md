# Requirements Document

## Intent Analysis

- **User Request**: Claude Code(기획) -> Codex(구현) -> Claude Code(코드리뷰) 사이클을 반복하고, 리뷰 통과 시 자동 PR을 생성하는 멀티 에이전트 오케스트레이션 시스템 구축
- **Request Type**: New Project (신규 시스템)
- **Scope**: Multiple Components (오케스트레이터, Claude 연동, Codex 연동, Git/PR 관리, 리뷰 판단 엔진)
- **Complexity**: Complex (멀티 에이전트 워크플로우, 반복 루프, 품질 게이트, CLI 프로세스 관리)

---

## 1. Functional Requirements

### FR-01: 오케스트레이터 (Core Orchestrator)

- **FR-01.1**: Node.js (TypeScript)로 구현된 CLI 오케스트레이터
- **FR-01.2**: `claude` CLI와 `codex` CLI를 child process로 호출하여 제어
- **FR-01.3**: 사용자로부터 작업 요청(task description)을 입력받아 워크플로우 시작
- **FR-01.4**: 설정 파일(config)을 통해 반복 횟수 제한, 리뷰 기준 등을 커스터마이즈 가능
- **FR-01.5**: 각 단계의 진행 상태를 터미널에 실시간 출력 (로그/프로그레스)
- **FR-01.6**: 대상 프로젝트의 경로를 인자로 받거나, `projects/` 디렉토리 내의 프로젝트를 지정하여 작업
- **FR-01.7**: 모든 CLI 호출(claude, codex, gh)은 대상 프로젝트 디렉토리를 cwd로 설정하여 실행

### FR-08: 프로젝트 워크스페이스 관리 (Project Workspace)

- **FR-08.1**: 오케스트레이터 레포 내 `projects/` 디렉토리에 대상 프로젝트들을 배치
- **FR-08.2**: `projects/` 디렉토리는 `.gitignore`에 등록되어 오케스트레이터 레포에 포함되지 않음
- **FR-08.3**: 대상 프로젝트는 각각 독립된 Git 레포지토리 (별도의 remote, 브랜치 관리)
- **FR-08.4**: `projects/` 내 프로젝트를 Git clone으로 가져오거나, 새로 초기화할 수 있음
- **FR-08.5**: 워크플로우 실행 시 대상 프로젝트 경로를 지정: `dev-agent run --project ./projects/my-app "작업 설명"`
- **FR-08.6**: 기획 산출물(`.ai-workflow/`)은 대상 프로젝트 내부에 생성됨 (오케스트레이터 레포가 아님)
- **FR-08.7**: 외부 경로의 프로젝트도 절대 경로로 지정 가능: `dev-agent run --project /path/to/external-project "작업 설명"`

### FR-02: 기획 단계 (Planning Phase - Claude Code)

- **FR-02.1**: Claude Code CLI를 호출하여 사용자의 작업 요청을 기반으로 기획 산출물 생성
- **FR-02.2**: 산출물 세트:
  - `requirements.md` - 요구사항 문서
  - `implementation-spec.md` - Codex가 이해할 수 있는 구현 지시서
  - `test-scenarios.md` - 테스트 시나리오 및 검증 기준
- **FR-02.3**: 이전 리뷰 사이클의 피드백이 있으면 이를 반영하여 기획 수정
- **FR-02.4**: 기획 산출물은 대상 프로젝트 내 `.ai-workflow/` 디렉토리에 저장

### FR-03: 구현 단계 (Implementation Phase - Codex)

- **FR-03.1**: `codex` CLI를 직접 호출하여 코드 구현
- **FR-03.2**: implementation-spec.md를 프롬프트로 전달하여 구현 지시
- **FR-03.3**: Codex가 생성한 코드 변경사항을 워킹 디렉토리에 반영
- **FR-03.4**: 구현 완료 후 변경된 파일 목록을 수집하여 다음 단계로 전달

### FR-04: 코드 리뷰 단계 (Code Review Phase - Claude Code)

- **FR-04.1**: Claude Code CLI를 호출하여 Codex가 생성한 코드를 종합 리뷰
- **FR-04.2**: 리뷰 체크리스트 (모두 통과해야 승인):
  - 빌드/컴파일 성공 여부
  - 테스트 통과 여부
  - 보안 취약점 검토 (OWASP Top 10, 인젝션, XSS 등)
  - 설계 준수 여부 (requirements.md 대비)
  - 코드 품질 (네이밍, 구조, SOLID 원칙, 중복 코드)
  - 에러 처리 적절성
  - 성능 이슈 (N+1, 불필요한 반복 등)
- **FR-04.3**: 리뷰 결과를 구조화된 JSON 또는 Markdown으로 출력
  - `status`: "APPROVED" | "CHANGES_REQUESTED"
  - `findings`: 발견된 이슈 목록 (severity, location, description, suggestion)
  - `summary`: 전체 요약
- **FR-04.4**: CHANGES_REQUESTED 시 피드백을 다음 기획/구현 사이클로 전달

### FR-05: 반복 사이클 관리 (Iteration Control)

- **FR-05.1**: 기획 -> 구현 -> 리뷰 사이클을 자동 반복
- **FR-05.2**: 반복 횟수는 설정 가능 (기본값: 3회)
- **FR-05.3**: 최대 반복 횟수 도달 시 사용자에게 알림 후 선택 요청:
  - 현재 상태로 PR 생성
  - 추가 N회 반복 허용
  - 수동 개입 (워크플로우 중단)
- **FR-05.4**: 각 반복의 리뷰 결과와 피드백을 누적 관리

### FR-06: PR 자동 생성 (Pull Request Creation)

- **FR-06.1**: 코드 리뷰 APPROVED 시 자동으로 PR 생성
- **FR-06.2**: `ai/<timestamp>-<task-summary>` 형태의 브랜치 자동 생성
- **FR-06.3**: `gh pr create`를 사용하여 PR 생성
- **FR-06.4**: PR 본문에 포함할 내용:
  - 작업 요약 (원래 요청)
  - 변경 사항 개요
  - 리뷰 사이클 히스토리 (반복 횟수, 각 사이클별 주요 변경)
  - 최종 리뷰 결과 요약
  - AI 생성 표시
- **FR-06.5**: PR 생성 후 URL을 사용자에게 출력

### FR-07: Git 관리

- **FR-07.1**: 워크플로우 시작 시 `ai/<timestamp>-<task-summary>` 브랜치 자동 생성
- **FR-07.2**: 각 구현 사이클 완료 후 자동 커밋 (커밋 메시지에 사이클 번호 포함)
- **FR-07.3**: PR 생성 전 remote에 브랜치 push
- **FR-07.4**: 기존 작업 중인 변경사항이 있으면 워크플로우 시작 전 경고

---

## 2. Non-Functional Requirements

### NFR-01: 성능

- 오케스트레이터 자체의 오버헤드는 최소화 (CLI 호출 대기 시간이 대부분)
- 각 CLI 호출 시 timeout 설정 (기본: 5분, 설정 가능)

### NFR-02: 안정성

- CLI 프로세스 비정상 종료 시 graceful 에러 처리
- 중간에 실패해도 이전 산출물은 보존
- 시그널 핸들링 (SIGINT/SIGTERM)으로 클린업 수행

### NFR-03: 보안

- API 키나 토큰을 코드에 하드코딩하지 않음
- CLI 도구의 인증은 각 도구의 기존 인증 메커니즘 활용 (이미 로그인된 상태 전제)
- 생성된 코드에 민감 정보가 포함되지 않도록 리뷰 시 검증

### NFR-04: 확장성

- 새로운 AI 에이전트 추가 가능한 플러그인 구조
- 리뷰 체크리스트 항목을 설정으로 추가/제거 가능
- 다양한 프로젝트 타입(언어/프레임워크 무관)에 대응

### NFR-05: 사용성

- 명확한 CLI 인터페이스 (--help, --version 등)
- 진행 상태 실시간 표시
- 에러 발생 시 명확한 에러 메시지와 해결 방법 안내

### NFR-06: 로깅/추적

- 각 단계별 실행 로그 파일 저장
- 전체 워크플로우 히스토리 관리
- 디버그 모드 지원 (--verbose 또는 --debug)

---

## 3. System Architecture Overview

```
User Input: dev-agent run --project ./projects/my-app "기능 추가"
        |
        v
+-------------------+
| Orchestrator      |  Node.js (TypeScript)
| (dev-agent CLI)   |  cwd: dev-agent/ (오케스트레이터 레포)
+-------------------+
        |
        |  cwd 전환: ./projects/my-app/ (대상 프로젝트)
        |
        +---> [1. Planning] ---> claude CLI (cwd: 대상 프로젝트)
        |         |                  산출물 -> 대상 프로젝트/.ai-workflow/
        |         v
        +---> [2. Implementation] ---> codex CLI (cwd: 대상 프로젝트)
        |         |                      코드 생성 -> 대상 프로젝트 내
        |         v
        +---> [3. Code Review] ---> claude CLI (cwd: 대상 프로젝트)
        |         |                   리뷰 결과 -> .ai-workflow/iterations/
        |         |
        |         +--- APPROVED ---> [4. PR Creation]
        |         |                   gh CLI (cwd: 대상 프로젝트)
        |         |                   브랜치/PR -> 대상 프로젝트의 remote
        |         |
        |         +--- CHANGES_REQUESTED ---> [피드백과 함께 1번으로]
        |
        +---> [반복 횟수 초과] ---> 사용자 선택 요청
```

**핵심 원칙**: 오케스트레이터는 제어만 담당하고, 모든 코드 생성/리뷰/Git 작업은 대상 프로젝트 디렉토리 안에서 수행됨.

---

## 4. Configuration Schema

```typescript
interface WorkflowConfig {
  // 프로젝트 워크스페이스
  projectsDir: string;          // 기본값: "./projects"

  // 반복 제어
  maxIterations: number;        // 기본값: 3
  iterationTimeout: number;     // 각 사이클 타임아웃 (ms), 기본값: 300000

  // Git 설정
  branchPrefix: string;         // 기본값: "ai"
  baseBranch: string;           // 기본값: "main"
  autoCommit: boolean;          // 기본값: true

  // PR 설정
  prAutoCreate: boolean;        // 기본값: true
  prIncludeReviewSummary: boolean; // 기본값: true

  // 리뷰 기준
  reviewChecks: {
    build: boolean;             // 빌드 검증
    tests: boolean;             // 테스트 통과
    security: boolean;          // 보안 검토
    design: boolean;            // 설계 준수
    codeQuality: boolean;       // 코드 품질
    errorHandling: boolean;     // 에러 처리
    performance: boolean;       // 성능 이슈
  };

  // CLI 경로 (커스텀 설치 위치 지원)
  claudePath: string;           // 기본값: "claude"
  codexPath: string;            // 기본값: "codex"
  ghPath: string;               // 기본값: "gh"

  // 로깅
  logLevel: "debug" | "info" | "warn" | "error";
  logDir: string;               // 기본값: ".ai-workflow/logs"
}
```

---

## 5. Directory Structure

### 5.1 오케스트레이터 레포 구조

```
dev-agent/                           # 오케스트레이터 프로젝트 (이 레포)
├── src/                             # 오케스트레이터 소스코드
│   ├── index.ts                     # CLI 엔트리포인트
│   ├── orchestrator.ts              # 핵심 오케스트레이션 로직
│   ├── agents/                      # AI 에이전트 연동 모듈
│   │   ├── claude.ts                # Claude Code CLI 래퍼
│   │   └── codex.ts                 # Codex CLI 래퍼
│   ├── git/                         # Git/PR 관리 모듈
│   ├── review/                      # 리뷰 판단 엔진
│   └── config/                      # 설정 관리
├── package.json
├── tsconfig.json
├── .gitignore                       # projects/ 포함
├── projects/                        # *** 대상 프로젝트 워크스페이스 (.gitignore) ***
│   ├── my-spring-app/               # 예: 대상 프로젝트 A (독립 Git 레포)
│   ├── my-react-app/                # 예: 대상 프로젝트 B (독립 Git 레포)
│   └── ...
└── aidlc-docs/                      # AI-DLC 문서 (오케스트레이터 개발용)
```

### 5.2 대상 프로젝트 내 워크플로우 산출물 구조

```
projects/my-spring-app/              # 대상 프로젝트 (독립 Git 레포)
├── [프로젝트 기존 파일들...]
├── .ai-workflow/                    # 워크플로우 산출물 (대상 프로젝트 내부)
│   ├── config.json                  # 워크플로우 설정 (프로젝트별)
│   ├── current/                     # 현재 진행 중인 작업
│   │   ├── task.md                  # 원본 작업 요청
│   │   ├── requirements.md          # 기획: 요구사항
│   │   ├── implementation-spec.md   # 기획: 구현 지시서
│   │   ├── test-scenarios.md        # 기획: 테스트 시나리오
│   │   └── iterations/              # 반복 사이클 기록
│   │       ├── cycle-1/
│   │       │   ├── review-result.md
│   │       │   └── feedback.md
│   │       └── cycle-2/
│   │           ├── review-result.md
│   │           └── feedback.md
│   ├── history/                     # 완료된 작업 히스토리
│   └── logs/                        # 실행 로그
└── .gitignore                       # .ai-workflow/ 포함 여부는 프로젝트 정책에 따름
```

---

## 6. Extension Configuration

| Extension | Enabled | Decided At |
|---|---|---|
| Security Baseline | Yes | Requirements Analysis |
| Property-Based Testing | Yes | Requirements Analysis |

---

## 7. Constraints & Assumptions

### Constraints
- `claude` CLI가 사전에 설치 및 인증된 상태여야 함
- `codex` CLI가 사전에 설치 및 인증된 상태여야 함
- `gh` CLI가 사전에 설치 및 인증된 상태여야 함
- 대상 프로젝트가 Git 레포지토리로 초기화된 상태여야 함
- 인터넷 연결 필요 (AI API 호출)
- 오케스트레이터 레포와 대상 프로젝트 레포는 별개의 Git 저장소

### Assumptions
- 사용자는 각 CLI 도구에 이미 로그인된 상태
- 대상 프로젝트는 Git으로 관리되며 remote가 설정된 상태
- GitHub를 원격 저장소로 사용 (gh CLI 기반 PR)
- 언어/프레임워크 무관 범용 시스템
- `projects/` 디렉토리는 오케스트레이터 레포의 `.gitignore`에 포함
