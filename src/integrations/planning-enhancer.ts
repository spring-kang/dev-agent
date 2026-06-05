/**
 * PlanningEnhancer
 *
 * Notion Task(DB row) + 본문 markdown + 참조 페이지들 → Claude CLI →
 * 워크플로우에 입력할 상세 기획서(markdown)로 보강한다.
 *
 * 동작:
 *   1) NotionClient.getTask(pageId)로 task 상세 fetch
 *   2) Claude CLI를 spawn해서 보강 결과 받음
 *   3) Claude 실패 시 fallback: task 본문을 정제하여 markdown 생성
 */

import { spawn } from "node:child_process";
import type { Logger } from "../components/logger.js";
import type { NotionClient } from "./notion-client.js";
import type { EnhancedPlan, NotionTaskDetail } from "../types/integrations.js";

export class PlanningEnhancerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningEnhancerError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 1_000_000;

export class PlanningEnhancer {
  constructor(
    private readonly notion: NotionClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Notion task로부터 보강된 기획서 생성.
   *
   * @param pageId Notion page UUID (DB row의 ID)
   * @param options.skipClaude  true면 Claude 호출 없이 즉시 fallback 사용
   */
  async enhanceFromTask(
    pageId: string,
    options?: { skipClaude?: boolean },
  ): Promise<EnhancedPlan> {
    const task = await this.notion.getTask(pageId);
    if (!task) {
      throw new PlanningEnhancerError(
        `Notion task를 찾을 수 없거나 접근 권한이 없습니다: ${pageId}`,
      );
    }

    this.logger.info(
      `Notion task 로드: ${task.title} (참조 ${task.referencedPages.length}개)`,
    );

    let enhanced: string;
    if (options?.skipClaude) {
      enhanced = this.buildFallback(task);
    } else {
      try {
        enhanced = await this.runClaude(task);
      } catch (err) {
        this.logger.warn(
          `Claude 보강 실패, fallback 사용: ${(err as Error).message}`,
        );
        enhanced = this.buildFallback(task);
      }
    }

    return {
      originalTaskId: task.pageId,
      taskTitle: task.title,
      enhancedTaskDescription: enhanced,
      context: { task },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Claude CLI 호출 ──

  private buildPrompt(task: NotionTaskDetail): string {
    const refs = task.referencedPages
      .map(
        (p, i) =>
          `### 참조 ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${p.bodyMarkdown}`,
      )
      .join("\n\n---\n\n");

    return `당신은 개발 작업 기획서를 작성하는 시니어 엔지니어입니다.
아래 Notion 작업 정보를 바탕으로 AI 코드 에이전트가 자율적으로 실행할 수 있는 명확한 기획서를 markdown으로 작성하세요.

# 입력: Notion Task
- 제목: ${task.title}
- 상태: ${task.status || "(미지정)"}
- 담당자: ${task.assignees.map((u) => u.name).join(", ") || "(미지정)"}
- 프로젝트 경로: ${task.projectPath || "(미지정)"}
- Notion URL: ${task.url}

## Task 본문
${task.bodyMarkdown || "(본문 없음)"}

${refs ? `## 참조 페이지\n\n${refs}` : ""}

# 출력 요구사항
다음 섹션을 포함하는 markdown 기획서를 작성하세요:
1. **목표** — 한 문장 요약
2. **컨텍스트** — 왜 이 작업이 필요한가
3. **요구사항** — 구현해야 할 기능을 bullet으로
4. **수용 기준** — 완료 조건 (테스트 가능한 형태로)
5. **참고사항** — 위 참조 페이지에서 추출한 핵심 제약/힌트

다른 부가 설명 없이 markdown 본문만 출력하세요.`;
  }

  private async runClaude(task: NotionTaskDetail): Promise<string> {
    const prompt = this.buildPrompt(task);
    const stdout = await this.executeClaudeCli(prompt);
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new PlanningEnhancerError("Claude 응답이 비어있습니다");
    }
    return trimmed;
  }

  private executeClaudeCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", prompt], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        reject(new PlanningEnhancerError("Claude 호출 시간 초과"));
      }, DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
        if (stdout.length > MAX_STDOUT_BYTES) {
          killed = true;
          child.kill("SIGTERM");
          reject(new PlanningEnhancerError("Claude 응답 크기 한계 초과"));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (!killed) reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) return;
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(
            new PlanningEnhancerError(
              `Claude 종료 코드 ${code}${stderr ? ` - ${stderr.slice(0, 200)}` : ""}`,
            ),
          );
        }
      });
    });
  }

  // ── Fallback: Claude 없이도 동작 ──

  private buildFallback(task: NotionTaskDetail): string {
    const lines: string[] = [];
    lines.push(`# ${task.title}`);
    lines.push("");
    lines.push(`**Notion URL**: ${task.url}`);
    if (task.assignees.length > 0) {
      lines.push(
        `**담당자**: ${task.assignees.map((u) => u.name).join(", ")}`,
      );
    }
    if (task.projectPath) {
      lines.push(`**프로젝트 경로**: ${task.projectPath}`);
    }
    lines.push("");

    if (task.bodyMarkdown) {
      lines.push("## 작업 본문");
      lines.push("");
      lines.push(task.bodyMarkdown);
      lines.push("");
    }

    if (task.referencedPages.length > 0) {
      lines.push("## 참조 페이지");
      lines.push("");
      for (const ref of task.referencedPages) {
        lines.push(`### ${ref.title}`);
        lines.push(`URL: ${ref.url}`);
        lines.push("");
        lines.push(ref.bodyMarkdown.slice(0, 4000));
        lines.push("");
      }
    }

    lines.push("## 수용 기준");
    lines.push("- 위 본문에 기술된 요구사항을 모두 충족");
    lines.push("- 기존 테스트가 깨지지 않음");
    lines.push("- 변경에 대한 적절한 테스트 추가");

    return lines.join("\n");
  }
}
