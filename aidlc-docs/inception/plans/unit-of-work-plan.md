# Unit of Work Plan

## Context
- **Project Type**: Monolith (단일 Node.js CLI 애플리케이션)
- **Deployment**: 단일 npm 패키지 (`dev-agent`)
- **Terminology**: 모놀리스이므로 "Module" 단위로 분해 (독립 배포 불필요)
- **Architecture**: 4-Layer (Presentation, Application, Domain, Infrastructure)
- **Components**: 10개 (Application Design에서 정의)
- **Services**: 4개 (Application Design에서 정의)
- **User Stories**: 15개 (8개 에픽, 82 Story Points)

## Decomposition Strategy

### 분석 결과
- 이 시스템은 모놀리스 CLI 도구이므로 **논리적 모듈**로 분해
- Application Design의 컴포넌트/서비스 구조와 User Stories의 에픽을 교차 분석하여 유닛 경계 결정
- 각 유닛은 CONSTRUCTION 단계에서 독립적으로 설계(Functional Design) → 구현(Code Generation) → 테스트(Build and Test) 가능해야 함
- 유닛 간 의존 방향은 Layer Architecture 규칙(상위→하위)을 준수

### 제안하는 유닛 분해 (5 Units)

| Unit | Name | Layer | Components | Stories |
|---|---|---|---|---|
| U-01 | Core Infrastructure | Infrastructure | Logger(C-09), ConfigManager(C-07), WorkspaceManager(C-10), StateManager(C-08) | US-02, US-13 |
| U-02 | Agent Integration | Infrastructure | ClaudeAgent(C-03), CodexAgent(C-04) | US-04, US-05, US-06 |
| U-03 | Domain Logic | Domain | ReviewEngine(C-05), Orchestrator(C-02), PipelineService(S-02), GitService(S-03) | US-07, US-08, US-09, US-10 |
| U-04 | Git & PR | Infrastructure + Domain | GitManager(C-06), GitService(S-03) | US-11, US-12 |
| U-05 | CLI & Workflow | Presentation + Application | CLI(C-01), WorkflowService(S-01), MonitoringService(S-04) | US-01, US-03, US-14, US-15 |

---

## Execution Checklist

### Phase 1: 유닛 경계 확정
- [x] 1.1 유닛 분해 전략 확정 (사용자 답변 반영)
- [x] 1.2 컴포넌트-유닛 매핑 확정
- [x] 1.3 스토리-유닛 매핑 확정

### Phase 2: 유닛 산출물 생성
- [x] 2.1 `unit-of-work.md` 생성 - 유닛 정의, 책임, 코드 조직 전략
- [x] 2.2 `unit-of-work-dependency.md` 생성 - 유닛 간 의존성 매트릭스
- [x] 2.3 `unit-of-work-story-map.md` 생성 - 스토리-유닛 매핑

### Phase 3: 검증
- [x] 3.1 모든 스토리가 유닛에 할당되었는지 검증 (15/15 = 100%)
- [x] 3.2 유닛 경계와 의존성 규칙 검증 (순환 의존성 없음)
- [x] 3.3 CONSTRUCTION 단계에서의 구현 순서 결정 (Bottom-Up: U-01→U-02→U-04→U-03→U-05)

---

## Questions

아래 질문의 `[Answer]:` 태그 뒤에 답변을 기입해 주세요.

## Question 1: Story Grouping
위에서 제안한 5개 유닛 분해에 동의하시나요? 아니면 다른 그룹핑을 원하시나요?

A) 제안대로 5개 유닛 (Core Infrastructure, Agent Integration, Domain Logic, Git & PR, CLI & Workflow)

B) 더 세밀하게 분해 (예: ReviewEngine을 독립 유닛으로, 모니터링을 독립 유닛으로)

C) 더 큰 단위로 합침 (예: 3개 유닛 - Infrastructure, Domain, Presentation)

X) Other (please describe after [Answer]: tag below)

[Answer]: A (5개 유닛 분해 동의)

## Question 2: Dependencies
유닛 간 통신 방식에 대해 어떤 접근을 선호하시나요?

A) 모든 유닛 간 통신은 TypeScript 인터페이스(Interface) 기반 계약 - 유닛 간 직접 의존 허용

B) 이벤트 버스 패턴 - 유닛 간 느슨한 결합 (EventEmitter 기반)

C) 혼합 - 핵심 흐름은 인터페이스 기반, 모니터링/로깅은 이벤트 기반 (Application Design에서 이미 결정된 방향)

X) Other (please describe after [Answer]: tag below)

[Answer]: C (혼합 - 핵심 흐름은 인터페이스 기반, 모니터링/로깅은 이벤트 기반)

## Question 3: Build Order
CONSTRUCTION 단계에서 유닛별 구현 순서를 어떻게 진행할까요?

A) 의존성 순서대로 Bottom-Up (Infrastructure → Domain → Presentation)
   순서: U-01 → U-02 → U-04 → U-03 → U-05

B) 핵심 기능 우선 (Core Pipeline을 먼저 구현하고 나머지 확장)
   순서: U-01(기본) → U-02 → U-03 → U-04 → U-05

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: A (AI 추천 - Bottom-Up 의존성 순서: U-01 → U-02 → U-04 → U-03 → U-05. Mock 최소화, 통합 리스크 최소화)

## Question 4: Git & PR 유닛 독립성
Git & PR(U-04)을 독립 유닛으로 유지할까요, 아니면 Domain Logic(U-03)에 합칠까요?

A) 독립 유닛 유지 - GitManager와 GitService는 관심사가 명확히 구분되어 별도 유닛이 적합

B) Domain Logic에 합침 - Orchestrator가 GitService를 직접 호출하므로 같은 유닛에 있는 것이 자연스러움

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: A (AI 추천 - 독립 유닛 유지. Git 도메인 경계 명확, U-03 비대화 방지, 독립 테스트 가능)
