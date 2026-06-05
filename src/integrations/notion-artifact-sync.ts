/**
 * NotionArtifactSync
 *
 * 워크플로우 EventEmitter 구독자.
 * 매 사이클 planning phase가 완료될 때마다 해당 사이클의 3개 산출물
 * (requirements.md / implementation-spec.md / test-scenarios.md)을
 *   1) 사이클별 toggle 블록 1개로 묶어 Notion 페이지 본문에 append
 *   2) 코멘트로 짧은 요약 한 줄 추가
 * 한다.
 *
 * 설계 원칙(NotionStatusSync와 동일):
 *   - 동기화 실패는 절대 워크플로우를 차단하지 않는다 (모두 warn 로그).
 *   - 같은 사이클에 대한 중복 append를 방지한다 (idempotency).
 *
 * 산출물 위치 컨벤션:
 *   {projectPath}/.ai-workflow/current/artifacts/{requirements|implementation-spec|test-scenarios}.md
 *   (Claude planning agent가 매 사이클마다 같은 경로에 덮어쓰는 구조이므로,
 *    phase:complete[planning] 시점에 읽으면 해당 사이클의 산출물을 얻을 수 있다.)
 */

import type { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Logger } from "../components/logger.js";
import type {
  PhaseCompleteEvent,
  WorkflowEndEvent,
} from "../types/events.js";
import { WORKFLOW_DIRS } from "../types/workflow.js";
import { ARTIFACT_FILES } from "../types/agent.js";
import {
  NotionBlockAppender,
  type NotionBlockInput,
} from "./notion-block-appender.js";

interface RegisteredWorkflow {
  pageId: string;
  projectPath: string;
  /** 이미 처리한 사이클 번호 (중복 append 방지) */
  syncedCycles: Set<number>;
}

interface ArtifactPayload {
  label: string;
  fileName: string;
  content: string;
}

export class NotionArtifactSync {
  private readonly registry = new Map<string, RegisteredWorkflow>();

  private readonly handlers = {
    phaseComplete: (e: PhaseCompleteEvent) => this.handlePhaseComplete(e),
    workflowEnd: (e: WorkflowEndEvent) => this.handleWorkflowEnd(e),
  };

  constructor(
    private readonly appender: NotionBlockAppender,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
  ) {}

  /**
   * 워크플로우 시작 시 호출.
   * workflowId ↔ notionPageId ↔ projectPath 매핑을 등록한다.
   */
  registerWorkflow(
    workflowId: string,
    notionPageId: string,
    projectPath: string,
  ): void {
    this.registry.set(workflowId, {
      pageId: notionPageId,
      projectPath,
      syncedCycles: new Set(),
    });
    this.logger.debug(
      `Notion 산출물 동기화 등록: workflow=${workflowId} → page=${notionPageId}`,
    );
  }

  unregisterWorkflow(workflowId: string): void {
    this.registry.delete(workflowId);
  }

  start(): void {
    this.eventEmitter.on("phase:complete", this.handlers.phaseComplete);
    this.eventEmitter.on("workflow:end", this.handlers.workflowEnd);
    this.logger.debug("NotionArtifactSync 시작 (event subscribers 등록)");
  }

  stop(): void {
    this.eventEmitter.off("phase:complete", this.handlers.phaseComplete);
    this.eventEmitter.off("workflow:end", this.handlers.workflowEnd);
    this.registry.clear();
    this.logger.debug("NotionArtifactSync 종료");
  }

  // ── 이벤트 핸들러 ──

  private async handlePhaseComplete(event: PhaseCompleteEvent): Promise<void> {
    if (event.phase !== "planning") return;

    const entry = this.registry.get(event.workflowId);
    if (!entry) return;

    if (entry.syncedCycles.has(event.cycleNumber)) {
      this.logger.debug(
        `Notion 산출물 동기화 skip (이미 처리됨): cycle=${event.cycleNumber}`,
      );
      return;
    }
    entry.syncedCycles.add(event.cycleNumber);

    try {
      await this.syncCycleArtifacts(
        entry.pageId,
        entry.projectPath,
        event.cycleNumber,
      );
    } catch (err) {
      // 동기화 실패는 워크플로우를 차단하지 않음
      this.logger.warn(
        `Notion 산출물 동기화 실패 (cycle=${event.cycleNumber}, page=${entry.pageId}): ${(err as Error).message}`,
      );
    }
  }

  private handleWorkflowEnd(event: WorkflowEndEvent): void {
    // 워크플로우 종료 시 메모리 정리만 한다 (실제 정리는 stop()이 처리)
    this.unregisterWorkflow(event.workflowId);
  }

  // ── 핵심 로직 ──

  private async syncCycleArtifacts(
    pageId: string,
    projectPath: string,
    cycleNumber: number,
  ): Promise<void> {
    const artifacts = await this.loadArtifacts(projectPath);
    const present = artifacts.filter((a) => a.content.trim().length > 0);

    if (present.length === 0) {
      this.logger.debug(
        `Notion 산출물 동기화 skip (3개 모두 비어있음): cycle=${cycleNumber}`,
      );
      return;
    }

    // 1) Toggle 블록 구성: ▶ 사이클 N — 기획 산출물
    const cycleToggle = this.buildCycleToggle(cycleNumber, present);

    // 2) 본문 append
    await this.appender.appendBlocks(pageId, [cycleToggle]);

    // 3) 요약 코멘트
    const presentLabels = present.map((a) => a.label).join(" / ");
    const comment = `📋 사이클 ${cycleNumber} 기획 완료 — ${presentLabels} (본문 toggle 참조)`;
    await this.appender.addComment(pageId, comment);

    this.logger.info(
      `Notion 산출물 동기화 완료 (cycle=${cycleNumber}, page=${pageId}, files=${present.length})`,
    );
  }

  /**
   * 3개 산출물을 일관된 순서로 로드.
   * 파일이 없으면 빈 문자열로 표시 (필터링은 호출자에서).
   */
  private async loadArtifacts(projectPath: string): Promise<ArtifactPayload[]> {
    const artifactsDir = path.join(projectPath, WORKFLOW_DIRS.artifacts);

    const targets: Array<{ label: string; fileName: string }> = [
      { label: "Requirements", fileName: ARTIFACT_FILES.requirements },
      { label: "Implementation Spec", fileName: ARTIFACT_FILES.implementationSpec },
      { label: "Test Scenarios", fileName: ARTIFACT_FILES.testScenarios },
    ];

    const payloads: ArtifactPayload[] = [];
    for (const t of targets) {
      const filePath = path.join(artifactsDir, t.fileName);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        payloads.push({ label: t.label, fileName: t.fileName, content });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          this.logger.warn(
            `산출물 읽기 실패 (${filePath}): ${(err as Error).message}`,
          );
        }
        payloads.push({ label: t.label, fileName: t.fileName, content: "" });
      }
    }
    return payloads;
  }

  /**
   * 사이클 1개 분의 toggle 블록 1개를 만든다.
   * 자식 블록 구성:
   *   - heading_2: 산출물 라벨 (예: "Requirements (requirements.md)")
   *   - 마크다운에서 변환된 paragraph/heading/list/code 블록들
   *   - divider 로 산출물 간 시각적 구분
   *
   * Notion 제약상 toggle children은 1차 호출에서 최대 100개까지만 inline 가능하므로,
   * 변환 결과가 100개를 초과하면 앞부분만 포함하고 코드 블록 한 줄로 truncation 표시한다.
   */
  private buildCycleToggle(
    cycleNumber: number,
    artifacts: ArtifactPayload[],
  ): NotionBlockInput {
    const children: NotionBlockInput[] = [];

    artifacts.forEach((art, idx) => {
      children.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [
            {
              type: "text",
              text: { content: `${art.label} (${art.fileName})` },
            },
          ],
        },
      });

      const converted = this.appender.markdownToBlocks(art.content);
      children.push(...converted);

      if (idx < artifacts.length - 1) {
        children.push({ object: "block", type: "divider", divider: {} });
      }
    });

    const MAX_INLINE_CHILDREN = 100;
    let safeChildren: NotionBlockInput[];
    if (children.length > MAX_INLINE_CHILDREN) {
      safeChildren = children.slice(0, MAX_INLINE_CHILDREN - 1);
      safeChildren.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `… (블록 수 한계로 ${children.length - safeChildren.length}개 블록 생략됨)`,
              },
            },
          ],
        },
      });
    } else {
      safeChildren = children;
    }

    return this.appender.toggleBlock(
      `📋 사이클 ${cycleNumber} — 기획 산출물`,
      safeChildren,
    );
  }
}
