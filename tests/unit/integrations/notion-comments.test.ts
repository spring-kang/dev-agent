/**
 * NotionClient.getComments + NotionBlockAppender.deleteAllBlocks/replaceBlocks 단위 테스트
 *
 * 검증 항목:
 *   - getComments 는 GET /v1/comments?block_id= 호출 + 필드 파싱 + 페이지네이션
 *   - getComments 는 rich_text 를 markdown inline 으로 합침
 *   - deleteAllBlocks 는 children 조회 후 각 블록을 DELETE
 *   - replaceBlocks 는 (삭제 → append) 순서로 호출하고 삭제 수 반환
 *
 * global.fetch 를 vi 로 모킹한다 (실제 네트워크 호출 없음).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotionClient } from "../../../src/integrations/notion-client.js";
import { NotionBlockAppender } from "../../../src/integrations/notion-block-appender.js";
import type { Logger } from "../../../src/components/logger.js";

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setPhase: vi.fn(),
    setCycleNumber: vi.fn(),
    setWorkflowId: vi.fn(),
    createChildLogger: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const AUTH = { integrationToken: "ntn_test_token" };
const PAGE = "383e8963-3f9d-8101-a03d-ce4b95af8a30";

describe("NotionClient.getComments", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /comments 를 block_id 쿼리와 함께 호출하고 필드를 파싱한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: "c1",
            discussion_id: "d1",
            created_time: "2026-06-18T05:22:00.000Z",
            created_by: { id: "user-1" },
            rich_text: [{ plain_text: "findByStatus 추가" }],
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    const client = new NotionClient(AUTH, createLogger());
    const comments = await client.getComments(PAGE);

    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({
      id: "c1",
      discussionId: "d1",
      createdById: "user-1",
      createdTime: "2026-06-18T05:22:00.000Z",
      text: "findByStatus 추가",
    });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/comments?block_id=");
  });

  it("rich_text 의 여러 조각을 합치고 annotation(code) 을 markdown 으로 변환한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: "c1",
            discussion_id: "d1",
            created_time: "2026-06-18T05:22:00.000Z",
            created_by: { id: "user-1" },
            rich_text: [
              { plain_text: "메서드 " },
              { plain_text: "findByStatus", annotations: { code: true } },
              { plain_text: " 추가" },
            ],
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    const client = new NotionClient(AUTH, createLogger());
    const comments = await client.getComments(PAGE);
    expect(comments[0]?.text).toBe("메서드 `findByStatus` 추가");
  });

  it("has_more=true 면 next_cursor 로 페이지네이션한다", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "c1", rich_text: [{ plain_text: "첫번째" }] }],
          has_more: true,
          next_cursor: "CURSOR_2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "c2", rich_text: [{ plain_text: "두번째" }] }],
          has_more: false,
          next_cursor: null,
        }),
      );

    const client = new NotionClient(AUTH, createLogger());
    const comments = await client.getComments(PAGE);

    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("start_cursor=CURSOR_2");
  });

  it("댓글이 없으면 빈 배열을 반환한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );
    const client = new NotionClient(AUTH, createLogger());
    expect(await client.getComments(PAGE)).toEqual([]);
  });
});

describe("NotionBlockAppender.deleteAllBlocks / replaceBlocks", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deleteAllBlocks 는 children 조회 후 각 블록을 DELETE 하고 삭제 수를 반환한다", async () => {
    // 1) GET children
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
        has_more: false,
        next_cursor: null,
      }),
    );
    // 2~4) DELETE 각 블록
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "b1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "b2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "b3" }));

    const appender = new NotionBlockAppender(AUTH, createLogger());
    const deleted = await appender.deleteAllBlocks(PAGE);

    expect(deleted).toBe(3);
    // 첫 호출은 GET children, 이후 3건은 DELETE
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const deleteCalls = fetchMock.mock.calls.slice(1);
    for (const call of deleteCalls) {
      expect((call[1] as RequestInit).method).toBe("DELETE");
    }
  });

  it("replaceBlocks 는 먼저 기존 블록을 삭제한 뒤 새 블록을 PATCH(append)한다", async () => {
    // GET children (기존 2개)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [{ id: "old1" }, { id: "old2" }],
        has_more: false,
        next_cursor: null,
      }),
    );
    // DELETE x2
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "old1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "old2" }));
    // PATCH children (append)
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));

    const appender = new NotionBlockAppender(AUTH, createLogger());
    const blocks = appender.markdownToBlocks("# 새 제목\n\n새 본문 문단");
    const deleted = await appender.replaceBlocks(PAGE, blocks);

    expect(deleted).toBe(2);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method);
    // 순서: GET, DELETE, DELETE, PATCH
    expect(methods).toEqual(["GET", "DELETE", "DELETE", "PATCH"]);
  });

  it("빈 페이지에서 replaceBlocks 는 삭제 0건 후 append 만 한다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));

    const appender = new NotionBlockAppender(AUTH, createLogger());
    const blocks = appender.markdownToBlocks("문단 하나");
    const deleted = await appender.replaceBlocks(PAGE, blocks);

    expect(deleted).toBe(0);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["GET", "PATCH"]);
  });
});
