/**
 * NotionStatusSync
 *
 * 워크플로우 EventEmitter를 구독하여
 *   phase:start / phase:complete / workflow:end 이벤트가 발생할 때
 * 해당 워크플로우에 연결된 Notion task의 Status 속성을 자동 업데이트한다.
 *
 * 설계 원칙:
 *   - 동기화 실패는 절대 워크플로우를 차단하지 않는다 (모두 warn 로그).
 *   - 같은 status로의 중복 전환은 skip.
 *   - PR URL이 있으면 완료 시 Notion 페이지에 코멘트 추가.
 */

import type { EventEmitter } from "node:events";
import type { Logger } from "../components/logger.js";
import type { NotionClient } from "./notion-client.js";
import type {
  PhaseStartEvent,
  PhaseCompleteEvent,
  WorkflowEndEvent,
} from "../types/events.js";
import type { WorkflowPhase } from "../types/workflow.js";
import { DEFAULT_NOTION_STATUS_MAPPING } from "../types/integrations.js";

export class NotionStatusSync {
  /** workflowId → notionPageId */
  private readonly mapping = new Map<string, string>();
  /** workflowId → 마지막으로 전송한 status 옵션명 */
  private readonly lastStatus = new Map<string, string>();
  /** workflowId → 완료 시 코멘트로 남길 PR URL */
  private readonly prUrls = new Map<string, string>();

  private readonly handlers = {
    phaseStart: (e: PhaseStartEvent) => this.handlePhaseStart(e),
    phaseComplete: (e: PhaseCompleteEvent) => this.handlePhaseComplete(e),
    workflowEnd: (e: WorkflowEndEvent) => this.handleWorkflowEnd(e),
  };

  constructor(
    private readonly notion: NotionClient,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
    private readonly statusMapping: Partial<
      Record<WorkflowPhase, string>
    > = DEFAULT_NOTION_STATUS_MAPPING,
  ) {}

  /**
   * 워크플로우 시작 시 호출.
   * 이후 발생하는 phase 이벤트에서 자동으로 Notion 동기화.
   */
  registerWorkflow(workflowId: string, notionPageId: string): void {
    this.mapping.set(workflowId, notionPageId);
    this.logger.debug(
      `Notion 상태 동기화 등록: workflow=${workflowId} → page=${notionPageId}`,
    );
  }

  /**
   * PR URL을 기록해두면 완료 시 코멘트로 자동 첨부.
   */
  setPrUrl(workflowId: string, prUrl: string): void {
    this.prUrls.set(workflowId, prUrl);
  }

  /**
   * 워크플로우 종료/정리.
   */
  unregisterWorkflow(workflowId: string): void {
    this.mapping.delete(workflowId);
    this.lastStatus.delete(workflowId);
    this.prUrls.delete(workflowId);
  }

  start(): void {
    this.eventEmitter.on("phase:start", this.handlers.phaseStart);
    this.eventEmitter.on("phase:complete", this.handlers.phaseComplete);
    this.eventEmitter.on("workflow:end", this.handlers.workflowEnd);
    this.logger.debug("NotionStatusSync 시작 (event subscribers 등록)");
  }

  stop(): void {
    this.eventEmitter.off("phase:start", this.handlers.phaseStart);
    this.eventEmitter.off("phase:complete", this.handlers.phaseComplete);
    this.eventEmitter.off("workflow:end", this.handlers.workflowEnd);
    this.mapping.clear();
    this.lastStatus.clear();
    this.prUrls.clear();
    this.logger.debug("NotionStatusSync 종료");
  }

  // ── 이벤트 핸들러 ──

  private async handlePhaseStart(event: PhaseStartEvent): Promise<void> {
    const pageId = this.mapping.get(event.workflowId);
    if (!pageId) return;
    await this.syncForPhase(event.workflowId, pageId, event.phase);
  }

  private async handlePhaseComplete(
    event: PhaseCompleteEvent,
  ): Promise<void> {
    // phase 완료 시점에는 다음 phase가 곧 start 이벤트로 status를 갱신하므로
    // 별도 전이는 하지 않는다. 단, completed phase 자체는 여기서 처리.
    if (event.phase === "completed") {
      const pageId = this.mapping.get(event.workflowId);
      if (!pageId) return;
      await this.syncForPhase(event.workflowId, pageId, "completed");
    }
  }

  private async handleWorkflowEnd(event: WorkflowEndEvent): Promise<void> {
    const pageId = this.mapping.get(event.workflowId);
    if (!pageId) {
      return;
    }

    const result = event.result;

    // 종료 사유별 최종 상태
    const finalPhase: WorkflowPhase =
      result.status === "completed"
        ? "completed"
        : result.status === "failed"
          ? "failed"
          : "stopped";

    await this.syncForPhase(event.workflowId, pageId, finalPhase);

    // PR URL: 우선 result에 있는 값을, 없으면 setPrUrl로 등록된 값을 사용
    const prUrl = result.prUrl ?? this.prUrls.get(event.workflowId);
    if (prUrl && result.status === "completed") {
      try {
        await this.notion.addComment(
          pageId,
          `✅ dev-agent 워크플로우 완료\nPR: ${prUrl}`,
        );
      } catch (err) {
        this.logger.warn(
          `Notion 완료 코멘트 추가 실패: ${(err as Error).message}`,
        );
      }
    } else if (result.status === "failed") {
      try {
        await this.notion.addComment(
          pageId,
          `❌ dev-agent 워크플로우 실패: ${result.error?.message ?? "(원인 미상)"}`,
        );
      } catch {
        // 무시
      }
    }

    this.unregisterWorkflow(event.workflowId);
  }

  // ── 핵심: phase → Notion status ──

  private async syncForPhase(
    workflowId: string,
    pageId: string,
    phase: WorkflowPhase,
  ): Promise<void> {
    const targetStatus = this.statusMapping[phase];
    if (!targetStatus) {
      // 매핑 없음 → 동기화 안 함
      return;
    }

    const last = this.lastStatus.get(workflowId);
    if (last === targetStatus) {
      return; // 중복 전송 방지
    }

    try {
      await this.notion.updateStatus(pageId, targetStatus);
      this.lastStatus.set(workflowId, targetStatus);
      this.logger.info(
        `Notion 상태 갱신: page=${pageId} → "${targetStatus}" (phase=${phase})`,
      );
    } catch (err) {
      this.logger.warn(
        `Notion 상태 갱신 실패 (page=${pageId}, status=${targetStatus}): ${(err as Error).message}`,
      );
    }
  }
}
