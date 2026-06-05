# Functional Design Plan - U-02: Agent Integration

## Unit Context
- **Unit**: U-02 Agent Integration
- **Layer**: Infrastructure
- **Components**: ClaudeAgent (C-03), CodexAgent (C-04)
- **Stories**: US-04 (자동 기획 산출물 생성, 8pt), US-05 (리뷰 피드백 기반 기획 수정, 5pt), US-06 (Codex 기반 자동 코드 생성, 5pt)
- **Total Points**: 18

## Execution Checklist

### Phase 1: ClaudeAgent (C-03) 상세 설계
- [x] 1.1 CLI 프로세스 생성 전략 (spawn 옵션, 환경변수)
- [x] 1.2 Planning 모드 프롬프트 구성 로직
- [x] 1.3 Review 모드 프롬프트 구성 로직
- [x] 1.4 stdout/stderr 캡처 및 파이프 처리
- [x] 1.5 산출물 파일 파싱 로직
- [x] 1.6 타임아웃 및 에러 처리

### Phase 2: CodexAgent (C-04) 상세 설계
- [x] 2.1 CLI 프로세스 생성 전략 (spawn 옵션)
- [x] 2.2 구현 지시 프롬프트 구성 로직
- [x] 2.3 변경 파일 목록 수집 방법
- [x] 2.4 타임아웃 및 에러 처리

### Phase 3: 공통 비즈니스 규칙
- [x] 3.1 프로세스 라이프사이클 규칙
- [x] 3.2 피드백 기반 재기획 로직
- [x] 3.3 에러 복구 전략

---

## Questions

## Question 1: Claude CLI 호출 방식
Claude Code CLI에 프롬프트를 전달하는 방식은?

A) --print 플래그 + stdin으로 프롬프트 전달 (비인터랙티브 모드)

B) -p 플래그 + 프롬프트를 인자로 직접 전달

C) 추천해줘

[Answer]: B (AI 추천 - claude -p "prompt" --output-format json 형태. 비인터랙티브 출력 모드, 프롬프트를 직접 인자로 전달하는 것이 가장 단순하고 안정적)

## Question 2: Codex CLI 호출 방식
Codex CLI에 구현 지시를 전달하는 방식은?

A) codex -q "prompt" (quiet 모드, 프롬프트 직접 전달)

B) 파일로 프롬프트를 전달하고 경로 참조

C) 추천해줘

[Answer]: A (AI 추천 - codex -q "prompt" --approval-mode full-auto. quiet 모드로 비인터랙티브 실행, full-auto로 모든 변경 자동 승인)

## Question 3: 프롬프트 길이 제한 대응
implementation-spec.md가 매우 길 경우 어떻게 처리?

A) 프롬프트 인자로 전달 (OS 인자 길이 제한에 걸릴 수 있음)

B) 프롬프트를 임시 파일로 저장하고 "Read this file and follow instructions: <path>" 패턴 사용

C) 추천해줘

[Answer]: B (AI 추천 - 파일 참조 패턴. OS 인자 길이 제한(약 128KB~2MB) 회피, 복잡한 구현 지시서도 안전하게 전달)

