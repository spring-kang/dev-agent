# Unit of Work - Story Map

## Story-to-Unit Mapping

| Story | Epic | Unit | Priority | Points |
|---|---|---|---|---|
| US-01: 워크플로우 시작 | E1: 워크플로우 초기화 | **U-05**: CLI & Workflow | Must Have | 5 |
| US-02: 프로젝트 워크스페이스 관리 | E1: 워크플로우 초기화 | **U-01**: Core Infrastructure | Must Have | 3 |
| US-03: 병렬 워크플로우 실행 | E1: 워크플로우 초기화 | **U-05**: CLI & Workflow | Should Have | 8 |
| US-04: 자동 기획 산출물 생성 | E2: AI 기획 | **U-02**: Agent Integration | Must Have | 8 |
| US-05: 리뷰 피드백 기반 기획 수정 | E2: AI 기획 | **U-02**: Agent Integration | Must Have | 5 |
| US-06: Codex 기반 자동 코드 생성 | E3: AI 코드 구현 | **U-02**: Agent Integration | Must Have | 5 |
| US-07: 종합 자동 코드 리뷰 | E4: AI 코드 리뷰 | **U-03**: Domain Logic | Must Have | 8 |
| US-08: 리뷰 결과 판정 | E4: AI 코드 리뷰 | **U-03**: Domain Logic | Must Have | 3 |
| US-09: 자동 반복 사이클 | E5: 반복 사이클 관리 | **U-03**: Domain Logic | Must Have | 5 |
| US-10: 반복 횟수 제한 및 초과 처리 | E5: 반복 사이클 관리 | **U-03**: Domain Logic | Must Have | 3 |
| US-11: 자동 PR 생성 | E6: PR 및 Git 관리 | **U-04**: Git & PR | Must Have | 5 |
| US-12: 브랜치 자동 관리 | E6: PR 및 Git 관리 | **U-04**: Git & PR | Must Have | 3 |
| US-13: 워크플로우 설정 커스터마이즈 | E7: 설정 및 모니터링 | **U-01**: Core Infrastructure | Should Have | 5 |
| US-14: 워크플로우 모니터링 및 대시보드 | E7: 설정 및 모니터링 | **U-05**: CLI & Workflow | Should Have | 8 |
| US-15: 실패 지점 복구 | E8: 에러 처리 및 복구 | **U-05**: CLI & Workflow | Must Have | 8 |

---

## Unit-to-Story Mapping (역방향)

### U-01: Core Infrastructure (8 pts, 2 stories)
| Story | Priority | Points | 핵심 컴포넌트 |
|---|---|---|---|
| US-02: 프로젝트 워크스페이스 관리 | Must Have | 3 | WorkspaceManager |
| US-13: 워크플로우 설정 커스터마이즈 | Should Have | 5 | ConfigManager |

### U-02: Agent Integration (18 pts, 3 stories)
| Story | Priority | Points | 핵심 컴포넌트 |
|---|---|---|---|
| US-04: 자동 기획 산출물 생성 | Must Have | 8 | ClaudeAgent |
| US-05: 리뷰 피드백 기반 기획 수정 | Must Have | 5 | ClaudeAgent |
| US-06: Codex 기반 자동 코드 생성 | Must Have | 5 | CodexAgent |

### U-03: Domain Logic (19 pts, 4 stories)
| Story | Priority | Points | 핵심 컴포넌트 |
|---|---|---|---|
| US-07: 종합 자동 코드 리뷰 | Must Have | 8 | ReviewEngine, PipelineService |
| US-08: 리뷰 결과 판정 | Must Have | 3 | ReviewEngine |
| US-09: 자동 반복 사이클 | Must Have | 5 | Orchestrator, PipelineService |
| US-10: 반복 횟수 제한 및 초과 처리 | Must Have | 3 | Orchestrator |

### U-04: Git & PR (8 pts, 2 stories)
| Story | Priority | Points | 핵심 컴포넌트 |
|---|---|---|---|
| US-11: 자동 PR 생성 | Must Have | 5 | GitManager, GitService |
| US-12: 브랜치 자동 관리 | Must Have | 3 | GitManager |

### U-05: CLI & Workflow (29 pts, 4 stories)
| Story | Priority | Points | 핵심 컴포넌트 |
|---|---|---|---|
| US-01: 워크플로우 시작 | Must Have | 5 | CLI, WorkflowService |
| US-03: 병렬 워크플로우 실행 | Should Have | 8 | CLI, Orchestrator(간접) |
| US-14: 워크플로우 모니터링 및 대시보드 | Should Have | 8 | MonitoringService, Logger(간접) |
| US-15: 실패 지점 복구 | Must Have | 8 | CLI, WorkflowService, StateManager(간접) |

---

## Coverage Verification

### All Stories Assigned?

| Story | Assigned | Unit |
|---|---|---|
| US-01 | Yes | U-05 |
| US-02 | Yes | U-01 |
| US-03 | Yes | U-05 |
| US-04 | Yes | U-02 |
| US-05 | Yes | U-02 |
| US-06 | Yes | U-02 |
| US-07 | Yes | U-03 |
| US-08 | Yes | U-03 |
| US-09 | Yes | U-03 |
| US-10 | Yes | U-03 |
| US-11 | Yes | U-04 |
| US-12 | Yes | U-04 |
| US-13 | Yes | U-01 |
| US-14 | Yes | U-05 |
| US-15 | Yes | U-05 |

**Result**: 15/15 스토리 할당 완료 (100%)

### Priority Distribution per Unit

| Unit | Must Have | Should Have | Total |
|---|---|---|---|
| U-01 | 1 (3pt) | 1 (5pt) | 8 pt |
| U-02 | 3 (18pt) | 0 | 18 pt |
| U-03 | 4 (19pt) | 0 | 19 pt |
| U-04 | 2 (8pt) | 0 | 8 pt |
| U-05 | 2 (13pt) | 2 (16pt) | 29 pt |
| **Total** | **12 (61pt)** | **3 (21pt)** | **82 pt** |

---

## Build Phase - Story Implementation Order

### Phase 1: U-01 Core Infrastructure (8 pts)
1. US-02: 프로젝트 워크스페이스 관리 (Must, 3pt)
2. US-13: 워크플로우 설정 커스터마이즈 (Should, 5pt)

### Phase 2: U-02 Agent Integration (18 pts)
3. US-04: 자동 기획 산출물 생성 (Must, 8pt)
4. US-06: Codex 기반 자동 코드 생성 (Must, 5pt)
5. US-05: 리뷰 피드백 기반 기획 수정 (Must, 5pt)

### Phase 3: U-04 Git & PR (8 pts)
6. US-12: 브랜치 자동 관리 (Must, 3pt)
7. US-11: 자동 PR 생성 (Must, 5pt)

### Phase 4: U-03 Domain Logic (19 pts)
8. US-08: 리뷰 결과 판정 (Must, 3pt)
9. US-07: 종합 자동 코드 리뷰 (Must, 8pt)
10. US-10: 반복 횟수 제한 및 초과 처리 (Must, 3pt)
11. US-09: 자동 반복 사이클 (Must, 5pt)

### Phase 5: U-05 CLI & Workflow (29 pts)
12. US-01: 워크플로우 시작 (Must, 5pt)
13. US-15: 실패 지점 복구 (Must, 8pt)
14. US-03: 병렬 워크플로우 실행 (Should, 8pt)
15. US-14: 워크플로우 모니터링 및 대시보드 (Should, 8pt)
