/**
 * Notion 통합 타입 정의
 *
 * 데이터 모델:
 * - NotionConfig: 인증 + 기본 DB ID + Status 옵션 매핑
 * - NotionTask: DB row 1개 = 작업 1개 (Jira 티켓 대체)
 * - NotionPage: 단일 페이지 (Task의 본문 또는 참조 페이지)
 * - EnhancedPlan: Task + 본문 + 참조 페이지 → Claude 보강 결과
 */

import type { WorkflowPhase } from "./workflow.js";

// ── 인증 설정 ──

export interface NotionAuth {
  /**
   * Notion Internal Integration Token
   * 형식: ntn_... 또는 secret_...
   * 발급: https://www.notion.so/my-integrations
   */
  integrationToken: string;
}

export interface NotionConfig {
  notion?: {
    auth: NotionAuth;
    /** 작업 DB ID (UUID, 하이픈 포함 가능) */
    defaultDatabaseId?: string;
    /** 워크플로우 phase → Notion Status 옵션명 매핑 (선택) */
    statusMapping?: Partial<Record<WorkflowPhase, string>>;
    /** Notion DB 속성명 매핑 (기본값은 dev-agent 권장 스키마) */
    propertyMapping?: NotionPropertyMapping;
  };
}

/**
 * Notion DB 속성명 매핑.
 * dev-agent는 다음 권장 스키마를 기본으로 사용:
 *   Name (title) / Status (status) / Assignee (people) /
 *   Project Path (rich_text or url) / References (relation or url)
 *
 * 다른 이름을 쓰는 사용자는 propertyMapping으로 재정의 가능 (확장용).
 */
export interface NotionPropertyMapping {
  title?: string;
  status?: string;
  assignee?: string;
  projectPath?: string;
  references?: string;
}

export const DEFAULT_NOTION_PROPERTY_MAPPING: Required<NotionPropertyMapping> = {
  title: "Name",
  status: "Status",
  assignee: "Assignee",
  projectPath: "Project Path",
  references: "References",
};

// ── Notion 도메인 타입 ──

export interface NotionUser {
  id: string;
  name: string;
  email?: string;
}

export interface NotionTaskSummary {
  /** 페이지 UUID (DB row의 ID) */
  pageId: string;
  /** URL */
  url: string;
  /** Name 속성 (필수) */
  title: string;
  /** Status 옵션명 (없으면 빈 문자열) */
  status: string;
  /** 할당된 사용자들 */
  assignees: NotionUser[];
  /** 프로젝트 경로 (Notion 속성 우선, 없으면 빈 문자열) */
  projectPath: string;
  /** 참조 URL 목록 (relation 또는 url 멀티) */
  referenceUrls: string[];
  /** 최종 수정 시각 */
  lastEditedTime: string;
}

export interface NotionTaskDetail extends NotionTaskSummary {
  /** 페이지 본문을 markdown으로 변환한 결과 */
  bodyMarkdown: string;
  /** 참조 URL 중 Notion 페이지로 해석된 본문들 */
  referencedPages: NotionPage[];
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  bodyMarkdown: string;
  lastEditedTime: string;
}

// ── 기획 고도화 결과 ──

export interface EnhancedPlan {
  /** Notion task의 pageId */
  originalTaskId: string;
  taskTitle: string;
  /** Claude가 생성한 상세 기획 (markdown) */
  enhancedTaskDescription: string;
  context: {
    task: NotionTaskDetail;
  };
  generatedAt: string;
}

// ── 워크플로우 → Notion Status 매핑 기본값 ──
//
// 기획 단계(planning/plan_review/approved) 는 사용자가 `claude` CLI 로 직접 수행하고
// Notion 에서 직접 Status="Approved" 로 전이하므로 자동 sync 대상이 아니다.
// devagent 가 자동으로 갱신하는 단계는 implementation 부터.
export const DEFAULT_NOTION_STATUS_MAPPING: Record<WorkflowPhase, string> = {
  initializing: "Approved",
  planning: "Approved",
  plan_review: "Approved",
  approved: "Approved",
  implementation: "In Progress",
  review: "In Review",
  pr_creation: "In Review",
  completed: "Done",
  failed: "Approved",
  stopped: "Approved",
};

// ── 통합 메타데이터 (워크플로우 상태에 부착) ──

export interface IntegrationMetadata {
  notionTaskId?: string;
  notionTaskUrl?: string;
  lastSyncedStatus?: string;
  lastSyncedAt?: string;
}
