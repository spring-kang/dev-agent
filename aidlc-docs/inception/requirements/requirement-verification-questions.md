# Requirements Verification Questions

아래 각 질문의 `[Answer]:` 태그 뒤에 선택지 문자(A, B, C 등) 또는 직접 작성한 답변을 기입해 주세요.

---

## Question 1: 오케스트레이터 구현 언어/형태

이 시스템의 오케스트레이터(전체 흐름을 제어하는 스크립트)를 어떤 형태로 만들까요?

A) Shell Script (Bash) - 가장 간단하고 CLI 도구 호출에 적합
B) Python Script - 로직 분기, 에러 처리, 파일 파싱에 유리
C) Node.js (TypeScript) - Claude Code SDK와의 친화성
X) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Question 2: Claude Code 기획 단계의 산출물

Claude Code가 "기획" 단계에서 생성해야 하는 산출물은 무엇인가요?

A) 요구사항 문서 (requirements.md) + 설계 문서 (design.md) - 상세 기획
B) 구현 지시서 (implementation-spec.md) - Codex가 바로 구현할 수 있는 구체적 명세
C) 요구사항 + 구현 지시서 + 테스트 시나리오 - 풀 세트
X) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Question 3: Codex 구현 호출 방식

Codex를 호출하여 코드를 구현시키는 방식은 어떤 것을 원하시나요?

A) `codex` CLI 명령어를 직접 호출 (터미널에서 `codex "implement ..."` 실행)
B) OpenAI API를 통한 Codex 호출 (API 키 기반)
C) Codex CLI의 `--full-auto` 모드 활용 (자율 구현 후 결과 확인)
X) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Question 4: 코드 리뷰 판단 기준

Claude Code가 코드 리뷰 시 "문제없음"으로 판단하는 기준은 무엇으로 할까요?

A) 컴파일/빌드 성공 + 기본 코드 품질 체크 (네이밍, 구조)
B) 빌드 성공 + 테스트 통과 + 코드 품질 체크
C) 빌드 성공 + 테스트 통과 + 보안 검토 + 설계 준수 여부 (엄격 모드)
X) Other (please describe after [Answer]: tag below)

[Answer]: X - 빌드 + 테스트 + 보안 + 설계 등 전체에 대한 종합 리뷰 (C보다 넓은 범위)

---

## Question 5: 반복 횟수 제한

기획 -> 구현 -> 리뷰 사이클이 무한 반복되지 않도록 제한을 둘까요?

A) 최대 3회 반복 후 강제 종료 (사용자에게 수동 개입 요청)
B) 최대 5회 반복 후 강제 종료
C) 제한 없음 - Claude가 승인할 때까지 무한 반복
D) 사용자가 설정 가능하게 (기본값 3회)
X) Other (please describe after [Answer]: tag below)

[Answer]: D

---

## Question 6: PR 생성 방식

PR을 올릴 때의 세부 사항은 어떻게 할까요?

A) `gh pr create`로 자동 PR 생성 (제목 + 본문 자동 작성)
B) 브랜치 push만 하고 PR 생성은 사용자가 수동으로
C) 자동 PR 생성 + 리뷰 내용 요약을 PR 본문에 포함
X) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Question 7: Git 브랜치 전략

작업 브랜치는 어떻게 관리할까요?

A) `feature/<task-name>` 브랜치를 자동 생성하고 작업
B) 현재 브랜치에서 바로 작업 (사용자가 미리 브랜치 생성)
C) `ai/<timestamp>-<task-summary>` 형태로 자동 생성
X) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Question 8: 대상 프로젝트 타입

이 시스템이 주로 다룰 프로젝트의 타입은 무엇인가요?

A) Spring Boot (Java/Kotlin) 백엔드 프로젝트 전용
B) 언어/프레임워크 무관 - 범용 시스템
C) 웹 프로젝트 (프론트엔드 + 백엔드)
X) Other (please describe after [Answer]: tag below)

[Answer]: B

---

## Question 9: Security Extensions

이 프로젝트에 보안 확장 규칙을 적용할까요?

A) Yes - 모든 SECURITY 규칙을 블로킹 제약으로 적용 (프로덕션 수준 애플리케이션 권장)
B) No - 모든 SECURITY 규칙 건너뛰기 (PoC, 프로토타입, 실험적 프로젝트에 적합)
X) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Question 10: Property-Based Testing Extension

이 프로젝트에 Property-Based Testing (PBT) 규칙을 적용할까요?

A) Yes - 모든 PBT 규칙을 블로킹 제약으로 적용
B) Partial - 순수 함수와 직렬화 round-trip에만 PBT 규칙 적용
C) No - 모든 PBT 규칙 건너뛰기
X) Other (please describe after [Answer]: tag below)

[Answer]: A

---
