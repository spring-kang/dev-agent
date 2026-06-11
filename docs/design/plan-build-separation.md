# 기획-개발 분리 (plan / build 2단계 워크플로우) 설계 명세

> **상태**: ⚠️ **일부 대체됨(superseded)** — `devagent plan` CLI 명령은 구현하지 않기로 결정.
> 기획 단계는 Claude Code의 **`devagent-planner` 스킬**(`~/.claude/skills/`)로 대화형 수행하는 방식으로 변경됨.
> `devagent build` 의 Approved 게이트는 설계대로 구현됨. 최신 워크플로우는 README.md / SETUP.md 참조.
> **작성일**: 2026-06-06
> **관련 토론**: 사용자 요청 "(1) 기획 고도화 하는 스텝이랑 (2) 개발 및 리뷰하는 스텝을 나누고 싶어. 승인된 기획만 개발을 하고 싶은데 가능할까?"

## 1. 목표

현재 `devagent task <ID>` 한 번의 호출이 **기획 고도화 → Planning → Implementation → Review → PR** 전 단계를 자동으로 끝낸다. 이를 **2단계로 분리**한다:

| 단계 | 명령 | 수행 작업 | 종료 시 Notion Status |
|------|------|---------|---------------------|
| Plan | `devagent plan <ID>` | PlanningEnhancer + ClaudeAgent.plan() | **Plan Review** |
| Build | `devagent build <ID>` | Status==Approved 검증 → Implementation → Review 사이클 → PR | **Done** (성공) / **failed** |

사용자는 **Plan 산출물을 검토한 뒤 Notion Status를 "Approved"로 직접 전이**시켜야 build가 실행된다.

## 2. 설계 결정 (사용자 확정)

| 결정 항목 | 선택 | 비고 |
|---------|-----|------|
| Notion Status 옵션 신규 추가 | 가능 | "Plan Review", "Approved" 두 옵션을 Notion DB에 사용자가 직접 추가 |
| 기존 `task` 명령 유지 | 제거 | 항상 plan / build로 분리 |
| Build 단계 Status 검증 | 엄격 | Status ≠ "Approved" 면 즉시 거부 |
| Plan 재실행 시 기존 산출물 처리 | 덮어쓰기 (archive 백업 후) | `.ai-workflow/archive/<id>-<ts>/` 로 이동 |

## 3. 영향 범위 (파일·라인 매핑)

### 3.1 타입 정의 변경

#### `src/types/workflow.ts`

- `WorkflowPhase` (line 11-19): `"plan_review"`, `"approved"` 두 값 추가
  ```text
  ... | "planning" | "plan_review" | "approved" | "implementation" | ...
  ```
- `PHASE_ORDER` (line 21-27): `plan_review`, `approved` 를 planning 이후 위치에 삽입
  ```text
  ["initializing", "planning", "plan_review", "approved", "implementation", "review", "pr_creation"]
  ```
- `PHASE_ICONS` / `PHASE_COLORS` (line 29-49): 새 phase 두 개 항목 추가
  - `plan_review`: 📋 / cyan
  - `approved`: ✔️ / green
- `WorkflowState` (line 62-78): 신규 필드
  - `planningCompleted: boolean` — plan 단계 완료 여부
  - `planApprovedAt?: string` — Build 진입 시각 (감사용)

#### `src/types/integrations.ts`

- `DEFAULT_NOTION_STATUS_MAPPING` (line 118-127): 두 phase 매핑 추가
  ```text
  plan_review: "Plan Review",
  approved: "Approved",
  ```

### 3.2 서비스 계층

#### `src/services/workflow.service.ts`

**기존 `executeFromNotion()` (line 104-191)** 을 두 메서드로 분리:

- **신규: `executeFromNotionPlanOnly(notionPageId, options)`**
  - line 122-126 의 `enhanceFromTask()` 호출 유지
  - line 174-180 의 `this.execute(...)` 호출은 **PipelineService.executePlanOnly(...)** 로 치환
  - 성공 시 Notion Status 를 `plan_review` 로 동기화
  - `state.planningCompleted = true` 저장
  - 반환: `{ enhancedPlan, planResult, artifactsPath }`

- **신규: `executeFromNotionBuildOnly(notionPageId, options)`**
  - 1) Notion Status 조회 → `"Approved"` 가 아니면 즉시 `WorkflowServiceError("Status가 Approved가 아닙니다. 기획을 먼저 승인하세요.", "recoverable")` throw
  - 2) `state.json` 복원 → `planningCompleted === true` 검증
  - 3) `PipelineService.executeBuildOnly()` 호출 (Planning 단계 스킵, Implementation 부터 시작)
  - 4) 성공 시 기존 흐름대로 PR 생성 + Status `completed`

### 3.3 파이프라인

#### `src/services/pipeline.service.ts`

- **기존 `executeCycle()` (line 48-91 외 추가 부분)** 시그니처 확장:
  ```text
  executeCycle(ctx, state, options?: { stage?: "full" | "plan-only" | "build-only" })
  ```
- `stage === "plan-only"`: line 48-73 Planning 만 실행 후 즉시 반환 (Implementation/Review 스킵)
- `stage === "build-only"`: line 48-73 Planning 단계 스킵, line 75-91 Implementation 부터 실행 (`planResult` 는 기존 `state.artifacts.implementationSpecPath` 에서 복원)
- 신규 helper:
  - `executePlanOnly(ctx, state)`
  - `executeBuildOnly(ctx, state)`

### 3.4 Orchestrator

#### `src/orchestrator/orchestrator.ts`

- `runCycleLoop()` (line 222-299): stage 인자를 받아 PipelineService 호출 시 전달
- Build-only 모드에서는 `cycleNumber` 가 기존 state 의 마지막 cycle+1 부터 시작 (재시도 누적 보존)

### 3.5 워크스페이스

#### `src/components/workspace-manager.ts`

- `initWorkflowDirs()` (line 141-153): 신규 모드 도입
  ```text
  initWorkflowDirs(projectPath, options?: { archiveExisting?: boolean })
  ```
- `archiveExisting === true` 일 때:
  1. `.ai-workflow/current/` 존재 여부 확인
  2. 존재하면 `.ai-workflow/archive/<workflowId>-<ISO_TS>/` 로 `mv`
  3. `current/` 새로 생성
- Plan 재실행 시 호출자가 `archiveExisting: true` 로 호출

### 3.6 CLI

#### `src/cli/*.ts` (entry: `src/index.ts`)

- **신규 명령**: `devagent plan <pageId> [--skip-enhancement] [--project <path>]`
  - WorkflowService.executeFromNotionPlanOnly 호출
- **신규 명령**: `devagent build <pageId> [--project <path>] [--max-iterations <n>]`
  - WorkflowService.executeFromNotionBuildOnly 호출
- **제거**: 기존 `task` 명령 (Commander 등록 해제 + README/help 텍스트 갱신)
- **호환성 경고**: `task` 입력 시 "이 명령은 제거되었습니다. `plan` 후 `build`를 사용하세요." 안내 후 exit 1

### 3.7 Notion 동기화

#### `src/integrations/notion-status-sync.ts`

- `syncForPhase()` (line 159-186): `plan_review`, `approved` 추가 phase 대응
- Build-only 시작 시 Notion 에서 현재 Status 를 **조회** 하는 신규 메서드 필요:
  - `fetchCurrentStatus(pageId): Promise<string>` — NotionClient 의 page get + Status property 추출
  - Build 진입 직전 호출하여 `"Approved"` 검증

## 4. 사용자 흐름 (시퀀스)

```text
[1] devagent notion list                 # 가능한 task 조회
[2] devagent plan <pageId>               # 기획 고도화 + Planning 실행
    → Notion Status: "Plan Review"
    → 산출물: .ai-workflow/current/artifacts/implementation-spec.md 등
[3] 사람: Notion 페이지 열어서 기획 검토
    → 만족하면 Status 를 "Approved" 로 수동 변경
    → 수정이 필요하면 → devagent plan <pageId> 재실행 (archive 백업 후 덮어쓰기)
[4] devagent build <pageId>              # Status=Approved 검증 → 개발 + 리뷰
    → 성공 시 Notion Status: "Done", PR URL 출력
```

## 5. 에러 시나리오

| 시나리오 | 동작 | 사용자 메시지 |
|---------|------|--------------|
| `build` 호출 시 Status ≠ Approved | 즉시 거부 | "Status가 Approved가 아닙니다 (현재: <status>). Notion에서 승인 후 다시 실행하세요." |
| `build` 호출 시 `.ai-workflow/current/state.json` 없음 | 거부 | "기획 단계 산출물이 없습니다. 먼저 `devagent plan <pageId>` 를 실행하세요." |
| `build` 호출 시 `planningCompleted !== true` | 거부 | "기획이 완료되지 않은 워크플로우입니다." |
| `plan` 재실행 시 기존 `current/` 존재 | archive로 이동 후 신규 생성 | "기존 기획을 archive/<id>-<ts>/ 로 백업하고 새 기획을 생성합니다." (info 로그) |
| Notion DB 에 "Approved" 옵션 없음 | warn 로그 + Status 동기화 스킵 | "Notion Status 옵션 'Approved'가 없습니다. DB에 옵션을 추가하세요." |

## 6. 테스트 시나리오 (TODO #8)

### 6.1 단위 테스트

| 테스트 ID | 대상 | 시나리오 |
|---------|------|---------|
| WS-PLAN-01 | WorkflowService.executeFromNotionPlanOnly | 정상 흐름 → state.planningCompleted=true |
| WS-PLAN-02 | 동일 | enhanceFromTask 실패 → 그대로 throw |
| WS-BUILD-01 | executeFromNotionBuildOnly | Status="Approved" → 정상 진입 |
| WS-BUILD-02 | 동일 | Status="Plan Review" → WorkflowServiceError throw |
| WS-BUILD-03 | 동일 | state 없음 → WorkflowServiceError throw |
| WS-BUILD-04 | 동일 | planningCompleted=false → throw |
| PS-STAGE-01 | PipelineService.executeCycle stage=plan-only | Implementation 단계 미실행 |
| PS-STAGE-02 | 동일 stage=build-only | Planning 단계 스킵, 기존 spec 재사용 |
| WM-ARCHIVE-01 | WorkspaceManager.initWorkflowDirs archiveExisting=true | 기존 current/ → archive/<id>-<ts>/ |

### 6.2 통합 테스트

- `devagent plan` → `devagent build` 연속 호출 → 양쪽 모두 정상 종료
- `devagent plan` → (Status 변경 없음) → `devagent build` → 거부
- `devagent plan` → `devagent plan` → archive 1개 생성 확인

## 7. 마이그레이션 영향

- **Notion DB 사용자 작업 필요**: "Plan Review", "Approved" Status 옵션을 사용자가 Notion DB 에 미리 추가해야 함
- **README/SETUP.md 갱신**: `devagent task` 사용 예시 모두 `plan` → `build` 두 단계로 교체
- **Notion Dev-Agent 페이지 갱신**: 2단계 워크플로우 섹션 추가 (현재 7단계 가이드는 plan/build 가 합쳐진 형태)
- **`.devagentrc.json`**: 옵션 추가 검토 (`defaultStage` 등) — 본 작업 범위 밖

## 8. 보류/후속 과제

- (옵션) Plan 결과를 Notion 본문에 자동 댓글로 요약 push (현재는 NotionArtifactSync 가 spec 파일을 본문에 동기화 중이므로 추가 불필요할 수 있음)
- (옵션) `devagent reject <pageId> --reason "..."` 명령 — Status를 "To Do"로 되돌리고 archive 정리

## 9. 구현 순서 (다음 세션)

1. 타입 확장 (workflow.ts, integrations.ts)
2. WorkspaceManager.archiveExisting 옵션
3. PipelineService stage 분기
4. WorkflowService.executeFromNotionPlanOnly / executeFromNotionBuildOnly
5. CLI 명령 plan/build 추가, task 제거
6. NotionStatusSync.fetchCurrentStatus
7. 단위 테스트
8. 통합 테스트
9. 문서 갱신 (README, SETUP.md, Notion 페이지)
10. 빌드 + 커밋 + push

## 10. 참고: 현재 코드 위치 요약

| 컴포넌트 | 파일:라인 |
|---------|----------|
| PlanningEnhancer.enhanceFromTask | src/integrations/planning-enhancer.ts:40-76 |
| WorkflowService.executeFromNotion | src/services/workflow.service.ts:104-191 |
| PipelineService Planning | src/services/pipeline.service.ts:48-73 |
| PipelineService Implementation | src/services/pipeline.service.ts:75-91 |
| Orchestrator.runCycleLoop | src/orchestrator/orchestrator.ts:222-299 |
| WorkspaceManager.initWorkflowDirs | src/components/workspace-manager.ts:141-153 |
| WorkflowState | src/types/workflow.ts:62-78 |
| DEFAULT_NOTION_STATUS_MAPPING | src/types/integrations.ts:118-127 |
| NotionStatusSync.syncForPhase | src/integrations/notion-status-sync.ts:159-186 |
