# User Personas

## Persona 1: Solo Developer (솔로 개발자)

| Attribute | Description |
|---|---|
| **Name** | 민수 (Solo Dev) |
| **Role** | 개인 개발자 / 프리랜서 |
| **Tech Level** | 중급~상급 (CLI 도구, Git, AI 코딩 어시스턴트 사용 경험 있음) |
| **Goal** | AI 에이전트를 활용하여 혼자서도 빠르고 품질 높은 코드를 생산하고 싶다 |
| **Motivation** | 반복적인 기획-구현-리뷰 과정을 자동화하여 생산성 극대화 |
| **Pain Points** | 혼자 개발 시 코드 리뷰어가 없음, 반복 작업에 시간 소모, 품질 관리 어려움 |
| **Environment** | macOS/Linux 터미널, VS Code, Claude Code CLI 및 Codex CLI 로그인 완료 |
| **Typical Workflow** | 기능 아이디어 -> dev-agent 실행 -> 결과 PR 확인 -> 머지 |

### Key Scenarios
- 사이드 프로젝트에 새 기능 추가
- 기존 코드의 리팩토링 요청
- 버그 수정 작업 자동화
- 여러 프로젝트를 동시에 작업

---

## Persona 2: Project Maintainer (프로젝트 관리자)

| Attribute | Description |
|---|---|
| **Name** | 지영 (Maintainer) |
| **Role** | 오픈소스 또는 개인 프로젝트 메인테이너 |
| **Tech Level** | 상급 (자동화, CI/CD, 코드 품질 도구에 익숙) |
| **Goal** | AI가 생성한 코드가 프로젝트 표준과 보안 기준을 충족하는지 확인하고 싶다 |
| **Motivation** | 자동 생성된 PR이 높은 품질을 유지하여 수동 리뷰 부담 최소화 |
| **Pain Points** | AI 생성 코드의 품질 불확실성, 보안 취약점 우려, 반복적 수동 검토 |
| **Environment** | GitHub 기반 프로젝트, PR 리뷰 워크플로우, 보안 스캐닝 도구 |
| **Typical Workflow** | dev-agent로 PR 생성 -> 최종 확인 -> 머지/배포 |

### Key Scenarios
- AI PR의 리뷰 히스토리를 통해 품질 신뢰도 확인
- 워크플로우 설정 커스터마이즈 (리뷰 기준 강화)
- 워크플로우 실패 시 원인 분석 및 재시작
- 완료 후 대시보드/리포트로 결과 확인

---

## Persona-Story Mapping

| Persona | Primary Stories | Secondary Stories |
|---|---|---|
| Solo Developer | US-01~05, US-08~10, US-13~14 | US-06~07, US-11~12, US-15 |
| Project Maintainer | US-06~07, US-11~12, US-15 | US-01~05, US-08~10, US-13~14 |
