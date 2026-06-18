/**
 * CodexAgent (C-09) - Codex CLI 기반 구현 에이전트
 * NFR: Safe Spawn (shell: false), full-auto 모드, 파일 참조
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ImplementRequest,
  ImplementResult,
  ImplementationAgent,
  ProcessResult,
} from "../types/agent.js";
import { MAX_STDOUT_CAPTURE } from "../types/agent.js";
import { AgentTimeoutError, AgentProcessError } from "../types/errors.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const SIGTERM_GRACE_PERIOD = 5000;

export class CodexAgent implements ImplementationAgent {
  constructor(
    private readonly logger: Logger,
    private readonly timeout: number = 600_000,
  ) {}

  /**
   * 구현 단계 실행
   * - inlineSpec 우선, 없으면 implementationSpecPath 파일에서 읽기
   * - 둘 다 없으면 즉시 에러
   */
  async implement(request: ImplementRequest): Promise<ImplementResult> {
    // 1) 명세 본문 확보 (inline 우선)
    let specContent: string;
    let specSourceLabel: string;
    if (request.inlineSpec && request.inlineSpec.trim().length > 0) {
      specContent = request.inlineSpec;
      specSourceLabel = request.inlineSpecSource ?? "(inline)";
      this.logger.debug(`Codex 인라인 명세 사용 (source=${specSourceLabel}, ${specContent.length}자)`);
    } else if (request.implementationSpecPath) {
      specContent = await fs.readFile(request.implementationSpecPath, "utf-8");
      specSourceLabel = request.implementationSpecPath;
    } else {
      throw new AgentProcessError(
        "Codex",
        -1,
        "구현 명세가 제공되지 않았습니다 (implementationSpecPath 또는 inlineSpec 중 하나 필요)",
      );
    }

    // 2) 명세에서 권장 커밋 메시지 추출 (자동 일괄 메시지 덮어쓰기 방지)
    const suggestedCommitMessage = this.extractCommitMessage(specContent);
    if (suggestedCommitMessage) {
      this.logger.debug(`명세에서 추출한 커밋 메시지: ${suggestedCommitMessage}`);
    }

    const prompt = `다음 구현 명세에 따라 코드를 작성해주세요.

구현 명세 출처: ${specSourceLabel}

명세 내용:
${specContent}

프로젝트 경로에서 직접 파일을 생성/수정하세요.`;

    this.logger.info("Codex 구현 시작");

    const result = await this.executeCodexCli(prompt, request.projectPath);

    this.logger.info("Codex 구현 완료");
    this.logger.debug(`Codex 출력 길이: ${result.stdout.length}자`);

    // 변경된 파일 목록 조회 (git diff)
    const changedFiles = await this.getChangedFiles(request.projectPath);

    return {
      changedFiles,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...(suggestedCommitMessage ? { suggestedCommitMessage } : {}),
    };
  }

  /**
   * 구현 명세 본문에서 권장 커밋 메시지를 추출한다.
   *
   * 인식하는 마크다운 헤딩 패턴 (우선순위 순):
   *   1. "정확한 비즈니스 커밋 메시지" / "비즈니스 커밋 메시지" / "커밋 메시지"
   *   2. 헤딩 바로 아래의 첫 ``` 코드 블록(언어 태그 무관) 내부 첫 비공백 줄
   *
   * 추가로 인라인 패턴도 fallback:
   *   - `커밋 메시지: \`...\`` 또는 `- 커밋 메시지: "..."` 형식
   *
   * 멀티라인 메시지는 첫 줄만 사용 (git -m 단일 줄 호환).
   * 추출 실패 시 undefined.
   */
  private extractCommitMessage(spec: string): string | undefined {
    // 1) 헤딩 + 코드 블록 패턴
    //    각 마크다운 헤딩(`# ... 커밋 메시지 ...`)을 찾고, 다음 헤딩 전까지를 섹션으로 슬라이스한 뒤
    //    그 안의 첫 ```fenced code block``` 첫 비공백 줄을 후보로 삼는다.
    //
    // 우선순위:
    //   (a) "정확한 비즈니스 커밋 메시지" 또는 "비즈니스 커밋 메시지"가 들어간 헤딩
    //   (b) 그 외 일반 "커밋 메시지" 헤딩 — 단, "메타" / "워크플로우" / "chore" / "권장 포맷"
    //       같은 비-비즈니스 키워드가 포함된 헤딩은 건너뛴다.
    const lines = spec.split(/\r?\n/);
    const headingRe = /^#{1,6}\s+(.*)$/;
    const targetRe = /커밋\s*메시지/;
    const businessRe = /(?:정확한|비즈니스)/;
    const metaSkipRe = /(?:메타|워크플로우|workflow|권장\s*포맷|예시|샘플)/i;

    // 헤딩 인덱스 + 텍스트 수집
    type H = { idx: number; text: string };
    const headings: H[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = (lines[i] ?? "").match(headingRe);
      if (m) headings.push({ idx: i, text: m[1] ?? "" });
    }

    const tryExtractFromHeading = (i: number): string | undefined => {
      const h = headings[i];
      if (!h) return undefined;
      const end = headings[i + 1]?.idx ?? lines.length;
      const section = lines.slice(h.idx + 1, end).join("\n");
      // 언어 태그는 줄 끝까지 허용한다. (Notion round-trip 시 빈 코드펜스가
      // ```plain text``` 처럼 공백 포함 언어 태그로 변환되므로 [a-zA-Z0-9_-]* 로는 매칭 실패)
      const codeBlock = section.match(/```[^\n]*\n([\s\S]*?)```/);
      if (!codeBlock?.[1]) return undefined;
      const firstLine = codeBlock[1]
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (!firstLine) return undefined;
      return this.sanitizeCommitMessage(firstLine);
    };

    // (a) 비즈니스 헤딩 우선
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (!h) continue;
      if (!targetRe.test(h.text)) continue;
      if (!businessRe.test(h.text)) continue;
      const v = tryExtractFromHeading(i);
      if (v) return v;
    }

    // (b) 일반 커밋 메시지 헤딩 (메타/예시 키워드 제외)
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (!h) continue;
      if (!targetRe.test(h.text)) continue;
      if (metaSkipRe.test(h.text)) continue;
      const v = tryExtractFromHeading(i);
      if (v) return v;
    }

    // 2) 인라인 패턴: "커밋 메시지: `docs: ...`" 또는 "커밋 메시지: \"...\""
    const inlineRegex =
      /커밋\s*메시지\s*[:：]\s*[`"'\u201C\u2018]([^`"'\u201D\u2019\n]+)[`"'\u201D\u2019]/;
    const inlineMatch = spec.match(inlineRegex);
    if (inlineMatch?.[1]) {
      return this.sanitizeCommitMessage(inlineMatch[1]);
    }

    return undefined;
  }

  /**
   * 커밋 메시지 sanitization.
   * - 양끝 공백/제어 문자 제거
   * - 줄바꿈은 첫 줄로 한정
   * - 200자로 truncate (git subject 안전 한도)
   * - 빈 문자열은 undefined 처리
   */
  private sanitizeCommitMessage(raw: string): string | undefined {
    const firstLine = raw.split(/\r?\n/)[0] ?? "";
    // eslint-disable-next-line no-control-regex
    const cleaned = firstLine.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (cleaned.length === 0) return undefined;
    return cleaned.slice(0, 200);
  }

  /**
   * Codex CLI 실행 (shell: false, full-auto)
   */
  private executeCodexCli(prompt: string, cwd: string): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      // codex CLI 0.130.0+ 에서는 비대화형 모드가 'exec' 서브커맨드로 분리됐고,
      // --approval-mode full-auto 는 --dangerously-bypass-approvals-and-sandbox 로 대체됨.
      // -C <cwd> 를 명시해 codex 내부 워크스페이스 인식을 명확히 한다.
      const args = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        cwd,
        prompt,
      ];

      const start = performance.now();
      const proc = spawn("codex", args, {
        cwd,
        shell: false,
        // codex -q 비대화형 모드도 stdin이 pipe로 열려 있으면 입력 대기로 행걸릴 수 있음.
        // 프롬프트는 -q 인자로 전달하므로 stdin은 명시적으로 닫는다.
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
          this.logger.error(`Codex 타임아웃 stderr(앞 2000자): ${stderr.slice(0, 2000)}`);
          reject(new AgentTimeoutError("Codex", this.timeout));
          return;
        }

        if (code !== 0 && code !== null) {
          // 진단성: codex CLI의 실제 stderr(인증 만료, 모델 오류 등)를 사용자가 즉시 볼 수 있게 노출
          this.logger.error(`Codex 실패 stderr(앞 2000자): ${stderr.slice(0, 2000)}`);
          reject(new AgentProcessError("Codex", code, stderr));
          return;
        }

        resolve({ stdout, stderr, exitCode: code ?? 0, duration });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(new AgentProcessError("Codex", -1, error.message));
      });
    });
  }

  /**
   * Git diff로 변경된 파일 목록 조회
   */
  private async getChangedFiles(projectPath: string): Promise<string[]> {
    try {
      // unstaged + untracked 파일 모두 포함
      const { stdout } = await execFileAsync(
        "git",
        ["status", "--porcelain"],
        { cwd: projectPath, timeout: 10_000 },
      );

      return stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => line.slice(3).trim())
        .filter((file) => file.length > 0);
    } catch (error) {
      this.logger.warn(`변경 파일 목록 조회 실패: ${(error as Error).message}`);
      return [];
    }
  }
}
