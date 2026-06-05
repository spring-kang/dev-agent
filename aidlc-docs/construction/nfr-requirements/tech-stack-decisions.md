# Tech Stack Decisions - dev-agent

## 1. Runtime & Language

| 결정 항목 | 선택 | 대안 | 이유 |
|---|---|---|---|
| Runtime | **Node.js 20 LTS** | Deno, Bun | Claude/Codex CLI와 같은 생태계, 안정성 우선 |
| Language | **TypeScript 5.x** | JavaScript | strict 타입 안전성, 리팩토링 용이 |
| Module System | **ESM** (ES Modules) | CommonJS | Node.js 방향성, top-level await 지원 |
| Target | **ES2022** | ES2020, ES2023 | Node.js 20에서 네이티브 지원, 성능 최적 |

---

## 2. Framework & Libraries

### 2.1 Core Dependencies

| 라이브러리 | 버전 | 용도 | 대안 | 선택 이유 |
|---|---|---|---|---|
| **commander** | ^12.x | CLI 파싱 | yargs, meow | 서브커맨드 패턴 최적, 타입 지원 |
| **uuid** | ^9.x | 워크플로우 ID 생성 | nanoid, crypto.randomUUID | 표준 UUID v4, 범용적 |
| **chalk** | ^5.x | 터미널 색상 | kleur, picocolors | ESM 네이티브, 기능 충분 |

### 2.2 Built-in Modules (외부 의존 없음)

| 모듈 | 용도 | 참고 |
|---|---|---|
| `node:child_process` | Claude/Codex CLI spawn | shell: false 필수 |
| `node:fs/promises` | 파일 I/O (상태, 설정, 로그) | atomic write용 |
| `node:path` | 경로 처리 | 플랫폼 독립적 경로 |
| `node:events` | EventEmitter (모니터링) | 내장 모듈 |
| `node:readline` | 사용자 입력 (maxIterations 선택) | stdin 읽기 |
| `node:crypto` | UUID 대안 (crypto.randomUUID) | uuid 패키지 대체 가능 |

### 2.3 Dev Dependencies

| 라이브러리 | 버전 | 용도 |
|---|---|---|
| **vitest** | ^1.x | 테스트 프레임워크 |
| **typescript** | ^5.4 | 컴파일러 |
| **tsx** | ^4.x | 개발 시 TS 직접 실행 |
| **@types/node** | ^20.x | Node.js 타입 정의 |
| **eslint** | ^9.x | 린팅 |
| **prettier** | ^3.x | 코드 포매팅 |

---

## 3. Build & Tooling

| 결정 항목 | 선택 | 대안 | 이유 |
|---|---|---|---|
| Build Tool | **tsc** (TypeScript Compiler) | esbuild, swc | 타입 체킹 통합, CLI 도구에 빌드 속도 비중 낮음 |
| Test Runner | **Vitest** | Jest, Mocha | ESM 네이티브, 빠른 실행, TypeScript 설정 간편 |
| Package Manager | **npm** | yarn, pnpm | Node.js 기본, 추가 설치 불필요 |
| Linter | **ESLint flat config** | Biome | 생태계 표준, 플러그인 풍부 |
| Formatter | **Prettier** | Biome | 설정 표준화 |

---

## 4. Project Configuration

### 4.1 tsconfig.json 핵심 설정

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "projects"]
}
```

### 4.2 package.json 핵심 설정

```json
{
  "name": "dev-agent",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "dev-agent": "./dist/index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## 5. Directory Structure (최종)

```
dev-agent/
├── src/
│   ├── index.ts                     # CLI 진입점 (shebang)
│   ├── container.ts                 # DI 컴포지션 루트
│   │
│   ├── types/                       # 공유 타입 정의
│   │   ├── config.ts                # WorkflowConfig, ValidationResult
│   │   ├── workflow.ts              # WorkflowRequest, WorkflowResult, CycleContext
│   │   ├── review.ts                # ReviewResult, ReviewCheck, ReviewFinding
│   │   ├── agent.ts                 # PlanRequest, ImplementRequest, ReviewRequest
│   │   ├── git.ts                   # PrRequest, GitInitResult, FinalizeContext
│   │   ├── events.ts                # WorkflowEvent 타입들
│   │   └── errors.ts                # AppError, 하위 에러 클래스들
│   │
│   ├── components/                  # 컴포넌트 (Domain/Infrastructure)
│   │   ├── config-manager.ts        # C-03: ConfigManager
│   │   ├── workspace-manager.ts     # C-04: WorkspaceManager
│   │   ├── state-manager.ts         # C-06: StateManager
│   │   ├── logger.ts                # C-07: Logger
│   │   ├── review-engine.ts         # C-05: ReviewEngine
│   │   ├── claude-agent.ts          # C-08: ClaudeAgent
│   │   ├── codex-agent.ts           # C-09: CodexAgent
│   │   └── git-manager.ts           # C-10: GitManager
│   │
│   ├── services/                    # 서비스 (Application)
│   │   ├── workflow.service.ts      # S-01: WorkflowService (Facade)
│   │   ├── pipeline.service.ts      # S-02: PipelineService (Pipeline)
│   │   ├── git.service.ts           # S-03: GitService
│   │   └── monitoring.service.ts    # S-04: MonitoringService (Observer)
│   │
│   ├── orchestrator/                # Orchestrator (Application)
│   │   └── orchestrator.ts          # C-02: Orchestrator
│   │
│   └── cli/                         # CLI (Presentation)
│       ├── cli.ts                   # C-01: CLI (Commander.js 설정)
│       ├── commands/                # 서브커맨드 핸들러
│       │   ├── run.ts
│       │   ├── status.ts
│       │   ├── resume.ts
│       │   ├── list.ts
│       │   ├── config.ts
│       │   └── report.ts
│       └── formatters/              # 출력 포매팅
│           ├── error-formatter.ts
│           ├── report-formatter.ts
│           └── progress-display.ts
│
├── tests/
│   ├── unit/                        # 단위 테스트
│   │   ├── components/
│   │   └── services/
│   ├── integration/                 # 통합 테스트
│   └── fixtures/                    # 테스트 데이터
│
├── projects/                        # 대상 프로젝트 (gitignored)
│
├── aidlc-docs/                      # AI-DLC 문서 (개발 시 사용)
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.js
├── .prettierrc
├── .gitignore
└── README.md
```

---

## 6. 의존성 최소화 원칙

### 외부 패키지 사용 기준

```
허용 조건 (하나 이상 충족):
1. Node.js 내장 모듈로 구현이 불가능하거나 매우 복잡한 경우
2. 표준적으로 사용되는 패키지 (npm weekly downloads > 1M)
3. 보안 취약점이 없는 최신 유지보수 상태

금지:
- 단순 유틸리티 래퍼 (lodash 등) → 직접 구현
- 과도한 의존성 체인 패키지
- 마지막 업데이트가 1년 이상 된 패키지
```

### 최종 외부 의존성 목록 (Production)

| 패키지 | 의존성 수 | 크기 | 필수 여부 |
|---|---|---|---|
| commander | 0 | ~70KB | 필수 |
| chalk | 0 (ESM) | ~15KB | 필수 |
| uuid | 0 | ~20KB | 선택 (crypto.randomUUID 대체 가능) |
| **총합** | **0 transitive** | **~105KB** | |

> 목표: Production 의존성 3개 이하, transitive 의존성 0개

---

## 7. 결정 변경 이력

| 날짜 | 항목 | 변경 전 | 변경 후 | 이유 |
|---|---|---|---|---|
| (초기) | - | - | - | 초기 결정 |
