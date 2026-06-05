# Functional Design Plan - U-01: Core Infrastructure

## Unit Context
- **Unit**: U-01 Core Infrastructure
- **Layer**: Infrastructure
- **Components**: Logger (C-09), ConfigManager (C-07), WorkspaceManager (C-10), StateManager (C-08)
- **Stories**: US-02 (프로젝트 워크스페이스 관리, 3pt), US-13 (워크플로우 설정 커스터마이즈, 5pt)
- **Total Points**: 8

## Execution Checklist

### Phase 1: Logger (C-09) 상세 설계
- [x] 1.1 로그 레벨 처리 규칙 정의
- [x] 1.2 터미널 출력 포맷 설계 (실시간 진행 상태)
- [x] 1.3 파일 로깅 규칙 (회전, 보존 기간, 디렉토리 구조)
- [x] 1.4 Child Logger 격리 전략 (병렬 워크플로우)
- [x] 1.5 리포트 생성 로직

### Phase 2: ConfigManager (C-07) 상세 설계
- [x] 2.1 설정 소스별 로드 로직 (환경변수, 글로벌 JSON, 프로젝트 JSON, CLI 옵션)
- [x] 2.2 설정 병합 알고리즘 (우선순위 규칙)
- [x] 2.3 설정 검증 규칙 (필수 값, 타입, 범위)
- [x] 2.4 기본값 정의 및 initDefault 로직

### Phase 3: WorkspaceManager (C-10) 상세 설계
- [x] 3.1 프로젝트 검증 로직 (Git 레포, remote 설정, 디렉토리 구조)
- [x] 3.2 CLI 도구 가용성 검증 로직 (claude, codex, gh, git)
- [x] 3.3 .ai-workflow 디렉토리 초기화 규칙
- [x] 3.4 프로젝트 목록 조회 및 필터링

### Phase 4: StateManager (C-08) 상세 설계
- [x] 4.1 상태 직렬화/역직렬화 형식
- [x] 4.2 상태 저장 트리거 규칙 (어떤 시점에 저장?)
- [x] 4.3 상태 복원 로직 (실패 지점 판단, 복원 가능 여부)
- [x] 4.4 SIGINT/SIGTERM 핸들링 로직
- [x] 4.5 히스토리 아카이브 규칙

### Phase 5: 도메인 엔티티 및 비즈니스 규칙
- [x] 5.1 공통 타입 정의 (config.ts 내 도메인 모델)
- [x] 5.2 비즈니스 규칙 문서화
- [x] 5.3 에러 처리 전략

---

## Questions

아래 질문의 `[Answer]:` 태그 뒤에 답변을 기입해 주세요.

## Question 1: 로그 출력 포맷
터미널에 실시간 출력되는 진행 상태의 포맷을 어떤 스타일로 할까요?

A) 단순 텍스트 (예: `[INFO] [14:32:05] Planning phase started (cycle 1)`)

B) 컬러 + 아이콘 (예: `🔵 Planning ▸ Cycle 1 ▸ 00:45 elapsed`)

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: B (AI 추천 - 컬러+아이콘. CLI UX 향상, 단계 시각적 구분. --no-color 옵션으로 비활성화 지원)

## Question 2: 로그 파일 관리
로그 파일의 보존/관리 정책은 어떻게 할까요?

A) 워크플로우별 단일 로그 파일 (예: `.ai-workflow/logs/workflow-<id>.log`), 보존 기간 없음

B) 날짜별 로그 파일 + 최대 보존 개수 (예: 최근 10개 워크플로우)

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: A (AI 추천 - 워크플로우별 단일 파일, 보존 기간 없음. 아카이브로 이동하므로 별도 정책 불필요, 단순 구현)

## Question 3: 설정 검증 실패 시 동작
설정값이 유효하지 않을 때 어떻게 처리할까요?

A) 즉시 에러 + 프로세스 종료 (엄격 모드)

B) 경고 출력 + 기본값으로 대체 (관용 모드)

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: X (AI 추천 - 혼합: 필수값 누락/치명적 오류는 에러 종료, 선택적 설정 범위 초과는 경고+기본값 대체. 설정 항목별 severity 분류)

## Question 4: 상태 저장 빈도
워크플로우 상태를 얼마나 자주 저장할까요?

A) 각 단계(planning, implementation, review) 완료 시에만 저장

B) 각 단계 시작/완료 시 모두 저장 + 주기적 체크포인트 (1분마다)

C) 추천해줘

X) Other (please describe after [Answer]: tag below)

[Answer]: A (AI 추천 - 각 단계 완료 시에만 저장. 단계 수분 단위이므로 충분한 복구 지점. SIGINT 시 긴급 저장으로 보완. 주기적 저장은 복잡성 대비 이점 적음)
