/**
 * NotionStatusSync 단위 테스트 — fetchCurrentStatus / setStatusDirect
 *
 * 검증 항목:
 *   - fetchCurrentStatus 는 NotionClient.getStatus 위임
 *   - setStatusDirect 성공 → info 로그
 *   - setStatusDirect 실패 → throw 하지 않고 warn 로그만 (워크플로우 비차단 원칙)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { NotionStatusSync } from "../../../src/integrations/notion-status-sync.js";
import type { NotionClient } from "../../../src/integrations/notion-client.js";
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

describe("NotionStatusSync — direct status API", () => {
  let notion: NotionClient;
  let logger: Logger;
  let sync: NotionStatusSync;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
    notion = {
      getStatus: vi.fn().mockResolvedValue("Plan Review"),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      addComment: vi.fn(),
    } as unknown as NotionClient;
    sync = new NotionStatusSync(notion, new EventEmitter(), logger);
  });

  it("fetchCurrentStatus 는 NotionClient.getStatus 결과를 그대로 반환", async () => {
    const status = await sync.fetchCurrentStatus("page-1");
    expect(status).toBe("Plan Review");
    expect(notion.getStatus).toHaveBeenCalledWith("page-1");
  });

  it("setStatusDirect 성공 → info 로그", async () => {
    await sync.setStatusDirect("page-1", "Approved");
    expect(notion.updateStatus).toHaveBeenCalledWith("page-1", "Approved");
    expect(logger.info).toHaveBeenCalled();
  });

  it("setStatusDirect 실패 → throw 하지 않고 warn 로그만", async () => {
    (notion.updateStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("rate limited"),
    );

    await expect(
      sync.setStatusDirect("page-1", "Approved"),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
