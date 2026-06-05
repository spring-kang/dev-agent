/**
 * API 클라이언트 - 백엔드 REST API 호출
 */

const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── 워크플로우 API ──

export interface WorkflowStatus {
  workflowId: string;
  projectPath: string;
  projectName: string;
  taskDescription: string;
  currentPhase: string;
  currentCycle: number;
  startedAt: string;
  updatedAt: string;
  elapsed: number;
  lastReviewStatus?: "APPROVED" | "CHANGES_REQUESTED";
}

export interface WorkflowReport {
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  status: string;
  totalDuration: number;
  totalCycles: number;
  phases: Array<{
    phase: string;
    cycleNumber: number;
    startedAt: number;
    completedAt?: number;
    duration?: number;
  }>;
  cycles: Array<{
    cycleNumber: number;
    startedAt: number;
    completedAt: number;
    duration: number;
    reviewStatus: "APPROVED" | "CHANGES_REQUESTED";
    findingsCount: number;
    criticalCount: number;
  }>;
  prUrl?: string;
  generatedAt: string;
}

export function getWorkflowStatuses(projectPath?: string) {
  const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
  return request<{ workflows: WorkflowStatus[] }>(`/workflows/status${query}`);
}

export function startWorkflow(projectPath: string, taskDescription: string, config?: Record<string, unknown>) {
  return request<{ message: string; projectPath: string; taskDescription: string }>(
    "/workflows",
    {
      method: "POST",
      body: JSON.stringify({ projectPath, taskDescription, config }),
    },
  );
}

export function resumeWorkflow(projectPath: string) {
  return request<{ message: string; projectPath: string }>(
    "/workflows/resume",
    {
      method: "POST",
      body: JSON.stringify({ projectPath }),
    },
  );
}

export function getWorkflowReport() {
  return request<WorkflowReport>("/workflows/report");
}

// ── 설정 API ──

export interface ConfigWithSource {
  value: Record<string, unknown>;
  sources: Record<string, string>;
}

export function getConfig() {
  return request<ConfigWithSource>("/config");
}

export function getConfigValue(key: string) {
  return request<{ value: unknown; source: string }>(`/config/${key}`);
}

export function setConfigValue(key: string, value: unknown) {
  return request<{ key: string; value: unknown; message: string }>(
    `/config/${key}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    },
  );
}

// ── 프로젝트 API ──

export interface ProjectInfo {
  projectPath: string;
  projectName: string;
  hasGit: boolean;
  hasPackageJson: boolean;
}

export interface PrerequisiteCheck {
  tool: string;
  required: boolean;
  found: boolean;
  version?: string;
  path?: string;
}

export function getProjects(basePath?: string) {
  const query = basePath ? `?basePath=${encodeURIComponent(basePath)}` : "";
  return request<{ projects: ProjectInfo[] }>(`/projects${query}`);
}

export function validateProject(projectPath: string) {
  return request<{ valid: boolean; errors: string[]; warnings: string[] }>(
    "/projects/validate",
    {
      method: "POST",
      body: JSON.stringify({ projectPath }),
    },
  );
}

export function getPrerequisites() {
  return request<{ allPassed: boolean; checks: PrerequisiteCheck[] }>(
    "/projects/prerequisites",
  );
}

// ── 헬스체크 ──

export function getHealth() {
  return request<{ status: string; uptime: number }>("/health");
}

// ── Notion 통합 API ──

export interface NotionStatus {
  configured: boolean;
  defaultDatabaseId?: string;
  tokenPreview?: string;
}

export interface NotionTaskSummary {
  pageId: string;
  title: string;
  status?: string;
  assignees: Array<{ id: string; name: string }>;
  projectPath: string;
  referenceUrls: string[];
  url: string;
  lastEditedTime: string;
}

export interface NotionReferencedPage {
  id: string;
  title: string;
  url: string;
  bodyMarkdown: string;
}

export interface NotionTaskDetail extends NotionTaskSummary {
  bodyMarkdown: string;
  referencedPages: NotionReferencedPage[];
}

export function getNotionStatus() {
  return request<NotionStatus>("/integrations/notion/status");
}

export function saveNotionAuth(payload: {
  token: string;
  defaultDatabaseId?: string;
}) {
  return request<{ message: string; notion: NotionStatus }>(
    "/integrations/notion/config",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function clearNotionAuth() {
  return request<{ message: string }>("/integrations/notion/config", {
    method: "DELETE",
  });
}

export function testNotionAuth() {
  return request<{
    ok: boolean;
    bot?: { id: string; name: string; type: string };
    error?: string;
  }>("/integrations/notion/test", { method: "POST" });
}

export function getNotionTasks(params?: {
  db?: string;
  status?: string;
  max?: number;
}) {
  const query = new URLSearchParams();
  if (params?.db) query.set("db", params.db);
  if (params?.status) query.set("status", params.status);
  if (params?.max) query.set("max", String(params.max));
  const qs = query.toString();
  return request<{ tasks: NotionTaskSummary[]; count: number }>(
    `/integrations/notion/tasks${qs ? `?${qs}` : ""}`,
  );
}

export function getNotionTask(pageId: string) {
  return request<NotionTaskDetail>(
    `/integrations/notion/tasks/${encodeURIComponent(pageId)}`,
  );
}

export function startNotionWorkflow(payload: {
  pageId: string;
  projectPath?: string;
  skipClaudeEnhancement?: boolean;
  config?: Record<string, unknown>;
}) {
  return request<{ message: string; pageId: string }>(
    "/integrations/notion/run",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
