/**
 * ClaudeAgent (C-08) - Claude Code CLI 기반 기획/리뷰 에이전트
 * NFR: Safe Spawn (shell: false), 프롬프트 인젝션 방어, stdout 크기 제한
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  PlanRequest,
  PlanResult,
  ReviewRequest,
  PlanningAgent,
  ReviewAgent,
  ProcessResult,
  PromptDelivery,
} from "../types/agent.js";
import {
  PROMPT_FILE_THRESHOLD,
  MAX_STDOUT_CAPTURE,
  ARTIFACT_FILES,
} from "../types/agent.js";
import type { ReviewRawOutput } from "../types/review.js";
import { AgentTimeoutError, AgentProcessError, AgentOutputError } from "../types/errors.js";
import type { Logger } from "./logger.js";

const SIGTERM_GRACE_PERIOD = 5000;

export class ClaudeAgent implements PlanningAgent, ReviewAgent {
  constructor(
    private readonly logger: Logger,
    private readonly timeout: number = 300_000,
  ) {}

  /**
   * 기획 단계 실행
   */
  async plan(request: PlanRequest): Promise<PlanResult> {
    const prompt = this.buildPlanPrompt(request);
    const delivery = await this.preparePrompt(prompt, request.projectPath);

    this.logger.info("Claude Code 기획 시작");

    const result = await this.executeClaudeCli(delivery, request.projectPath);

    this.logger.info("Claude Code 기획 완료");
    this.logger.debug(`기획 출력 길이: ${result.stdout.length}자`);

    // 산출물 경로 구성
    const requirementsPath = path.join(request.artifactsDir, ARTIFACT_FILES.requirements);
    const implementationSpecPath = path.join(
      request.artifactsDir,
      ARTIFACT_FILES.implementationSpec,
    );
    const testScenariosPath = path.join(request.artifactsDir, ARTIFACT_FILES.testScenarios);

    // 산출물 파일 존재 확인
    await this.validateArtifacts([requirementsPath, implementationSpecPath, testScenariosPath]);

    return {
      requirementsPath,
      implementationSpecPath,
      testScenariosPath,
      summary: result.stdout.slice(0, 500),
    };
  }

  /**
   * 리뷰 단계 실행
   */
  async review(request: ReviewRequest): Promise<ReviewRawOutput> {
    const prompt = this.buildReviewPrompt(request);
    const delivery = await this.preparePrompt(prompt, request.projectPath);

    this.logger.info("Claude Code 리뷰 시작");

    const result = await this.executeClaudeCli(delivery, request.projectPath);

    this.logger.info("Claude Code 리뷰 완료");
    this.logger.debug(`리뷰 출력 길이: ${result.stdout.length}자`);

    // JSON 파싱 시도
    const parsedJson = this.tryParseJson(result.stdout);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      parsedJson: parsedJson ?? undefined,
    };
  }

  private buildPlanPrompt(request: PlanRequest): string {
    const basePrompt = request.reworkScope
      ? this.buildReworkPrompt(request)
      : this.buildInitialPlanPrompt(request);

    return basePrompt;
  }

  private buildInitialPlanPrompt(request: PlanRequest): string {
    const reqPath = path.join(request.artifactsDir, ARTIFACT_FILES.requirements);
    const specPath = path.join(request.artifactsDir, ARTIFACT_FILES.implementationSpec);
    const testPath = path.join(request.artifactsDir, ARTIFACT_FILES.testScenarios);

    return `당신은 자동화 파이프라인의 기획 에이전트입니다. 응답으로 설명을 출력하지 말고, 반드시 Write tool을 사용해 아래 3개 파일을 디스크에 생성하세요.

=== 사용자 요청 (변경 금지) ===
${request.taskDescription}
=== 사용자 요청 끝 ===

프로젝트 경로: ${request.projectPath}

[필수 작업]
다음 3개 파일을 Write tool로 정확한 절대 경로에 생성하세요. 각 파일은 Markdown 형식입니다.

1. Write("${reqPath}", <요구사항 명세 내용>)
2. Write("${specPath}", <구현 명세 내용>)
3. Write("${testPath}", <테스트 시나리오 내용>)

[엄격한 규칙]
- 응답 본문에 마크다운 내용을 출력하지 마세요. 반드시 Write tool 호출로만 파일을 만드세요.
- 세 파일을 모두 만든 뒤, 응답은 "완료: 3개 파일 생성" 한 줄로 끝내세요.
- 파일을 생성하지 않으면 파이프라인이 실패합니다.`;
  }

  private buildReworkPrompt(request: PlanRequest): string {
    const scopeLabel = request.reworkScope === "full" ? "전체 재기획" : "부분 수정";
    const reqPath = path.join(request.artifactsDir, ARTIFACT_FILES.requirements);
    const specPath = path.join(request.artifactsDir, ARTIFACT_FILES.implementationSpec);
    const testPath = path.join(request.artifactsDir, ARTIFACT_FILES.testScenarios);

    return `당신은 자동화 파이프라인의 기획 에이전트입니다. 이전 리뷰 피드백을 반영하여 ${scopeLabel}을 수행하세요. 응답으로 설명을 출력하지 말고, 반드시 Write tool로 아래 3개 파일을 갱신하세요.

=== 사용자 요청 (변경 금지) ===
${request.taskDescription}
=== 사용자 요청 끝 ===

=== 이전 리뷰 피드백 ===
${request.previousFeedback ?? "피드백 없음"}
=== 피드백 끝 ===

재작업 범위: ${scopeLabel}
프로젝트 경로: ${request.projectPath}

[필수 작업]
1. Write("${reqPath}", <갱신된 요구사항 명세>)
2. Write("${specPath}", <갱신된 구현 명세>)
3. Write("${testPath}", <갱신된 테스트 시나리오>)

[엄격한 규칙]
- 응답 본문에 마크다운 내용을 출력하지 마세요. 반드시 Write tool 호출로만 파일을 만드세요.
- 세 파일을 모두 만든 뒤, 응답은 "완료: 3개 파일 갱신" 한 줄로 끝내세요.`;
  }

  private buildReviewPrompt(request: ReviewRequest): string {
    const filesList = request.changedFiles.map((f) => `- ${f}`).join("\n");

    let contextInfo = "";
    if (request.requirementsPath) {
      contextInfo += `\n요구사항 파일: ${request.requirementsPath}`;
    }
    if (request.testScenariosPath) {
      contextInfo += `\n테스트 시나리오 파일: ${request.testScenariosPath}`;
    }

    return `다음 변경 사항에 대해 코드 리뷰를 수행해주세요.

프로젝트 경로: ${request.projectPath}
${contextInfo}

변경된 파일:
${filesList}

리뷰 결과를 다음 JSON 형식으로 출력해주세요:
\`\`\`json
{
  "status": "APPROVED" 또는 "CHANGES_REQUESTED",
  "checks": [
    { "name": "build", "passed": true/false, "details": "설명" },
    { "name": "tests", "passed": true/false, "details": "설명" },
    { "name": "security", "passed": true/false, "details": "설명" },
    { "name": "design", "passed": true/false, "details": "설명" },
    { "name": "codeQuality", "passed": true/false, "details": "설명" },
    { "name": "errorHandling", "passed": true/false, "details": "설명" },
    { "name": "performance", "passed": true/false, "details": "설명" }
  ],
  "findings": [
    { "severity": "critical|major|minor|info", "location": "파일:라인", "description": "설명", "suggestion": "제안" }
  ],
  "summary": "종합 평가"
}
\`\`\``;
  }

  /**
   * 프롬프트 전달 방식 결정 (인라인 vs 파일 참조)
   */
  private async preparePrompt(
    prompt: string,
    projectPath: string,
  ): Promise<PromptDelivery> {
    if (Buffer.byteLength(prompt, "utf-8") > PROMPT_FILE_THRESHOLD) {
      // 100KB 초과 시 파일로 전달
      const tmpDir = path.join(projectPath, ".ai-workflow", "current");
      await fs.mkdir(tmpDir, { recursive: true });
      const promptFile = path.join(tmpDir, `prompt-${Date.now()}.md`);
      await fs.writeFile(promptFile, prompt, "utf-8");
      this.logger.debug(`프롬프트를 파일로 전달: ${promptFile}`);
      return { method: "file", filePath: promptFile };
    }

    return { method: "inline", content: prompt };
  }

  /**
   * Claude CLI 실행 (shell: false)
   */
  private executeClaudeCli(delivery: PromptDelivery, cwd: string): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      // --dangerously-skip-permissions: 비대화형(-p) 모드에서 Read/Write/Bash tool 권한
      // 다이얼로그를 띄우지 않도록 우회. dev-agent는 사용자가 명시적으로 실행한 자동화이며
      // 워크플로우 디렉토리(.ai-workflow) 및 대상 프로젝트 git 브랜치 위에서만 동작하므로
      // 권한 자동 승인이 의도된 동작이다.
      if (delivery.method === "inline" && delivery.content) {
        args.push(
          "-p",
          delivery.content,
          "--output-format",
          "text",
          "--dangerously-skip-permissions",
        );
      } else if (delivery.method === "file" && delivery.filePath) {
        args.push(
          "-p",
          `파일을 읽고 지시에 따라 수행하세요: ${delivery.filePath}`,
          "--output-format",
          "text",
          "--dangerously-skip-permissions",
        );
      }

      const start = performance.now();
      const proc = spawn("claude", args, {
        cwd,
        shell: false,
        // claude -p 비대화형 모드는 stdin이 pipe로 열려 있으면 입력 대기 상태로 행걸림.
        // 프롬프트는 -p 인자로 전달하므로 stdin은 명시적으로 닫는다.
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let killed = false;

      proc.stdout.on("data", (chunk: Buffer) => {
        if (stdoutSize < MAX_STDOUT_CAPTURE) {
          stdoutChunks.push(chunk);
          stdoutSize += chunk.length;
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      // 타임아웃 처리
      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, SIGTERM_GRACE_PERIOD);
      }, this.timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        const duration = Math.round(performance.now() - start);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        if (killed) {
          this.logger.error(`Claude 타임아웃 stderr(앞 2000자): ${stderr.slice(0, 2000)}`);
          reject(new AgentTimeoutError("Claude", this.timeout));
          return;
        }

        if (code !== 0 && code !== null) {
          // 진단성: claude CLI의 실제 stderr(인증/권한/파라미터 오류 등)를 사용자가 즉시 볼 수 있게 노출
          this.logger.error(`Claude 실패 stderr(앞 2000자): ${stderr.slice(0, 2000)}`);
          reject(new AgentProcessError("Claude", code, stderr));
          return;
        }

        resolve({ stdout, stderr, exitCode: code ?? 0, duration });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(new AgentProcessError("Claude", -1, error.message));
      });
    });
  }

  private async validateArtifacts(paths: string[]): Promise<void> {
    for (const artifactPath of paths) {
      try {
        await fs.access(artifactPath);
      } catch {
        throw new AgentOutputError("Claude", `기획 산출물이 생성되지 않았습니다: ${artifactPath}`);
      }
    }
  }

  private tryParseJson(stdout: string): import("../types/review.js").ReviewJsonOutput | null {
    // 1. ```json ... ``` 블록 추출
    const jsonBlockMatch = stdout.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
      try {
        return JSON.parse(jsonBlockMatch[1]) as import("../types/review.js").ReviewJsonOutput;
      } catch {
        // 다음 방법 시도
      }
    }

    // 2. { "status": ... } 패턴 매칭
    const objectMatch = stdout.match(/\{[\s\S]*"status"\s*:[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]) as import("../types/review.js").ReviewJsonOutput;
      } catch {
        // 파싱 실패
      }
    }

    return null;
  }
}
