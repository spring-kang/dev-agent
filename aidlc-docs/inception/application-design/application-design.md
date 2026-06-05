# Application Design - Consolidated

## 1. Overview

**Project**: dev-agent - 멀티 에이전트 AI 개발 파이프라인 오케스트레이터
**Stack**: Node.js (TypeScript)
**Architecture**: 4-Layer Architecture (Presentation, Application, Domain, Infrastructure)
**CLI Pattern**: 서브커맨드 (Commander.js)
**Concurrency**: 비동기 Promise 기반
**Data Exchange**: 인메모리 + 파일 시스템 병행
**Configuration**: 환경변수 + JSON 설정 파일 계층 구조

---

## 2. Component Summary (10개)

| ID | Component | Layer | Purpose |
|---|---|---|---|
| C-01 | CLI | Presentation | 사용자 입력, 서브커맨드 라우팅 |
| C-02 | Orchestrator | Domain | 워크플로우 라이프사이클 관리 |
| C-03 | ClaudeAgent | Infrastructure | Claude Code CLI 기획/리뷰 래퍼 |
| C-04 | CodexAgent | Infrastructure | Codex CLI 구현 래퍼 |
| C-05 | ReviewEngine | Domain | 리뷰 결과 파싱/판정 |
| C-06 | GitManager | Infrastructure | Git 브랜치/커밋/PR 관리 |
| C-07 | ConfigManager | Infrastructure | 설정 로드/병합 |
| C-08 | StateManager | Infrastructure | 워크플로우 상태 저장/복원 |
| C-09 | Logger | Infrastructure | 로깅/터미널 출력/리포트 |
| C-10 | WorkspaceManager | Infrastructure | 프로젝트 디렉토리 관리/검증 |

---

## 3. Service Summary (4개)

| ID | Service | Pattern | Purpose |
|---|---|---|---|
| S-01 | WorkflowService | Facade | CLI 요청 -> 오케스트레이션 진입 |
| S-02 | PipelineService | Pipeline | Plan -> Implement -> Review 사이클 |
| S-03 | GitService | Service Layer | Git 작업 비즈니스 로직 |
| S-04 | MonitoringService | Observer | 상태 모니터링/리포트 |

---

## 4. Core Data Flow

```
User: dev-agent run --project ./projects/my-app "로그인 기능 추가"
  │
  ▼
CLI (C-01) ──▶ WorkflowService (S-01)
                  │
                  ├── ConfigManager (C-07): 설정 로드
                  ├── WorkspaceManager (C-10): 프로젝트 검증
                  │
                  ▼
             Orchestrator (C-02)
                  │
                  ├── GitService (S-03): 브랜치 생성
                  │
                  ▼ ◀─── 반복 (최대 N회) ───┐
             PipelineService (S-02)          │
                  │                          │
                  ├── ClaudeAgent (C-03)     │  CHANGES_
                  │     └── 기획 산출물      │  REQUESTED
                  │                          │
                  ├── CodexAgent (C-04)      │
                  │     └── 코드 생성        │
                  │                          │
                  ├── ClaudeAgent (C-03)     │
                  │     └── 코드 리뷰        │
                  │                          │
                  ├── ReviewEngine (C-05)    │
                  │     └── 판정 ────────────┘
                  │           │
                  │        APPROVED
                  ▼
             GitService (S-03): PR 생성
                  │
                  ▼
             결과 출력 (PR URL)
```

---

## 5. Project File Structure

```
dev-agent/
├── src/
│   ├── index.ts                    # CLI 진입점 (C-01)
│   ├── container.ts                # DI 컴포지션 루트
│   ├── types/                      # 공통 타입 정의
│   │   ├── config.ts
│   │   ├── workflow.ts
│   │   ├── review.ts
│   │   └── agent.ts
│   ├── services/                   # 서비스 레이어
│   │   ├── workflow.service.ts     # S-01
│   │   ├── pipeline.service.ts     # S-02
│   │   ├── git.service.ts          # S-03
│   │   └── monitoring.service.ts   # S-04
│   ├── domain/                     # 도메인 레이어
│   │   ├── orchestrator.ts         # C-02
│   │   └── review-engine.ts        # C-05
│   ├── infrastructure/             # 인프라 레이어
│   │   ├── agents/
│   │   │   ├── claude.agent.ts     # C-03
│   │   │   └── codex.agent.ts      # C-04
│   │   ├── git/
│   │   │   └── git.manager.ts      # C-06
│   │   ├── config/
│   │   │   └── config.manager.ts   # C-07
│   │   ├── state/
│   │   │   └── state.manager.ts    # C-08
│   │   ├── logger/
│   │   │   └── logger.ts           # C-09
│   │   └── workspace/
│   │       └── workspace.manager.ts # C-10
│   └── utils/                      # 유틸리티
├── tests/
│   ├── unit/
│   ├── integration/
│   └── property/                   # PBT 테스트
├── package.json
├── tsconfig.json
├── .gitignore                      # projects/ 포함
└── projects/                       # 대상 프로젝트 (.gitignore)
```

---

## 6. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CLI 프레임워크 | Commander.js | 서브커맨드 지원, 널리 사용, TypeScript 호환 |
| CLI 패턴 | 서브커맨드 | 성숙한 CLI 도구 표준 (git, docker, gh) |
| 에이전트 출력 | stdout 파이프 + 파일 병행 | 실시간 모니터링 + 산출물 보존 |
| 데이터 전달 | 인메모리 + 파일 병행 | 빠른 전달 + 실패 시 복구 가능 |
| 병렬 관리 | Promise 기반 | I/O 바운드 작업에 최적, 오버헤드 최소 |
| 설정 관리 | 환경변수 + JSON 계층 | 유연한 오버라이드, 12-factor app 원칙 |
| DI 방식 | 수동 컴포지션 루트 | 프레임워크 의존 없이 단순한 DI |
| 레이어 구조 | 4-Layer | 관심사 분리, 테스트 용이성 |

---

## 7. Detailed Artifacts Reference

- **Components**: [components.md](./components.md)
- **Methods**: [component-methods.md](./component-methods.md)
- **Services**: [services.md](./services.md)
- **Dependencies**: [component-dependency.md](./component-dependency.md)
