/**
 * NotionClient - Notion REST API v1 클라이언트
 *
 * 인증: Bearer <Internal Integration Token>
 * 필수 헤더: Notion-Version: 2022-06-28
 *
 * 주요 기능:
 *   - verifyAuth() - 토큰 검증 (현재 봇 사용자 조회)
 *   - queryDatabase() - DB row 목록 (필터 가능)
 *   - getTask() - 단일 row + 본문 markdown + 참조 페이지
 *   - getPage() - 임의 페이지 markdown
 *   - updateStatus() - row의 Status 속성 변경
 *   - addComment() - 페이지에 코멘트 추가
 *
 * 보안: 각 페이지/DB는 Notion UI에서 "Connections → Add"로
 *       명시 연결되어야만 API 접근 가능 (Notion 정책).
 */

import type { Logger } from "../components/logger.js";
import type {
  NotionAuth,
  NotionTaskSummary,
  NotionTaskDetail,
  NotionPage,
  NotionUser,
  NotionPropertyMapping,
} from "../types/integrations.js";
import { DEFAULT_NOTION_PROPERTY_MAPPING } from "../types/integrations.js";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// ── 에러 ──

export class NotionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

interface NotionApiErrorBody {
  message?: string;
  code?: string;
  status?: number;
}

// ── 클라이언트 ──

export class NotionClient {
  private readonly authHeader: string;
  private readonly propertyMapping: Required<NotionPropertyMapping>;

  constructor(
    private readonly auth: NotionAuth,
    private readonly logger: Logger,
    propertyMapping?: NotionPropertyMapping,
  ) {
    this.authHeader = `Bearer ${auth.integrationToken}`;
    this.propertyMapping = {
      ...DEFAULT_NOTION_PROPERTY_MAPPING,
      ...propertyMapping,
    };
  }

  // ── 인증 검증 ──

  async verifyAuth(): Promise<{ id: string; name: string; type: string }> {
    const data = await this.request<{
      bot?: { owner?: unknown };
      id: string;
      name: string;
      type: string;
    }>("/users/me");
    return { id: data.id, name: data.name, type: data.type };
  }

  // ── DB 쿼리 ──

  /**
   * DB row 목록 조회.
   * - assigneeUserId가 주어지면 Assignee 속성으로 필터
   * - status가 주어지면 Status 옵션명으로 필터
   */
  async queryDatabase(
    databaseId: string,
    options?: {
      assigneeUserId?: string;
      status?: string;
      pageSize?: number;
    },
  ): Promise<NotionTaskSummary[]> {
    const filters: Array<Record<string, unknown>> = [];

    if (options?.assigneeUserId) {
      filters.push({
        property: this.propertyMapping.assignee,
        people: { contains: options.assigneeUserId },
      });
    }
    if (options?.status) {
      filters.push({
        property: this.propertyMapping.status,
        status: { equals: options.status },
      });
    }

    const body: Record<string, unknown> = {
      page_size: Math.min(Math.max(options?.pageSize ?? 50, 1), 100),
    };
    if (filters.length === 1) {
      body["filter"] = filters[0];
    } else if (filters.length > 1) {
      body["filter"] = { and: filters };
    }

    const data = await this.request<{
      results: NotionPageObject[];
    }>(`/databases/${this.normalizeId(databaseId)}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return data.results.map((row) => this.parseRowToSummary(row));
  }

  // ── 단일 Task (DB row) 상세 ──

  /**
   * Task 1건 + 본문 markdown + 참조 페이지 본문까지 한번에.
   */
  async getTask(pageId: string): Promise<NotionTaskDetail | null> {
    const id = this.normalizeId(pageId);
    try {
      const row = await this.request<NotionPageObject>(`/pages/${id}`);
      const summary = this.parseRowToSummary(row);

      // 본문 markdown
      const bodyMarkdown = await this.getPageMarkdown(id).catch((err) => {
        this.logger.warn(
          `Notion 본문 조회 실패 (${id}): ${(err as Error).message}`,
        );
        return "";
      });

      // 참조 페이지들 (병렬, 실패는 null로 필터)
      const referencedPages = await this.fetchReferencedPages(summary.referenceUrls);

      return { ...summary, bodyMarkdown, referencedPages };
    } catch (err) {
      if (err instanceof NotionApiError && err.status === 404) {
        this.logger.warn(`Notion 페이지 없음 또는 접근 불가: ${id}`);
        return null;
      }
      throw err;
    }
  }

  /**
   * 임의 페이지(non-DB row 포함) → markdown.
   */
  async getPage(pageId: string): Promise<NotionPage | null> {
    const id = this.normalizeId(pageId);
    try {
      const page = await this.request<NotionPageObject>(`/pages/${id}`);
      const title = this.extractTitle(page);
      const bodyMarkdown = await this.getPageMarkdown(id);
      return {
        id: page.id,
        title,
        url: page.url ?? "",
        bodyMarkdown,
        lastEditedTime: page.last_edited_time ?? "",
      };
    } catch (err) {
      if (err instanceof NotionApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  // ── 상태 조회 ──

  /**
   * DB row 의 현재 Status 옵션명을 조회한다.
   * 페이지가 없거나 Status 속성이 없으면 빈 문자열 반환.
   * propertyMapping.status 키 사용 (사용자 정의 속성명 지원).
   */
  async getStatus(pageId: string): Promise<string> {
    const id = this.normalizeId(pageId);
    try {
      const page = await this.request<NotionPageObject>(`/pages/${id}`);
      return this.extractStatus(page);
    } catch (err) {
      if (err instanceof NotionApiError && err.status === 404) {
        return "";
      }
      throw err;
    }
  }

  // ── 상태 업데이트 ──

  /**
   * DB row의 Status 옵션 변경.
   * status 옵션명이 DB에 존재해야 함 (없으면 Notion이 400 반환).
   */
  async updateStatus(pageId: string, statusName: string): Promise<void> {
    await this.request(`/pages/${this.normalizeId(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [this.propertyMapping.status]: {
            status: { name: statusName },
          },
        },
      }),
    });
  }

  /**
   * 페이지에 코멘트 추가 (PR URL, 완료 메시지 등).
   */
  async addComment(pageId: string, text: string): Promise<void> {
    await this.request(`/comments`, {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: this.normalizeId(pageId) },
        rich_text: [{ type: "text", text: { content: text } }],
      }),
    });
  }

  // ── 내부 헬퍼: 페이지 블록 → markdown ──

  /**
   * 페이지의 자식 블록들을 markdown으로 변환.
   * 중첩 블록은 1단계까지 inline 확장 (그 이상은 텍스트만).
   */
  private async getPageMarkdown(pageId: string, depth = 0): Promise<string> {
    if (depth > 3) return ""; // 무한 재귀 방지
    const blocks = await this.fetchAllChildren(pageId);
    return this.blocksToMarkdown(blocks, depth);
  }

  private async fetchAllChildren(blockId: string): Promise<NotionBlock[]> {
    const all: NotionBlock[] = [];
    let cursor: string | undefined;
    let safety = 0;
    do {
      if (safety++ > 50) break; // 페이지당 5000블록 한계
      const qs = cursor
        ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100`
        : "?page_size=100";
      const res = await this.request<{
        results: NotionBlock[];
        has_more: boolean;
        next_cursor: string | null;
      }>(`/blocks/${this.normalizeId(blockId)}/children${qs}`);
      all.push(...res.results);
      cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
    } while (cursor);
    return all;
  }

  private async blocksToMarkdown(
    blocks: NotionBlock[],
    depth: number,
  ): Promise<string> {
    const lines: string[] = [];

    for (const block of blocks) {
      const md = await this.blockToMarkdown(block, depth);
      if (md !== null) lines.push(md);
    }

    return lines.join("\n").trim();
  }

  private async blockToMarkdown(
    block: NotionBlock,
    depth: number,
  ): Promise<string | null> {
    const t = block.type;
    const indent = "  ".repeat(Math.max(0, depth));

    switch (t) {
      case "paragraph":
        return `${indent}${this.richText(block.paragraph?.rich_text)}`;
      case "heading_1":
        return `\n# ${this.richText(block.heading_1?.rich_text)}\n`;
      case "heading_2":
        return `\n## ${this.richText(block.heading_2?.rich_text)}\n`;
      case "heading_3":
        return `\n### ${this.richText(block.heading_3?.rich_text)}\n`;
      case "bulleted_list_item":
        return `${indent}- ${this.richText(block.bulleted_list_item?.rich_text)}`;
      case "numbered_list_item":
        return `${indent}1. ${this.richText(block.numbered_list_item?.rich_text)}`;
      case "to_do": {
        const done = block.to_do?.checked ? "x" : " ";
        return `${indent}- [${done}] ${this.richText(block.to_do?.rich_text)}`;
      }
      case "quote":
        return `${indent}> ${this.richText(block.quote?.rich_text)}`;
      case "code": {
        const lang = block.code?.language ?? "";
        const code = this.richText(block.code?.rich_text);
        return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
      }
      case "divider":
        return `\n---\n`;
      case "callout":
        return `${indent}> 💡 ${this.richText(block.callout?.rich_text)}`;
      case "toggle":
        return `${indent}- ${this.richText(block.toggle?.rich_text)}`;
      case "bookmark":
      case "embed":
      case "link_preview": {
        const url =
          block.bookmark?.url ?? block.embed?.url ?? block.link_preview?.url;
        return url ? `${indent}[${url}](${url})` : null;
      }
      case "child_page":
        return `${indent}📄 ${block.child_page?.title ?? "(child page)"}`;
      case "child_database":
        return `${indent}🗂 ${block.child_database?.title ?? "(child database)"}`;
      default:
        return null;
    }
  }

  private richText(arr?: NotionRichText[]): string {
    if (!arr || arr.length === 0) return "";
    return arr
      .map((r) => {
        let text = r.plain_text ?? r.text?.content ?? "";
        const a = r.annotations;
        if (a?.code) text = `\`${text}\``;
        if (a?.bold) text = `**${text}**`;
        if (a?.italic) text = `*${text}*`;
        if (a?.strikethrough) text = `~~${text}~~`;
        if (r.href) text = `[${text}](${r.href})`;
        return text;
      })
      .join("");
  }

  // ── 내부 헬퍼: row 파싱 ──

  private parseRowToSummary(row: NotionPageObject): NotionTaskSummary {
    const title = this.extractTitle(row);
    const status = this.extractStatus(row);
    const assignees = this.extractAssignees(row);
    const projectPath = this.extractProjectPath(row);
    const referenceUrls = this.extractReferenceUrls(row);

    return {
      pageId: row.id,
      url: row.url ?? "",
      title,
      status,
      assignees,
      projectPath,
      referenceUrls,
      lastEditedTime: row.last_edited_time ?? "",
    };
  }

  private extractTitle(row: NotionPageObject): string {
    const propName = this.propertyMapping.title;
    const prop = row.properties?.[propName];
    if (prop?.type === "title") {
      return this.richText(prop.title);
    }
    // fallback: 첫 title 타입 속성
    for (const p of Object.values(row.properties ?? {})) {
      if (p?.type === "title") return this.richText(p.title);
    }
    return "(제목 없음)";
  }

  private extractStatus(row: NotionPageObject): string {
    const propName = this.propertyMapping.status;
    const prop = row.properties?.[propName];
    if (prop?.type === "status") return prop.status?.name ?? "";
    if (prop?.type === "select") return prop.select?.name ?? "";
    return "";
  }

  private extractAssignees(row: NotionPageObject): NotionUser[] {
    const propName = this.propertyMapping.assignee;
    const prop = row.properties?.[propName];
    if (prop?.type !== "people" || !prop.people) return [];
    return prop.people.map((u) => ({
      id: u.id,
      name: u.name ?? "(unknown)",
      ...(u.person?.email && { email: u.person.email }),
    }));
  }

  private extractProjectPath(row: NotionPageObject): string {
    const propName = this.propertyMapping.projectPath;
    const prop = row.properties?.[propName];
    if (!prop) return "";
    if (prop.type === "rich_text") return this.richText(prop.rich_text).trim();
    if (prop.type === "url") return prop.url ?? "";
    if (prop.type === "title") return this.richText(prop.title);
    return "";
  }

  private extractReferenceUrls(row: NotionPageObject): string[] {
    const propName = this.propertyMapping.references;
    const prop = row.properties?.[propName];
    if (!prop) return [];
    if (prop.type === "url" && prop.url) return [prop.url];
    if (prop.type === "rich_text") {
      const text = this.richText(prop.rich_text);
      return this.extractUrls(text);
    }
    if (prop.type === "relation" && prop.relation) {
      // relation은 페이지 ID들 → URL 형태로 변환해서 후속 fetch 단계에서 처리
      return prop.relation.map((r) => `notion://page/${r.id}`);
    }
    return [];
  }

  private extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)]+/g);
    return matches ? Array.from(new Set(matches)) : [];
  }

  // ── 참조 페이지 fetch ──

  private async fetchReferencedPages(urls: string[]): Promise<NotionPage[]> {
    if (urls.length === 0) return [];

    const ids = urls
      .map((u) => this.urlToPageId(u))
      .filter((id): id is string => id !== null);

    if (ids.length === 0) return [];

    const results = await Promise.all(
      ids.map((id) =>
        this.getPage(id).catch((err) => {
          this.logger.warn(
            `참조 페이지 fetch 실패 (${id}): ${(err as Error).message}`,
          );
          return null;
        }),
      ),
    );
    return results.filter((p): p is NotionPage => p !== null);
  }

  /**
   * Notion URL → page ID.
   * 지원 형식:
   *   https://www.notion.so/workspace/Title-{32hex}
   *   https://notion.so/{32hex}
   *   https://www.notion.so/{32hex}
   *   notion://page/{uuid}
   */
  private urlToPageId(url: string): string | null {
    // 내부 protocol (relation에서 변환된 것)
    if (url.startsWith("notion://page/")) {
      return url.slice("notion://page/".length);
    }
    if (!url.includes("notion.so") && !url.includes("notion.site")) {
      return null;
    }
    // 마지막 path 세그먼트에서 32자 hex 추출
    const match = url.match(/([0-9a-f]{32})/i);
    if (match && match[1]) return this.normalizeId(match[1]);
    // 하이픈 포함 UUID
    const uuidMatch = url.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    if (uuidMatch && uuidMatch[1]) return uuidMatch[1];
    return null;
  }

  /**
   * UUID 정규화: 32자 hex → 8-4-4-4-12 형태.
   * 이미 정규화된 경우 그대로 반환.
   */
  private normalizeId(id: string): string {
    const cleaned = id.replace(/-/g, "");
    if (cleaned.length !== 32) return id;
    return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
  }

  // ── 저수준 HTTP ──

  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let code: string | undefined;
      try {
        const body = (await res.json()) as NotionApiErrorBody;
        if (body.message) msg = body.message;
        if (body.code) code = body.code;
      } catch {
        // 무시
      }
      throw new NotionApiError(msg, res.status, endpoint, code);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
}

// ── Notion API 응답 타입 (내부) ──

interface NotionPageObject {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
}

interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  status?: { name: string } | null;
  select?: { name: string } | null;
  people?: Array<{
    id: string;
    name?: string;
    person?: { email?: string };
  }>;
  url?: string | null;
  relation?: Array<{ id: string }>;
}

interface NotionRichText {
  plain_text?: string;
  text?: { content: string };
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  paragraph?: { rich_text: NotionRichText[] };
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
  bulleted_list_item?: { rich_text: NotionRichText[] };
  numbered_list_item?: { rich_text: NotionRichText[] };
  to_do?: { rich_text: NotionRichText[]; checked: boolean };
  quote?: { rich_text: NotionRichText[] };
  code?: { rich_text: NotionRichText[]; language: string };
  callout?: { rich_text: NotionRichText[] };
  toggle?: { rich_text: NotionRichText[] };
  bookmark?: { url: string };
  embed?: { url: string };
  link_preview?: { url: string };
  child_page?: { title: string };
  child_database?: { title: string };
}
