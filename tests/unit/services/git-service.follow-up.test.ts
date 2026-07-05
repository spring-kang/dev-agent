/**
 * GitService.initWorkflow 후속 작업(stacked PR) 단위 테스트
 *
 * 검증 대상:
 *  - task 본문에 원본 PR URL 이 있고 그 PR 이 OPEN 이면:
 *      · 원본 PR head 브랜치에서 새 작업 브랜치를 분기(createBranchFromRemote)
 *      · baseBranchOverride = 원본 head 브랜치 (PR base 를 main 대신 원본 브랜치로)
 *      · syncBaseBranch/createBranch(일반 경로)는 호출하지 않음
 *  - 원본 PR 이 OPEN 이 아니면 일반 경로(main 기반 새 브랜치)로 폴백
 *  - 본문에 PR URL 이 없으면 일반 경로
 *
 * GitManager 는 모킹한다(실제 git/gh 실행 없음).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitService } from "../../../src/services/git.service.js";
import type { GitManager } from "../../../src/components/git-manager.js";
import type { Logger } from "../../../src/components/logger.js";
import type { PullRequestInfo } from "../../../src/types/git.js";

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

function createGitManager(overrides: Partial<GitManager> = {}): GitManager {
  return {
    checkDirtyState: vi.fn().mockResolvedValue({
      isDirty: false,
      untrackedFiles: [],
      modifiedFiles: [],
    }),
    getPullRequestInfo: vi.fn().mockResolvedValue(null),
    createBranchFromRemote: vi.fn().mockResolvedValue("ai/20260705-followup"),
    syncBaseBranch: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue("ai/20260705-normal"),
    checkoutRemoteBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GitManager;
}

const OPEN_PR: PullRequestInfo = {
  url: "https://github.com/org/repo/pull/123",
  state: "OPEN",
  headRefName: "ai/20260701-feature-x",
  baseRefName: "main",
};

const FOLLOW_UP_DESC =
  "[후속] 기능 X\n\n### 빌드 요약\n- 생성된 PR: https://github.com/org/repo/pull/123\n- 브랜치: ai/20260701-feature-x";

describe("GitService.initWorkflow - 후속 작업 stacked PR", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger();
  });

  it("원본 PR 이 OPEN 이면 원본 head 브랜치에서 분기하고 base 를 원본 브랜치로 오버라이드한다", async () => {
    const gitManager = createGitManager({
      getPullRequestInfo: vi.fn().mockResolvedValue(OPEN_PR),
      createBranchFromRemote: vi.fn().mockResolvedValue("ai/20260705-followup"),
    });
    const service = new GitService(gitManager, logger);

    const result = await service.initWorkflow(
      "/proj",
      FOLLOW_UP_DESC,
      "ai",
      "main",
    );

    expect(result.branchName).toBe("ai/20260705-followup");
    expect(result.baseBranchOverride).toBe("ai/20260701-feature-x");
    expect(result.continuedFromPrUrl).toBe(OPEN_PR.url);

    // 원본 head 브랜치 위에서 분기해야 한다.
    expect(gitManager.createBranchFromRemote).toHaveBeenCalledWith(
      "/proj",
      FOLLOW_UP_DESC,
      "ai",
      "ai/20260701-feature-x",
    );
    // 일반(main 기반) 경로는 타지 않는다.
    expect(gitManager.syncBaseBranch).not.toHaveBeenCalled();
    expect(gitManager.createBranch).not.toHaveBeenCalled();
  });

  it("원본 PR 이 OPEN 이 아니면 일반 경로(main 기반)로 폴백한다", async () => {
    const gitManager = createGitManager({
      getPullRequestInfo: vi
        .fn()
        .mockResolvedValue({ ...OPEN_PR, state: "MERGED" }),
    });
    const service = new GitService(gitManager, logger);

    const result = await service.initWorkflow(
      "/proj",
      FOLLOW_UP_DESC,
      "ai",
      "main",
    );

    expect(result.baseBranchOverride).toBeUndefined();
    expect(result.branchName).toBe("ai/20260705-normal");
    expect(gitManager.createBranchFromRemote).not.toHaveBeenCalled();
    expect(gitManager.syncBaseBranch).toHaveBeenCalledWith("/proj", "main");
    expect(gitManager.createBranch).toHaveBeenCalled();
  });

  it("본문에 원본 PR URL 이 없으면 PR 조회 없이 일반 경로로 진행한다", async () => {
    const gitManager = createGitManager();
    const service = new GitService(gitManager, logger);

    const result = await service.initWorkflow(
      "/proj",
      "일반 작업 티켓\n\n본문에 PR 링크 없음",
      "ai",
      "main",
    );

    expect(result.baseBranchOverride).toBeUndefined();
    expect(gitManager.getPullRequestInfo).not.toHaveBeenCalled();
    expect(gitManager.createBranchFromRemote).not.toHaveBeenCalled();
    expect(gitManager.syncBaseBranch).toHaveBeenCalledWith("/proj", "main");
  });
});
