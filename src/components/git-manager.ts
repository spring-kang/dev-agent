/**
 * GitManager (C-10) - Git/GitHub CLI 명령 실행
 * NFR: Safe Spawn, 타임아웃, 빈 커밋 방지, 브랜치 확인
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrRequest, DirtyStateInfo, ExecResult } from "../types/git.js";
import {
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
  FALLBACK_SLUG,
  SLUG_PATTERN,
  GIT_COMMAND_TIMEOUT,
  GIT_NETWORK_TIMEOUT,
  COMMIT_PREFIX,
  DEFAULT_COMMIT_MESSAGE,
  REWORK_COMMIT_MESSAGE,
} from "../types/git.js";
import { GitError, GitTimeoutError, GitPushError, GitPrError, GitSyncError } from "../types/errors.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export class GitManager {
  constructor(private readonly logger: Logger) {}

  /**
   * base 브랜치를 origin과 동기화한다 (브랜치 생성 직전 호출).
   *
   * 순서:
   *   1. git fetch origin <base>
   *   2. git checkout <base>
   *   3. git pull --ff-only origin <base>
   *
   * - origin remote가 없으면(로컬 전용 저장소) 동기화를 스킵한다.
   * - 각 단계 실패 시 GitSyncError로 감싸 실제 stderr와 함께 명확한 원인을 노출한다.
   *   (예: 잘못된 base 브랜치명, 원격 접근 권한, 미커밋 변경으로 인한 checkout 실패,
   *    ff-only 불가(로컬이 origin보다 앞섬/분기) 등)
   */
  async syncBaseBranch(projectPath: string, baseBranch: string): Promise<void> {
    // linked worktree(배치 빌드)인 경우, base 브랜치는 메인 워크트리에 이미
    // 체크아웃되어 있어 `git checkout <base>` 가 충돌(already checked out)한다.
    // 배치 흐름이 worktree 생성 시점에 base ref(origin/<base>)에 detached 로
    // 고정하므로 여기서는 동기화를 스킵한다. createBranch 가 현재 HEAD(=base ref)
    // 에서 분기한다.
    if (await this.isLinkedWorktree(projectPath)) {
      this.logger.info(
        `linked worktree 감지: base 브랜치(${baseBranch}) 동기화 스킵 ` +
          `(worktree는 생성 시 base ref에 고정됨)`,
      );
      return;
    }

    // origin이 없으면 동기화할 대상이 없으므로 스킵 (로컬 검증용 임시 저장소 등)
    const hasRemote = await this.hasRemote(projectPath);
    if (!hasRemote) {
      this.logger.info(
        `원격(origin)이 설정되어 있지 않아 base 브랜치(${baseBranch}) 동기화를 건너뜁니다`,
      );
      return;
    }

    try {
      // 1. 최신 origin/<base> 가져오기
      await this.execGit(projectPath, ["fetch", "origin", baseBranch], GIT_NETWORK_TIMEOUT);
      // 2. base 브랜치로 전환
      await this.execGit(projectPath, ["checkout", baseBranch]);
      // 3. fast-forward로만 갱신 (불가 시 명확히 실패)
      await this.execGit(
        projectPath,
        ["pull", "--ff-only", "origin", baseBranch],
        GIT_NETWORK_TIMEOUT,
      );
    } catch (error) {
      if (error instanceof GitError) {
        const detail = error.stderr.trim();
        this.logger.error(
          `base 브랜치(${baseBranch}) 동기화 실패${detail ? `: ${detail}` : ""}`,
        );
        throw new GitSyncError(baseBranch, error.stderr, projectPath, error);
      }
      if (error instanceof GitTimeoutError) {
        this.logger.error(`base 브랜치(${baseBranch}) 동기화 타임아웃: ${error.command}`);
        throw new GitSyncError(baseBranch, error.message, projectPath, error);
      }
      throw error;
    }

    this.logger.info(`base 브랜치 동기화 완료: ${baseBranch}`);
  }

  /**
   * 브랜치 생성 (slug 자동 생성)
   */
  async createBranch(
    projectPath: string,
    taskDescription: string,
    branchPrefix: string,
  ): Promise<string> {
    const timestamp = this.formatTimestamp();
    const slug = this.generateSlug(taskDescription);
    let branchName = `${branchPrefix}/${timestamp}-${slug}`;

    // 기존 브랜치와 충돌 확인
    let suffix = 1;
    while (await this.branchExists(projectPath, branchName)) {
      suffix++;
      branchName = `${branchPrefix}/${timestamp}-${slug}-${suffix}`;
    }

    await this.execGit(projectPath, ["checkout", "-b", branchName]);
    this.logger.info(`브랜치 생성: ${branchName}`);

    return branchName;
  }

  /**
   * 커밋 (빈 커밋 방지).
   *
   * 커밋 메시지 우선순위:
   *   1. customMessage (구현 명세에서 추출된 비즈니스 커밋 메시지) — 그대로 사용
   *   2. fallback: `[ai-cycle-N] Auto-generated code changes` (사이클 1) /
   *                `[ai-cycle-N] Rework based on review feedback` (사이클 2+)
   *
   * customMessage가 지정된 경우 일괄 자동 메시지로 덮어쓰지 않는다.
   */
  async commit(
    projectPath: string,
    cycleNumber: number,
    customMessage?: string,
  ): Promise<string> {
    // 모든 변경사항 스테이징
    await this.execGit(projectPath, ["add", "-A"]);

    // 스테이징된 변경사항 확인
    const status = await this.execGit(projectPath, ["status", "--porcelain"]);
    if (status.stdout.trim() === "") {
      this.logger.info(`사이클 ${cycleNumber}: 변경사항 없음, 커밋 건너뜀`);
      return "";
    }

    // 커밋 메시지 구성
    const trimmedCustom = customMessage?.trim();
    let message: string;
    if (trimmedCustom && trimmedCustom.length > 0) {
      message = trimmedCustom;
      this.logger.debug(
        `사이클 ${cycleNumber}: 명세 권장 커밋 메시지 사용: ${message}`,
      );
    } else {
      message =
        cycleNumber === 1
          ? `[${COMMIT_PREFIX}-${cycleNumber}] ${DEFAULT_COMMIT_MESSAGE}`
          : `[${COMMIT_PREFIX}-${cycleNumber}] ${REWORK_COMMIT_MESSAGE}`;
    }

    await this.execGit(projectPath, ["commit", "-m", message]);

    // SHA 조회
    const shaResult = await this.execGit(projectPath, ["rev-parse", "HEAD"]);
    const sha = shaResult.stdout.trim();

    this.logger.info(`커밋 생성: ${sha.slice(0, 8)} (사이클 ${cycleNumber})`);
    return sha;
  }

  /**
   * Push (브랜치 확인 후)
   */
  async push(projectPath: string, branchName: string): Promise<void> {
    // 현재 브랜치 확인
    const currentBranch = await this.getCurrentBranch(projectPath);
    if (currentBranch !== branchName) {
      throw new GitPushError(
        branchName,
        `현재 브랜치(${currentBranch})가 예상 브랜치(${branchName})와 다릅니다`,
        projectPath,
      );
    }

    // main/master push 방지
    if (currentBranch === "main" || currentBranch === "master") {
      throw new GitPushError(
        branchName,
        "main/master 브랜치에 직접 push할 수 없습니다",
        projectPath,
      );
    }

    await this.execGit(projectPath, ["push", "-u", "origin", branchName], GIT_NETWORK_TIMEOUT);
    this.logger.info(`Push 완료: ${branchName}`);
  }

  /**
   * PR 생성 (중복 방지)
   */
  async createPullRequest(request: PrRequest): Promise<string> {
    // 기존 PR 확인
    const existingPr = await this.checkExistingPr(request.projectPath, request.branchName);
    if (existingPr) {
      this.logger.warn(`이미 열린 PR이 있습니다: ${existingPr}`);
      return existingPr;
    }

    try {
      const result = await this.execGh(
        request.projectPath,
        [
          "pr",
          "create",
          "--title",
          request.title,
          "--body",
          request.body,
          "--base",
          request.baseBranch,
          "--head",
          request.branchName,
        ],
      );

      const prUrl = result.stdout.trim();
      this.logger.info(`PR 생성: ${prUrl}`);
      return prUrl;
    } catch (error) {
      if (error instanceof GitError) {
        // gh가 출력한 실제 stderr를 로그 파일에도 남겨 사후 진단을 가능하게 한다.
        const detail = error.stderr.trim();
        this.logger.error(
          `PR 생성 실패 (브랜치=${request.branchName})${detail ? `: ${detail}` : ""}`,
        );
        throw new GitPrError(error.stderr, request.projectPath);
      }
      throw error;
    }
  }

  /**
   * Dirty state 확인
   */
  async checkDirtyState(projectPath: string): Promise<DirtyStateInfo> {
    const result = await this.execGit(projectPath, ["status", "--porcelain"]);
    const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);

    const untrackedFiles: string[] = [];
    const modifiedFiles: string[] = [];

    for (const line of lines) {
      const status = line.slice(0, 2);
      const file = line.slice(3).trim();

      if (status === "??") {
        untrackedFiles.push(file);
      } else {
        modifiedFiles.push(file);
      }
    }

    return {
      isDirty: lines.length > 0,
      untrackedFiles,
      modifiedFiles,
    };
  }

  /**
   * 현재 브랜치명 조회
   */
  async getCurrentBranch(projectPath: string): Promise<string> {
    const result = await this.execGit(projectPath, ["branch", "--show-current"]);
    return result.stdout.trim();
  }

  /**
   * 원격(origin) 존재 여부 확인.
   * - origin이 설정되어 있지 않으면 false를 반환한다.
   * - 워크플로우는 false인 경우 push/PR 단계를 스킵하고 로컬 완료로 마무리한다.
   */
  async hasRemote(projectPath: string, remoteName: string = "origin"): Promise<boolean> {
    try {
      const result = await this.execGit(projectPath, ["remote", "get-url", remoteName]);
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  // ── worktree (배치 병렬 빌드용 격리) ──

  /**
   * linked worktree 여부 판별.
   * - 메인 워크트리: `git-dir` == `git-common-dir` (둘 다 `.git`)
   * - linked worktree: `git-dir`(`.git/worktrees/<name>`) != `git-common-dir`(`.git`)
   * - git 저장소가 아니거나 명령 실패 시 false.
   */
  async isLinkedWorktree(projectPath: string): Promise<boolean> {
    try {
      const gitDir = await this.execGit(projectPath, ["rev-parse", "--git-dir"]);
      const commonDir = await this.execGit(projectPath, ["rev-parse", "--git-common-dir"]);
      return gitDir.stdout.trim() !== commonDir.stdout.trim();
    } catch {
      return false;
    }
  }

  /**
   * 배치 병렬 빌드용 base ref 선해석.
   * - origin 있으면 `origin/<base>` (배치가 사전 fetch 한 최신 원격 ref)
   * - 없으면 로컬 `<base>`
   */
  async resolveWorktreeBaseRef(basePath: string, baseBranch: string): Promise<string> {
    const hasRemote = await this.hasRemote(basePath);
    return hasRemote ? `origin/${baseBranch}` : baseBranch;
  }

  /**
   * 배치 빌드 전 base 브랜치를 한 번만 fetch 한다 (각 worktree가 동시 fetch 하여
   * ref-lock 경합이 나는 것을 방지). origin 없으면 no-op.
   */
  async fetchBase(basePath: string, baseBranch: string): Promise<void> {
    if (!(await this.hasRemote(basePath))) return;
    await this.execGit(basePath, ["fetch", "origin", baseBranch], GIT_NETWORK_TIMEOUT);
    this.logger.info(`배치 base fetch 완료: origin/${baseBranch}`);
  }

  /**
   * detached HEAD 상태의 worktree 를 생성한다.
   * `git worktree add --detach <worktreePath> <ref>`
   * - ref 는 보통 `origin/<base>` (resolveWorktreeBaseRef 결과)
   * - detached 이므로 base 브랜치를 점유하지 않아 병렬 worktree 간 충돌이 없다.
   */
  async addDetachedWorktree(
    basePath: string,
    worktreePath: string,
    ref: string,
  ): Promise<void> {
    await this.execGit(basePath, ["worktree", "add", "--detach", worktreePath, ref]);
    this.logger.info(`worktree 생성: ${worktreePath} @ ${ref}`);
  }

  /**
   * worktree 제거 (작업 디렉토리 삭제) 후 prune. 실패는 warn 후 무시한다.
   */
  async removeWorktree(basePath: string, worktreePath: string): Promise<void> {
    try {
      await this.execGit(basePath, ["worktree", "remove", "--force", worktreePath]);
      this.logger.info(`worktree 제거: ${worktreePath}`);
    } catch (error) {
      this.logger.warn(
        `worktree 제거 실패 (${worktreePath}): ${(error as Error).message}`,
      );
    }
    try {
      await this.execGit(basePath, ["worktree", "prune"]);
    } catch {
      // prune 실패는 무시
    }
  }

  // ── 내부 유틸리티 ──

  private generateSlug(text: string): string {
    let slug = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, MAX_SLUG_LENGTH);

    if (slug.length === 0) {
      slug = FALLBACK_SLUG;
    } else if (slug.length < MIN_SLUG_LENGTH) {
      slug = `task-${slug}`;
    }

    return slug;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    return `${y}${mo}${d}-${h}${mi}${s}`;
  }

  private async branchExists(projectPath: string, branchName: string): Promise<boolean> {
    try {
      await this.execGit(projectPath, ["rev-parse", "--verify", branchName]);
      return true;
    } catch {
      return false;
    }
  }

  private async checkExistingPr(projectPath: string, branchName: string): Promise<string | null> {
    try {
      const result = await this.execGh(
        projectPath,
        ["pr", "list", "--head", branchName, "--state", "open", "--json", "url", "--jq", ".[0].url"],
      );
      const url = result.stdout.trim();
      return url.length > 0 ? url : null;
    } catch {
      return null;
    }
  }

  private async execGit(
    cwd: string,
    args: string[],
    timeout: number = GIT_COMMAND_TIMEOUT,
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, { cwd, timeout });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string };

      if (err.code === "ETIMEDOUT" || err.message?.includes("timed out")) {
        throw new GitTimeoutError(`git ${args.join(" ")}`, timeout, cwd);
      }

      throw new GitError(
        `Git 명령 실패: git ${args.join(" ")}`,
        `git ${args.join(" ")}`,
        err.stderr ?? "",
        cwd,
        "recoverable",
        error as Error,
      );
    }
  }

  private async execGh(cwd: string, args: string[]): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync("gh", args, {
        cwd,
        timeout: GIT_NETWORK_TIMEOUT,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      throw new GitError(
        `GitHub CLI 실패: gh ${args.join(" ")}`,
        `gh ${args.join(" ")}`,
        err.stderr ?? "",
        cwd,
        "recoverable",
        error as Error,
      );
    }
  }
}
