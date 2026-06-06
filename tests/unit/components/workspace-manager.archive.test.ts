/**
 * WorkspaceManager.archiveExisting 옵션 단위 테스트 (WM-ARCHIVE-01)
 *
 * 검증 항목:
 *   - archiveExisting=true & current/ 존재 → archive/<workflowId>-<ts>/ 로 이동
 *   - archiveExisting=true & current/ 없음 → no-op (mkdir 만 호출)
 *   - archiveExisting=false (또는 옵션 미지정) → archive 미실행
 *   - state.json 없거나 workflowId 파싱 실패 → "unknown" fallback
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceManager } from "../../../src/components/workspace-manager.js";
import type { Logger } from "../../../src/components/logger.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  realpath: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
}));

import * as fs from "node:fs/promises";

const mockMkdir = vi.mocked(fs.mkdir);
const mockAccess = vi.mocked(fs.access);
const mockReadFile = vi.mocked(fs.readFile);
const mockRename = vi.mocked(fs.rename);

function createMockLogger(): Logger {
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

describe("WorkspaceManager.initWorkflowDirs (archiveExisting)", () => {
  let manager: WorkspaceManager;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    manager = new WorkspaceManager(logger);
  });

  it("archiveExisting=true & current/ 존재 → archive/<workflowId>-<ts>/ 로 rename 호출", async () => {
    // current/ 존재
    mockAccess.mockResolvedValueOnce(undefined);
    // state.json 읽기 성공
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ workflowId: "wf-abc-123" }),
    );

    await manager.initWorkflowDirs("/proj", { archiveExisting: true });

    expect(mockRename).toHaveBeenCalledOnce();
    const [from, to] = mockRename.mock.calls[0]!;
    expect(String(from)).toContain(".ai-workflow/current");
    expect(String(to)).toContain(".ai-workflow/archive");
    expect(String(to)).toContain("wf-abc-123-");
  });

  it("archiveExisting=true & current/ 없음 → rename 호출 안 함", async () => {
    mockAccess.mockRejectedValueOnce(new Error("ENOENT"));

    await manager.initWorkflowDirs("/proj", { archiveExisting: true });

    expect(mockRename).not.toHaveBeenCalled();
    // 기본 디렉토리 mkdir 은 계속 호출되어야 함
    expect(mockMkdir).toHaveBeenCalled();
  });

  it("옵션 미지정 시 archive 미실행", async () => {
    await manager.initWorkflowDirs("/proj");
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("archiveExisting=false → archive 미실행", async () => {
    await manager.initWorkflowDirs("/proj", { archiveExisting: false });
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("state.json 없음 → workflowId='unknown' 으로 fallback", async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await manager.initWorkflowDirs("/proj", { archiveExisting: true });

    expect(mockRename).toHaveBeenCalledOnce();
    const [, to] = mockRename.mock.calls[0]!;
    expect(String(to)).toContain("unknown-");
  });

  it("state.json 파싱 실패 → workflowId='unknown' 으로 fallback", async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce("{ invalid json");

    await manager.initWorkflowDirs("/proj", { archiveExisting: true });

    expect(mockRename).toHaveBeenCalledOnce();
    const [, to] = mockRename.mock.calls[0]!;
    expect(String(to)).toContain("unknown-");
  });

  it("workflowId 가 빈 문자열이면 'unknown' fallback", async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ workflowId: "   " }));

    await manager.initWorkflowDirs("/proj", { archiveExisting: true });

    const [, to] = mockRename.mock.calls[0]!;
    expect(String(to)).toContain("unknown-");
  });
});
