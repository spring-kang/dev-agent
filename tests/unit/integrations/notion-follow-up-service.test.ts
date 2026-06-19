/**
 * NotionFollowUpService 단위 테스트
 *
 * 검증 항목:
 *  - shouldCreateFollowUp / lastReviewOf 순수 판정 로직
 *  - buildFollowUpMarkdown 본문 구성
 *  - createFollowUpIfNeeded: 트리거 충족 시 createPage(부모 DB + To Do + Project Path)
 *    → 본문 append → 원본 링크백 코멘트
 *  - 트리거 미충족 / opt-out / 부모 DB 미확인 / 생성 오류 시 비차단(created:false)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotionFollowUpService,
  shouldCreateFollowUp,
  lastReviewOf,
  buildFollowUpMarkdown,
  FOLLOW_UP_STATUS,
  FOLLOW_UP_TITLE_PREFIX,
} from "../../../src/integrations/notion-follow-up-service.js";
import type { NotionClient } from "../../../src/integrations/notion-client.js";
import type { NotionBlockAppender } from "../../../src/integrations/notion-block-appender.js";
import type { Logger } from "../../../src/components/logger.js";
import type { WorkflowResult } from "../../../src/types/workflow.js";
import type { ReviewResult } from "../../../src/types/review.js";

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

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: "CHANGES_REQUESTED",
    checks: [
      { name: "build", passed: true, details: "ok" },
      { name: "tests", passed: false, details: "1건 실패" },
    ],
    findings: [
      {
        severity: "major",
        location: "src/foo.ts:10",
        description: "널 체크 누락",
        suggestion: "옵셔널 체이닝 사용",
      },
    ],
    summary: "테스트 실패",
    ...overrides,
  };
}

function result(overrides: Partial<WorkflowResult> = {}): WorkflowResult {
  return {
    status: "completed",
    totalCycles: 10,
    reviewHistory: [review()],
    duration: 1000,
    workflowId: "wf-1",
    branchName: "feature/x",
    ...overrides,
  };
}

describe("shouldCreateFollowUp / lastReviewOf", () => {
  it("completed + 마지막 CHANGES_REQUESTED + finding 존재 → true", () => {
    expect(shouldCreateFollowUp(result())).toBe(true);
  });

  it("enabled=false(opt-out) → false", () => {
    expect(shouldCreateFollowUp(result(), false)).toBe(false);
  });

  it("status=stopped(사용자 중단) → false", () => {
    expect(shouldCreateFollowUp(result({ status: "stopped" }))).toBe(false);
  });

  it("status=failed → false", () => {
    expect(shouldCreateFollowUp(result({ status: "failed" }))).toBe(false);
  });

  it("마지막 리뷰가 APPROVED → false", () => {
    expect(
      shouldCreateFollowUp(result({ reviewHistory: [review({ status: "APPROVED" })] })),
    ).toBe(false);
  });

  it("finding 0건 → false", () => {
    expect(
      shouldCreateFollowUp(result({ reviewHistory: [review({ findings: [] })] })),
    ).toBe(false);
  });

  it("reviewHistory 비어있음 → false, lastReviewOf undefined", () => {
    const r = result({ reviewHistory: [] });
    expect(lastReviewOf(r)).toBeUndefined();
    expect(shouldCreateFollowUp(r)).toBe(false);
  });

  it("lastReviewOf 는 마지막 항목 반환", () => {
    const first = review({ summary: "first" });
    const last = review({ summary: "last" });
    expect(lastReviewOf(result({ reviewHistory: [first, last] }))).toBe(last);
  });
});

describe("buildFollowUpMarkdown", () => {
  it("미해결 지적사항/실패 검증/요약을 포함", () => {
    const md = buildFollowUpMarkdown({
      taskTitle: "로그인 기능",
      result: result(),
      review: review(),
    });
    expect(md).toContain("후속 작업");
    expect(md).toContain("로그인 기능");
    expect(md).toContain("미해결 지적사항 (1건)");
    expect(md).toContain("src/foo.ts:10");
    expect(md).toContain("옵셔널 체이닝 사용");
    expect(md).toContain("tests: 1건 실패"); // 실패한 체크
    expect(md).not.toContain("build: ok"); // 통과 체크는 제외
    expect(md).toContain("테스트 실패"); // 요약
  });
});

describe("NotionFollowUpService.createFollowUpIfNeeded", () => {
  let notion: NotionClient;
  let appender: NotionBlockAppender;
  let logger: Logger;
  let service: NotionFollowUpService;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
    notion = {
      getParentDatabaseId: vi.fn().mockResolvedValue("db-123"),
      createPage: vi.fn().mockResolvedValue({ id: "new-page-1", url: "https://notion.so/new" }),
      addComment: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotionClient;
    appender = {
      markdownToBlocks: vi.fn().mockReturnValue([{ type: "paragraph" }]),
      appendBlocks: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotionBlockAppender;
    service = new NotionFollowUpService(notion, appender, logger);
  });

  it("트리거 충족 시 To Do + Project Path 로 createPage, 본문 append, 링크백 코멘트", async () => {
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "로그인 기능",
      projectPath: "/repo/app",
      result: result(),
    });

    expect(out.created).toBe(true);
    expect(out.pageId).toBe("new-page-1");
    expect(notion.createPage).toHaveBeenCalledWith({
      databaseId: "db-123",
      title: `${FOLLOW_UP_TITLE_PREFIX}로그인 기능`,
      status: FOLLOW_UP_STATUS,
      projectPath: "/repo/app",
    });
    expect(appender.appendBlocks).toHaveBeenCalledWith("new-page-1", [{ type: "paragraph" }]);
    expect(notion.addComment).toHaveBeenCalledWith(
      "src-page",
      expect.stringContaining("https://notion.so/new"),
    );
  });

  it("databaseId 명시 시 getParentDatabaseId 를 호출하지 않음", async () => {
    await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result(),
      databaseId: "db-explicit",
    });
    expect(notion.getParentDatabaseId).not.toHaveBeenCalled();
    expect(notion.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: "db-explicit" }),
    );
  });

  it("트리거 미충족(APPROVED) → 생성하지 않음", async () => {
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result({ reviewHistory: [review({ status: "APPROVED" })] }),
    });
    expect(out.created).toBe(false);
    expect(notion.createPage).not.toHaveBeenCalled();
  });

  it("enabled=false → 생성하지 않음", async () => {
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result(),
      enabled: false,
    });
    expect(out.created).toBe(false);
    expect(out.skippedReason).toContain("비활성화");
    expect(notion.createPage).not.toHaveBeenCalled();
  });

  it("부모 DB 미확인 → 생성하지 않고 warn", async () => {
    (notion.getParentDatabaseId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result(),
    });
    expect(out.created).toBe(false);
    expect(out.skippedReason).toContain("부모 DB");
    expect(notion.createPage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("createPage 실패 → throw 하지 않고 created:false + warn", async () => {
    (notion.createPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("400 bad"));
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result(),
    });
    expect(out.created).toBe(false);
    expect(out.skippedReason).toContain("생성 오류");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("본문 append 실패해도 티켓 생성은 성공으로 간주(비차단)", async () => {
    (appender.appendBlocks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("append fail"));
    const out = await service.createFollowUpIfNeeded({
      sourcePageId: "src-page",
      taskTitle: "T",
      result: result(),
    });
    expect(out.created).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
