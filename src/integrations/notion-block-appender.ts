/**
 * NotionBlockAppender
 *
 * Notion REST API 직접 호출용 경량 어댑터.
 * (기존 NotionClient를 확장하지 않고 별도로 분리한 이유는, 본 컴포넌트 도입 시점에
 *  NotionClient 파일이 수정 금지 상태였기 때문이다. 추후 동일 도메인이므로
 *  리팩터링 단계에서 NotionClient로 흡수해도 좋다.)
 *
 * 제공 기능:
 *   - appendBlocks(pageId, blocks[])
 *       PATCH /v1/blocks/{block_id}/children
 *       100개 단위로 자동 batching.
 *   - addComment(pageId, text)
 *       POST /v1/comments
 *       2000자 이내로 잘라서 안전 전송.
 *   - markdownToBlocks(markdown)
 *       제한된 GitHub-flavored markdown subset을 Notion block 객체 배열로 변환.
 *       지원: # ~ ###### headings, paragraph, fenced code block, bulleted/numbered list, quote, divider, blank line.
 *       2000자 단위로 rich_text segment 분할(Notion 단일 rich_text 길이 한계 회피).
 *   - toggleBlock(title, children[])
 *       자식 블록을 가진 toggle 블록을 생성한다 (한 toggle 안 children 최대 100개).
 *
 * 모든 실패는 throw — 상위 호출자에서 격리(try/catch + warn 로그) 책임.
 */

import type { Logger } from "../components/logger.js";
import type { NotionAuth } from "../types/integrations.js";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_BLOCKS_PER_REQUEST = 100;
const MAX_RICH_TEXT_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 2000;
const MAX_HEADING_LEVEL = 3; // Notion은 heading_1/2/3까지만 지원
const SUPPORTED_CODE_LANGUAGES = new Set([
  "abap", "agda", "arduino", "ascii art", "assembly", "bash", "basic", "bnf", "c", "c#", "c++",
  "clojure", "coffeescript", "coq", "css", "dart", "dhall", "diff", "docker", "ebnf", "elixir",
  "elm", "erlang", "f#", "flow", "fortran", "gherkin", "glsl", "go", "graphql", "groovy",
  "haskell", "hcl", "html", "idris", "java", "javascript", "json", "julia", "kotlin", "latex",
  "less", "lisp", "livescript", "llvm ir", "lua", "makefile", "markdown", "markup", "matlab",
  "mathematica", "mermaid", "nix", "notion formula", "objective-c", "ocaml", "pascal", "perl",
  "php", "plain text", "powershell", "prolog", "protobuf", "purescript", "python", "r",
  "racket", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "smalltalk",
  "solidity", "sql", "swift", "toml", "typescript", "vb.net", "verilog", "vhdl",
  "visual basic", "wasm", "wolfram", "xml", "yaml", "java/c/c++/c#",
]);

// ── Notion 블록 객체 타입 (송신용 최소 형태) ──

export interface NotionRichTextInput {
  type: "text";
  text: { content: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
  };
}

export type NotionBlockInput =
  | ParagraphBlock
  | HeadingBlock
  | BulletedListBlock
  | NumberedListBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | ToggleBlock;

interface ParagraphBlock {
  object: "block";
  type: "paragraph";
  paragraph: { rich_text: NotionRichTextInput[] };
}

interface HeadingBlock {
  object: "block";
  type: "heading_1" | "heading_2" | "heading_3";
  heading_1?: { rich_text: NotionRichTextInput[] };
  heading_2?: { rich_text: NotionRichTextInput[] };
  heading_3?: { rich_text: NotionRichTextInput[] };
}

interface BulletedListBlock {
  object: "block";
  type: "bulleted_list_item";
  bulleted_list_item: { rich_text: NotionRichTextInput[] };
}

interface NumberedListBlock {
  object: "block";
  type: "numbered_list_item";
  numbered_list_item: { rich_text: NotionRichTextInput[] };
}

interface QuoteBlock {
  object: "block";
  type: "quote";
  quote: { rich_text: NotionRichTextInput[] };
}

interface CodeBlock {
  object: "block";
  type: "code";
  code: { rich_text: NotionRichTextInput[]; language: string };
}

interface DividerBlock {
  object: "block";
  type: "divider";
  divider: Record<string, never>;
}

interface ToggleBlock {
  object: "block";
  type: "toggle";
  toggle: {
    rich_text: NotionRichTextInput[];
    children?: NotionBlockInput[];
  };
}

// ── 에러 ──

export class NotionAppenderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "NotionAppenderError";
  }
}

// ── 본체 ──

export class NotionBlockAppender {
  private readonly authHeader: string;

  constructor(
    auth: NotionAuth,
    private readonly logger: Logger,
  ) {
    this.authHeader = `Bearer ${auth.integrationToken}`;
  }

  /**
   * 페이지(또는 블록)에 자식 블록을 100개 단위로 batch append.
   */
  async appendBlocks(pageId: string, blocks: NotionBlockInput[]): Promise<void> {
    if (blocks.length === 0) return;
    const normalizedId = this.normalizeId(pageId);

    for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
      const chunk = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
      await this.request(`/blocks/${normalizedId}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: chunk }),
      });
    }
  }

  /**
   * 페이지에 짧은 코멘트 추가 (2000자 truncate).
   */
  async addComment(pageId: string, text: string): Promise<void> {
    const truncated = text.length > MAX_COMMENT_LENGTH
      ? text.slice(0, MAX_COMMENT_LENGTH - 1) + "\u2026"
      : text;
    await this.request("/comments", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: this.normalizeId(pageId) },
        rich_text: [{ type: "text", text: { content: truncated } }],
      }),
    });
  }

  /**
   * 제한된 markdown subset → Notion 블록 배열로 변환.
   * 변환 규칙은 파일 헤더 docstring 참조.
   */
  markdownToBlocks(markdown: string): NotionBlockInput[] {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const blocks: NotionBlockInput[] = [];

    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i] ?? "";
      const line = rawLine;

      // 빈 줄 → skip (블록 사이 구분)
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Fenced code block: ```lang ... ```
      const fenceMatch = line.match(/^\s*```([a-zA-Z0-9_+\-#./]*)\s*$/);
      if (fenceMatch) {
        const lang = (fenceMatch[1] ?? "").toLowerCase();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length) {
          const inner = lines[i] ?? "";
          if (/^\s*```\s*$/.test(inner)) {
            i++;
            break;
          }
          codeLines.push(inner);
          i++;
        }
        const codeText = codeLines.join("\n");
        const normalizedLang = SUPPORTED_CODE_LANGUAGES.has(lang) ? lang : "plain text";
        blocks.push(this.codeBlock(codeText, normalizedLang));
        continue;
      }

      // Horizontal rule
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push({ object: "block", type: "divider", divider: {} });
        i++;
        continue;
      }

      // Heading (#, ##, ###, ####, #####, ######)
      const headingMatch = line.match(/^\s*(#{1,6})\s+(.*?)\s*$/);
      if (headingMatch) {
        const level = Math.min(headingMatch[1]?.length ?? 1, MAX_HEADING_LEVEL) as 1 | 2 | 3;
        const text = headingMatch[2] ?? "";
        blocks.push(this.headingBlock(level, text));
        i++;
        continue;
      }

      // Blockquote (한 줄만 지원, 연속 줄은 paragraph 안에서 줄바꿈)
      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        const quoteLines: string[] = [quoteMatch[1] ?? ""];
        i++;
        while (i < lines.length) {
          const m = (lines[i] ?? "").match(/^\s*>\s?(.*)$/);
          if (!m) break;
          quoteLines.push(m[1] ?? "");
          i++;
        }
        blocks.push({
          object: "block",
          type: "quote",
          quote: { rich_text: this.toRichText(quoteLines.join("\n")) },
        });
        continue;
      }

      // Unordered list item
      const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bulletMatch) {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: this.toRichText(bulletMatch[1] ?? "") },
        });
        i++;
        continue;
      }

      // Ordered list item
      const numMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (numMatch) {
        blocks.push({
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: { rich_text: this.toRichText(numMatch[1] ?? "") },
        });
        i++;
        continue;
      }

      // Paragraph: 다음 빈 줄/특수 패턴이 나올 때까지 합치기
      const paraLines: string[] = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (
          next.trim() === "" ||
          /^\s*```/.test(next) ||
          /^\s*#{1,6}\s+/.test(next) ||
          /^\s*[-*+]\s+/.test(next) ||
          /^\s*\d+[.)]\s+/.test(next) ||
          /^\s*>\s?/.test(next) ||
          /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(next)
        ) {
          break;
        }
        paraLines.push(next);
        i++;
      }
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: this.toRichText(paraLines.join("\n")) },
      });
    }

    return blocks;
  }

  /**
   * Toggle 블록 생성 (children 최대 100개; 초과분은 호출자가 별도 chunking 필요).
   */
  toggleBlock(title: string, children: NotionBlockInput[]): NotionBlockInput {
    const safeChildren = children.slice(0, MAX_BLOCKS_PER_REQUEST);
    return {
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: this.toRichText(title),
        children: safeChildren.length > 0 ? safeChildren : undefined,
      },
    } as ToggleBlock;
  }

  // ── 내부 빌더 ──

  private headingBlock(level: 1 | 2 | 3, text: string): HeadingBlock {
    if (level === 1) {
      return { object: "block", type: "heading_1", heading_1: { rich_text: this.toRichText(text) } };
    }
    if (level === 2) {
      return { object: "block", type: "heading_2", heading_2: { rich_text: this.toRichText(text) } };
    }
    return { object: "block", type: "heading_3", heading_3: { rich_text: this.toRichText(text) } };
  }

  private codeBlock(content: string, language: string): CodeBlock {
    return {
      object: "block",
      type: "code",
      code: {
        rich_text: this.toRichText(content),
        language,
      },
    };
  }

  /**
   * 임의 길이 텍스트 → Notion rich_text 배열.
   * 단일 segment 2000자 제한을 회피하기 위해 분할.
   */
  private toRichText(text: string): NotionRichTextInput[] {
    if (text.length === 0) {
      return [{ type: "text", text: { content: "" } }];
    }
    const segments: NotionRichTextInput[] = [];
    for (let i = 0; i < text.length; i += MAX_RICH_TEXT_LENGTH) {
      segments.push({
        type: "text",
        text: { content: text.slice(i, i + MAX_RICH_TEXT_LENGTH) },
      });
    }
    return segments;
  }

  // ── 저수준 HTTP ──

  private async request(endpoint: string, init: RequestInit): Promise<unknown> {
    const url = `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) msg = body.message;
      } catch {
        // 무시
      }
      this.logger.warn(`Notion API 호출 실패 (${endpoint}): ${msg}`);
      throw new NotionAppenderError(msg, res.status, endpoint);
    }

    if (res.status === 204) return undefined;
    return res.json();
  }

  private normalizeId(id: string): string {
    const cleaned = id.replace(/-/g, "");
    if (cleaned.length !== 32) return id;
    return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
  }
}
