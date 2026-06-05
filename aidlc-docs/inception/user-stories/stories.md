# User Stories

## Epic 1: 워크플로우 초기화 및 프로젝트 관리

### US-01: 워크플로우 시작
**As a** 개인 개발자,
**I want to** CLI에서 대상 프로젝트와 작업 설명을 지정하여 워크플로우를 시작할 수 있도록,
**So that** AI 기반 개발 파이프라인이 자동으로 실행된다.

**Acceptance Criteria:**
- [ ] `dev-agent run --project ./projects/my-app "로그인 기능 추가"` 명령으로 워크플로우 시작
- [ ] 대상 프로젝트 경로가 유효한 Git 레포인지 검증
- [ ] `claude`, `codex`, `gh` CLI가 설치/인증되었는지 사전 검증
- [ ] 작업 브랜치 `ai/<timestamp>-<task-summary>` 자동 생성
- [ ] 기존 작업 중인 변경사항이 있으면 경고 메시지 출력
- [ ] 워크플로우 시작 로그 기록

**Priority:** Must Have
**Story Points:** 5

---

### US-02: 프로젝트 워크스페이스 관리
**As a** 개인 개발자,
**I want to** `projects/` 디렉토리에 여러 대상 프로젝트를 배치하고 선택하여 작업할 수 있도록,
**So that** 하나의 오케스트레이터로 여러 프로젝트를 관리할 수 있다.

**Acceptance Criteria:**
- [ ] `projects/` 디렉토리가 `.gitignore`에 등록
- [ ] `projects/` 내 각 프로젝트는 독립된 Git 레포
- [ ] `--project` 옵션으로 프로젝트 경로 지정 (상대/절대 경로)
- [ ] 외부 경로 프로젝트도 절대 경로로 지정 가능
- [ ] 프로젝트 목록 조회 명령 제공: `dev-agent list`

**Priority:** Must Have
**Story Points:** 3

---

### US-03: 병렬 워크플로우 실행
**As a** 개인 개발자,
**I want to** 여러 프로젝트에 대해 워크플로우를 동시에 실행할 수 있도록,
**So that** 대기 시간을 줄이고 동시에 여러 작업을 진행할 수 있다.

**Acceptance Criteria:**
- [ ] 여러 프로젝트에 대해 동시 워크플로우 실행 가능
- [ ] 각 워크플로우는 독립적으로 실행 (하나의 실패가 다른 것에 영향 없음)
- [ ] 병렬 실행 상태를 구분하여 터미널에 표시
- [ ] 각 워크플로우별 로그 분리 저장
- [ ] `dev-agent status`로 실행 중인 모든 워크플로우 상태 조회

**Priority:** Should Have
**Story Points:** 8

---

## Epic 2: AI 기획 단계

### US-04: 자동 기획 산출물 생성
**As a** 개인 개발자,
**I want to** 작업 설명만 입력하면 Claude Code가 자동으로 기획 산출물(요구사항, 구현 지시서, 테스트 시나리오)을 생성하도록,
**So that** Codex가 구현할 수 있는 명확한 지시서를 얻을 수 있다.

**Acceptance Criteria:**
- [ ] Claude Code CLI가 대상 프로젝트 디렉토리를 cwd로 호출됨
- [ ] `requirements.md` - 요구사항 문서 생성
- [ ] `implementation-spec.md` - Codex 구현 지시서 생성
- [ ] `test-scenarios.md` - 테스트 시나리오 생성
- [ ] 산출물은 대상 프로젝트의 `.ai-workflow/current/`에 저장
- [ ] 기존 코드베이스 컨텍스트를 분석하여 반영

**Priority:** Must Have
**Story Points:** 8

---

### US-05: 리뷰 피드백 기반 기획 수정
**As a** 개인 개발자,
**I want to** 이전 코드 리뷰의 피드백이 다음 기획 사이클에 자동으로 반영되도록,
**So that** 반복할수록 더 정확한 구현 지시가 만들어진다.

**Acceptance Criteria:**
- [ ] CHANGES_REQUESTED 시 이전 리뷰 피드백을 Claude에게 컨텍스트로 전달
- [ ] 사용자 선택에 따라 부분 수정(피드백만) 또는 전체 재기획 수행
- [ ] 수정된 산출물이 이전 산출물과 달라진 부분 표시
- [ ] 누적된 피드백 히스토리를 `.ai-workflow/current/iterations/`에 기록

**Priority:** Must Have
**Story Points:** 5

---

## Epic 3: AI 코드 구현 단계

### US-06: Codex 기반 자동 코드 생성
**As a** 개인 개발자,
**I want to** Codex CLI가 구현 지시서를 기반으로 자동으로 코드를 생성하도록,
**So that** 수동 코딩 없이 기능이 구현된다.

**Acceptance Criteria:**
- [ ] `codex` CLI가 대상 프로젝트 디렉토리를 cwd로 호출됨
- [ ] `implementation-spec.md` 내용을 프롬프트로 전달
- [ ] Codex가 생성/수정한 파일 목록 수집
- [ ] 구현 완료 후 변경사항 자동 커밋 (사이클 번호 포함)
- [ ] 구현 중 타임아웃 발생 시 graceful 처리

**Priority:** Must Have
**Story Points:** 5

---

## Epic 4: AI 코드 리뷰 단계

### US-07: 종합 자동 코드 리뷰
**As a** 개인 개발자,
**I want to** Claude Code가 생성된 코드를 빌드, 테스트, 보안, 설계, 품질, 에러 처리, 성능 관점에서 종합 리뷰하도록,
**So that** 코드 리뷰어 없이도 높은 품질의 코드를 확보할 수 있다.

**Acceptance Criteria:**
- [ ] 리뷰 체크리스트 7개 항목 전체 검증:
  - 빌드/컴파일 성공
  - 테스트 통과
  - 보안 취약점 (OWASP Top 10)
  - 설계 준수 (requirements.md 대비)
  - 코드 품질 (네이밍, SOLID, 중복)
  - 에러 처리 적절성
  - 성능 이슈
- [ ] 리뷰 결과를 구조화된 형식으로 출력 (status, findings, summary)
- [ ] 각 finding에 severity, location, description, suggestion 포함
- [ ] 리뷰 결과 `.ai-workflow/current/iterations/cycle-N/review-result.md`에 저장

**Priority:** Must Have
**Story Points:** 8

---

### US-08: 리뷰 결과 판정
**As a** 개인 개발자,
**I want to** 리뷰 결과가 APPROVED 또는 CHANGES_REQUESTED로 명확히 판정되도록,
**So that** 워크플로우가 자동으로 다음 단계(PR 생성 또는 재시도)로 분기할 수 있다.

**Acceptance Criteria:**
- [ ] 모든 리뷰 항목 통과 시 `status: "APPROVED"` 반환
- [ ] 하나라도 실패 시 `status: "CHANGES_REQUESTED"` 반환
- [ ] APPROVED 시 자동으로 PR 생성 단계로 진행
- [ ] CHANGES_REQUESTED 시 피드백과 함께 다음 사이클로 전달

**Priority:** Must Have
**Story Points:** 3

---

## Epic 5: 반복 사이클 관리

### US-09: 자동 반복 사이클
**As a** 개인 개발자,
**I want to** 기획 -> 구현 -> 리뷰 사이클이 리뷰 통과 또는 최대 횟수까지 자동 반복되도록,
**So that** 개입 없이 코드 품질이 점진적으로 개선된다.

**Acceptance Criteria:**
- [ ] 완전 자동 실행 (PR 생성까지 무개입)
- [ ] 각 사이클의 리뷰 결과와 피드백 누적 관리
- [ ] 사이클 번호가 커밋 메시지와 로그에 포함
- [ ] 사이클 간 컨텍스트(이전 피드백) 유지

**Priority:** Must Have
**Story Points:** 5

---

### US-10: 반복 횟수 제한 및 초과 처리
**As a** 개인 개발자,
**I want to** 설정된 최대 반복 횟수(기본 3회) 도달 시 자동으로 선택지를 제공받도록,
**So that** 무한 반복을 방지하고 적절한 시점에 개입할 수 있다.

**Acceptance Criteria:**
- [ ] 설정 파일에서 `maxIterations` 커스터마이즈 가능 (기본값: 3)
- [ ] 최대 횟수 도달 시 선택지 제공:
  - 현재 상태로 PR 생성
  - 추가 N회 반복 허용
  - 수동 개입 (워크플로우 중단)
- [ ] 선택 결과에 따라 워크플로우 분기

**Priority:** Must Have
**Story Points:** 3

---

## Epic 6: PR 및 Git 관리

### US-11: 자동 PR 생성
**As a** 개인 개발자,
**I want to** 코드 리뷰 APPROVED 시 `gh pr create`로 자동 PR이 생성되도록,
**So that** 수동 PR 생성 과정 없이 바로 머지 검토를 할 수 있다.

**Acceptance Criteria:**
- [ ] `gh pr create`로 대상 프로젝트의 remote에 PR 생성
- [ ] PR 본문에 포함:
  - 작업 요약 (원래 요청)
  - 변경 사항 개요
  - 리뷰 사이클 히스토리 (반복 횟수, 각 사이클별 주요 변경)
  - 최종 리뷰 결과 요약
  - AI 생성 표시
- [ ] PR 생성 후 URL 터미널 출력
- [ ] PR 생성 전 remote에 브랜치 push

**Priority:** Must Have
**Story Points:** 5

---

### US-12: 브랜치 자동 관리
**As a** 개인 개발자,
**I want to** 워크플로우 시작 시 `ai/<timestamp>-<task-summary>` 브랜치가 자동 생성되도록,
**So that** 작업 브랜치를 수동으로 관리하지 않아도 된다.

**Acceptance Criteria:**
- [ ] 브랜치명 형식: `ai/<YYYYMMDD-HHmmss>-<task-summary-slug>`
- [ ] task summary는 요청 텍스트에서 자동 추출 (영문 slug)
- [ ] 기존 브랜치와 충돌 시 suffix 추가
- [ ] 각 구현 사이클 완료 후 자동 커밋

**Priority:** Must Have
**Story Points:** 3

---

## Epic 7: 설정 및 모니터링

### US-13: 워크플로우 설정 커스터마이즈
**As a** 개인 개발자,
**I want to** 설정 파일을 통해 반복 횟수, 리뷰 기준, CLI 경로 등을 커스터마이즈할 수 있도록,
**So that** 프로젝트와 작업 특성에 맞게 워크플로우를 조정할 수 있다.

**Acceptance Criteria:**
- [ ] `config.json` 또는 CLI 옵션으로 설정 가능
- [ ] 설정 가능 항목: maxIterations, branchPrefix, baseBranch, reviewChecks, logLevel, CLI 경로
- [ ] 프로젝트별 설정 지원 (대상 프로젝트 내 `.ai-workflow/config.json`)
- [ ] 글로벌 기본값 + 프로젝트별 오버라이드 구조
- [ ] `dev-agent config show` 명령으로 현재 설정 확인

**Priority:** Should Have
**Story Points:** 5

---

### US-14: 워크플로우 모니터링 및 대시보드
**As a** 개인 개발자,
**I want to** 워크플로우 진행 상태를 터미널 실시간 출력, 로그 파일, 완료 후 대시보드로 확인할 수 있도록,
**So that** 진행 상황을 파악하고 문제를 빠르게 발견할 수 있다.

**Acceptance Criteria:**
- [ ] 터미널 실시간 출력: 현재 단계, 사이클 번호, 경과 시간
- [ ] 로그 파일: `.ai-workflow/logs/`에 단계별 상세 로그 저장
- [ ] 워크플로우 완료 후 요약 리포트 생성:
  - 총 사이클 수, 각 사이클 소요 시간
  - 각 리뷰 결과 요약
  - 최종 상태 (APPROVED/중단)
  - 변경된 파일 수, 라인 수
- [ ] `dev-agent report <workflow-id>` 명령으로 이전 워크플로우 리포트 조회

**Priority:** Should Have
**Story Points:** 8

---

## Epic 8: 에러 처리 및 복구

### US-15: 실패 지점 복구
**As a** 개인 개발자,
**I want to** 워크플로우가 중간에 실패해도 실패 지점부터 재시작할 수 있도록,
**So that** 이전까지의 진행 상태를 잃지 않는다.

**Acceptance Criteria:**
- [ ] 각 단계 완료 시 상태를 `.ai-workflow/current/state.json`에 저장
- [ ] 실패 시 에러 메시지와 실패 지점 정보 출력
- [ ] `dev-agent resume --project ./projects/my-app` 명령으로 마지막 저장 지점부터 재시작
- [ ] 재시작 시 이전 산출물과 컨텍스트 복원
- [ ] CLI 프로세스 비정상 종료 시 graceful 에러 처리
- [ ] SIGINT/SIGTERM 핸들링으로 현재 상태 저장 후 종료

**Priority:** Must Have
**Story Points:** 8

---

## Story Summary

| Epic | Story Count | Must Have | Should Have | Total Points |
|---|---|---|---|---|
| 1. 워크플로우 초기화 및 프로젝트 관리 | 3 | 2 | 1 | 16 |
| 2. AI 기획 단계 | 2 | 2 | 0 | 13 |
| 3. AI 코드 구현 단계 | 1 | 1 | 0 | 5 |
| 4. AI 코드 리뷰 단계 | 2 | 2 | 0 | 11 |
| 5. 반복 사이클 관리 | 2 | 2 | 0 | 8 |
| 6. PR 및 Git 관리 | 2 | 2 | 0 | 8 |
| 7. 설정 및 모니터링 | 2 | 0 | 2 | 13 |
| 8. 에러 처리 및 복구 | 1 | 1 | 0 | 8 |
| **Total** | **15** | **12** | **3** | **82** |

## INVEST Compliance Check

| Criteria | Status | Notes |
|---|---|---|
| **I**ndependent | Pass | 각 스토리는 독립적으로 구현/테스트 가능 |
| **N**egotiable | Pass | 세부 구현 방식은 협상 가능 (Acceptance Criteria로 범위만 정의) |
| **V**aluable | Pass | 각 스토리가 사용자에게 직접적 가치를 제공 |
| **E**stimable | Pass | Story Points로 크기 추정 완료 |
| **S**mall | Pass | 가장 큰 스토리도 8pt (1~2일 작업 범위) |
| **T**estable | Pass | 모든 스토리에 검증 가능한 Acceptance Criteria 포함 |
