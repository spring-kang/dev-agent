/**
 * GitService (S-03) - Git 워크플로우 서비스
 * 초기화(브랜치 생성) + 완료(Push + PR) 담당
 */

import type { GitManager } from "../components/git-manager.js";
import type {
  GitInitResult,
  FinalizeContext,
  FinalizeResult,
  ReviewHistoryEntry,
} from "../types/git.js";
import { PR_TITLE_PREFIX, PR_AI_NOTICE, MAX_PR_TITLE_LENGTH } from "../types/git.js";
import type { Logger } from "../components/logger.js";

export class GitService {
  constructor(
    private readonly gitManager: GitManager,
    private readonly logger: Logger,
  ) {}

  /**
   * 워크플로우 Git 초기화 (dirty state 확인 + 브랜치 생성)
   */
  async initWorkflow(
    projectPath: string,
    taskDescription: string,
    branchPrefix: string,
    baseBranch: string,
  ): Promise<GitInitResult> {
    // 1. Dirty state 확인
    const dirtyState = await this.gitManager.checkDirtyState(projectPath);

    if (dirtyState.isDirty) {
      const fileCount = dirtyState.untrackedFiles.length + dirtyState.modifiedFiles.length;
      const preview = [...dirtyState.modifiedFiles, ...dirtyState.untrackedFiles]
        .slice(0, 10)
        .join(", ");
      const suffix = fileCount > 10 ? ` 외 ${fileCount - 10}개` : "";

      this.logger.warn(`작업 중인 변경사항이 감지되었습니다: ${preview}${suffix}`);
    }

    // 2. base 브랜치 동기화 (origin fetch/checkout/pull --ff-only)
    //    브랜치 생성 전에 항상 최신 base에서 분기하도록 보장한다.
    await this.gitManager.syncBaseBranch(projectPath, baseBranch);

    // 3. 브랜치 생성
    const branchName = await this.gitManager.createBranch(
      projectPath,
      taskDescription,
      branchPrefix,
    );

    return {
      branchName,
      hadDirtyState: dirtyState.isDirty,
      dirtyFiles: dirtyState.isDirty ? dirtyState : undefined,
    };
  }

  /**
   * 워크플로우 완료 (Push + PR 생성).
   *
   * - origin remote가 설정되어 있지 않으면 push/PR을 스킵하고 로컬 완료로 마무리한다.
   *   (e.g. 로컬 검증용 임시 저장소). prUrl=null, skipped=true 로 반환한다.
   * - remote가 있으면 push → PR 생성을 정상 수행한다.
   */
  async finalize(
    projectPath: string,
    branchName: string,
    baseBranch: string,
    context: FinalizeContext,
    prIncludeReviewSummary: boolean,
  ): Promise<FinalizeResult> {
    // 0. Remote 존재 확인 (없으면 로컬 완료)
    const hasRemote = await this.gitManager.hasRemote(projectPath);
    if (!hasRemote) {
      this.logger.warn(
        "원격 저장소(origin)가 설정되어 있지 않아 push/PR 단계를 스킵합니다. " +
          "로컬 브랜치에는 변경 사항이 그대로 보존됩니다.",
      );
      return {
        prUrl: null,
        branchName,
        skipped: true,
        skipReason: "no-remote",
      };
    }

    // 1. Push
    await this.gitManager.push(projectPath, branchName);

    // 2. PR 본문 생성
    const prBody = this.buildPrBody(context, prIncludeReviewSummary);
    const prTitle = this.buildPrTitle(context.taskDescription);

    // 3. PR 생성
    const prUrl = await this.gitManager.createPullRequest({
      projectPath,
      branchName,
      baseBranch,
      title: prTitle,
      body: prBody,
    });

    return { prUrl, branchName };
  }

  /**
   * PR 제목 구성.
   *
   * - taskDescription은 `${task.title}\n\n${본문 마크다운}` 형태이므로
   *   첫 줄(= task 제목)만 사용해 본문이 제목에 섞이지 않게 한다.
   * - GitHub PR 제목은 최대 256자(GraphQL 제약)이므로 prefix 포함 길이를 맞춰
   *   초과 시 말줄임표(…)로 truncate 한다.
   */
  private buildPrTitle(taskDescription: string): string {
    const firstLine = (taskDescription.split("\n")[0] ?? "").trim();
    const base = firstLine.length > 0 ? firstLine : taskDescription.trim();

    const prefix = `${PR_TITLE_PREFIX} `;
    const available = MAX_PR_TITLE_LENGTH - prefix.length;

    const title =
      base.length > available ? `${base.slice(0, available - 1)}\u2026` : base;

    return `${prefix}${title}`;
  }

  /**
   * PR 본문 구성
   */
  private buildPrBody(context: FinalizeContext, includeReviewSummary: boolean): string {
    const sections: string[] = [];

    // AI 생성 표시
    sections.push(PR_AI_NOTICE);
    sections.push("");

    // 작업 요약
    sections.push("## 작업 요약");
    sections.push(context.taskDescription);
    sections.push("");

    // 변경 사항
    sections.push("## 변경 사항");
    sections.push(`- 총 사이클 수: ${context.totalCycles}회`);
    sections.push(`- 변경된 파일: ${context.changedFiles.length}개`);
    sections.push("");

    if (context.changedFiles.length > 0) {
      sections.push("### 변경된 파일 목록");
      for (const file of context.changedFiles.slice(0, 20)) {
        sections.push(`- \`${file}\``);
      }
      if (context.changedFiles.length > 20) {
        sections.push(`- ... 외 ${context.changedFiles.length - 20}개`);
      }
      sections.push("");
    }

    // 리뷰 히스토리
    if (includeReviewSummary && context.reviewHistory.length > 0) {
      sections.push("## 리뷰 히스토리");
      sections.push("");
      sections.push("| Cycle | Status | Findings | Critical |");
      sections.push("|---|---|---|---|");

      for (const entry of context.reviewHistory) {
        const statusIcon = entry.status === "APPROVED" ? "\u2705" : "\u274C";
        sections.push(
          `| ${entry.cycleNumber} | ${statusIcon} ${entry.status} | ${entry.findingsCount} | ${entry.criticalCount} |`,
        );
      }
      sections.push("");
    }

    return sections.join("\n");
  }
}
