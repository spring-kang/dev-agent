/**
 * NotionFollowUpService - 반복 소진/정체로 종료된 빌드의 후속 작업 티켓 자동 생성
 *
 * 배경: `devagent build` 가 maxIterations 까지 도달했거나 정체(stall)로 조기 종료되면
 * 사용자가 PR 생성(create_pr)을 선택해 status="completed" 로 끝나지만, 마지막 리뷰는
 * 여전히 CHANGES_REQUESTED(미해결 지적사항 존재) 상태일 수 있다. 이 경우 "남은 작업"을
 * 원본 task 와 같은 DB 에 후속 티켓(Status="To Do")으로 생성해 추적 가능하게 한다.
 *
 * 트리거 조건 (사용자 합의):
 *  - status === "completed"  (PR 생성 경로 = 최대 반복/정체에서만 도달)
 *  - 마지막 리뷰 status === "CHANGES_REQUESTED"
 *  - 미해결 finding 이 1건 이상
 *  - status === "stopped"(사용자가 명시적으로 중단) / 정상 APPROVED 는 제외
 *
 * 기본 ON, `--no-follow-up`(createFollowUp=false) 로 끌 수 있다.
 */

import type { Logger } from "../components/logger.js";
import type { NotionClient } from "./notion-client.js";
import type { NotionBlockAppender } from "./notion-block-appender.js";
import type { WorkflowResult } from "../types/workflow.js";
import type { ReviewResult } from "../types/review.js";

/** 후속 티켓 초기 Status (사용자 합의) */
export const FOLLOW_UP_STATUS = "To Do";
/** 후속 티켓 제목 접두사 */
export const FOLLOW_UP_TITLE_PREFIX = "[후속] ";

export interface FollowUpParams {
  /** 원본 Notion task pageId (부모 DB 추론 + 링크백 코멘트 대상) */
  sourcePageId: string;
  /** 원본 task 제목 */
  taskTitle: string;
  /** 프로젝트 경로 (후속 티켓에 복사) */
  projectPath?: string;
  /** 빌드 결과 */
  result: WorkflowResult;
  /** 부모 DB 강제 지정 (생략 시 sourcePageId 로 추론) */
  databaseId?: string;
  /** false 면 생성 스킵 (CLI --no-follow-up). 기본 true */
  enabled?: boolean;
}

export interface FollowUpOutcome {
  created: boolean;
  pageId?: string;
  url?: string;
  /** 생성하지 않은 경우 사유 */
  skippedReason?: string;
}

/** WorkflowResult 의 마지막 리뷰 결과 (없으면 undefined) */
export function lastReviewOf(result: WorkflowResult): ReviewResult | undefined {
  const history = result.reviewHistory;
  if (!history || history.length === 0) return undefined;
  return history[history.length - 1];
}

/**
 * 후속 티켓을 만들어야 하는지 순수 판정.
 * @param result 빌드 결과
 * @param enabled 사용자 opt-out 여부 (false 면 무조건 false)
 */
export function shouldCreateFollowUp(result: WorkflowResult, enabled = true): boolean {
  if (!enabled) return false;
  if (result.status !== "completed") return false;
  const last = lastReviewOf(result);
  if (!last) return false;
  if (last.status !== "CHANGES_REQUESTED") return false;
  return last.findings.length > 0;
}

/**
 * 후속 티켓 본문 markdown 생성 (순수).
 */
export function buildFollowUpMarkdown(params: {
  taskTitle: string;
  result: WorkflowResult;
  review: ReviewResult;
}): string {
  const { taskTitle, result, review } = params;
  const lines: string[] = [];

  lines.push("## 후속 작업 (자동 생성)");
  lines.push("");
  lines.push(
    `원본 task **${taskTitle}** 의 자동 개발이 최대 반복 또는 정체(stall)로 종료되었으나, ` +
      "마지막 리뷰에 아직 해결되지 않은 지적사항이 남아 있습니다. 남은 작업을 이 티켓에서 이어서 진행하세요.",
  );
  lines.push("");

  lines.push("### 빌드 요약");
  lines.push(`- 총 사이클: ${result.totalCycles}회`);
  lines.push(`- 마지막 리뷰 상태: ${review.status}`);
  if (result.prUrl) lines.push(`- 생성된 PR: ${result.prUrl}`);
  if (result.branchName) lines.push(`- 브랜치: ${result.branchName}`);
  lines.push("");

  const failedChecks = review.checks.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    lines.push("### 실패한 검증");
    for (const c of failedChecks) {
      lines.push(`- ${c.name}: ${c.details}`);
    }
    lines.push("");
  }

  lines.push(`### 미해결 지적사항 (${review.findings.length}건)`);
  review.findings.forEach((f, idx) => {
    lines.push(`${idx + 1}. [${f.severity}] ${f.location} — ${f.description}`);
    if (f.suggestion) lines.push(`   - 제안: ${f.suggestion}`);
  });
  lines.push("");

  if (review.summary) {
    lines.push("### 리뷰 요약");
    lines.push(review.summary);
    lines.push("");
  }

  return lines.join("\n");
}

export class NotionFollowUpService {
  constructor(
    private readonly notionClient: NotionClient,
    private readonly blockAppender: NotionBlockAppender,
    private readonly logger: Logger,
  ) {}

  /**
   * 트리거 조건을 만족하면 후속 작업 티켓을 생성한다.
   * 실패는 빌드 전체를 망가뜨리지 않도록 내부에서 흡수(warn)하고 created:false 를 반환.
   */
  async createFollowUpIfNeeded(params: FollowUpParams): Promise<FollowUpOutcome> {
    const enabled = params.enabled !== false;
    if (!shouldCreateFollowUp(params.result, enabled)) {
      return {
        created: false,
        skippedReason: !enabled ? "사용자 비활성화(--no-follow-up)" : "트리거 조건 미충족",
      };
    }

    const review = lastReviewOf(params.result)!;

    try {
      // 1. 부모 DB 결정
      const databaseId =
        params.databaseId ?? (await this.notionClient.getParentDatabaseId(params.sourcePageId));
      if (!databaseId) {
        this.logger.warn(
          `후속 티켓 생성 스킵: 원본 task(${params.sourcePageId})의 부모 DB를 찾지 못했습니다.`,
        );
        return { created: false, skippedReason: "부모 DB 미확인" };
      }

      // 2. 티켓 생성 (Status="To Do" + Project Path 복사)
      const title = `${FOLLOW_UP_TITLE_PREFIX}${params.taskTitle}`;
      const page = await this.notionClient.createPage({
        databaseId,
        title,
        status: FOLLOW_UP_STATUS,
        ...(params.projectPath ? { projectPath: params.projectPath } : {}),
      });

      // 3. 본문 채우기 (미해결 지적사항 → 블록)
      const markdown = buildFollowUpMarkdown({
        taskTitle: params.taskTitle,
        result: params.result,
        review,
      });
      try {
        const blocks = this.blockAppender.markdownToBlocks(markdown);
        await this.blockAppender.appendBlocks(page.id, blocks);
      } catch (err) {
        this.logger.warn(`후속 티켓 본문 작성 실패(티켓은 생성됨): ${(err as Error).message}`);
      }

      // 4. 원본 task 에 링크백 코멘트
      try {
        const link = page.url ? page.url : page.id;
        await this.notionClient.addComment(
          params.sourcePageId,
          `미해결 지적사항(${review.findings.length}건)을 후속 작업 티켓으로 생성했습니다: ${link}`,
        );
      } catch (err) {
        this.logger.warn(`원본 task 링크백 코멘트 실패: ${(err as Error).message}`);
      }

      this.logger.info(`후속 작업 티켓 생성 완료: ${title} (${page.url || page.id})`);
      return { created: true, pageId: page.id, url: page.url };
    } catch (err) {
      this.logger.warn(`후속 작업 티켓 생성 실패: ${(err as Error).message}`);
      return { created: false, skippedReason: `생성 오류: ${(err as Error).message}` };
    }
  }
}
