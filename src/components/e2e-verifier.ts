/**
 * E2eVerifier (C-10) - Playwright 등 e2e 테스트 실행기
 *
 * build 파이프라인에서 리뷰가 APPROVED 된 직후, PR 생성 직전에 호출된다.
 * - 실제 동작하는 애플리케이션(base URL)을 대상으로 e2e 명령을 실행해 게이트한다.
 * - NFR: Safe Spawn (shell: false), 타임아웃, 출력 캡처 상한.
 *
 * 검증 대상 URL 은 셸이 아닌 환경변수(PLAYWRIGHT_BASE_URL / BASE_URL / E2E_BASE_URL)로
 * 주입한다. Playwright 는 `use.baseURL` 을 PLAYWRIGHT_BASE_URL 로 오버라이드하는 관례를 따른다.
 */

import { spawn } from "node:child_process";
import type { E2eVerifyRequest, E2eResult, ParsedCommand } from "../types/e2e.js";
import type { ReviewResult } from "../types/review.js";
import { MAX_STDOUT_CAPTURE } from "../types/agent.js";
import { AppError } from "../types/errors.js";
import type { Logger } from "./logger.js";

const SIGTERM_GRACE_PERIOD = 5000;
/** e2e 실패 피드백에 포함할 출력 길이 상한 (리뷰 피드백이 과하게 커지는 것 방지) */
const FEEDBACK_OUTPUT_LIMIT = 4000;

/**
 * E2E 실행이 인프라/설정 문제로 시작조차 못한 경우(예: 명령 미존재)에 던지는 에러.
 * 테스트 실패(exitCode!=0)와 구분하기 위함.
 */
export class E2eExecutionError extends AppError {
  readonly code = "E2E_EXECUTION_ERROR";
  readonly severity = "critical" as const;
}

export class E2eVerifier {
  constructor(private readonly logger: Logger) {}

  /**
   * e2e 명령 문자열을 shell 없이 실행하기 위한 argv 로 분해한다.
   * - 단순 공백 분리(따옴표 그룹/이스케이프는 지원하지 않음 — 설정 검증에서 셸 메타문자를 막음).
   * - 빈 토큰은 제거.
   */
  static parseCommand(command: string): ParsedCommand {
    const tokens = command
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) {
      throw new E2eExecutionError("e2eCommand 가 비어 있습니다");
    }
    const [file, ...args] = tokens;
    return { file: file as string, args };
  }

  /**
   * e2e 실패 결과를 리뷰 파이프라인이 이해하는 합성 ReviewResult(CHANGES_REQUESTED)로 변환한다.
   * - orchestrator 는 이 값을 previousFeedback 으로 삼아 Codex 가 다음 사이클에 수정하도록 한다.
   */
  static buildFeedbackFromFailure(result: E2eResult, url: string): ReviewResult {
    const reason = result.timedOut
      ? `타임아웃(${result.duration}ms)`
      : `종료 코드 ${result.exitCode ?? "null"}`;
    const tail = (s: string): string =>
      s.length > FEEDBACK_OUTPUT_LIMIT ? s.slice(-FEEDBACK_OUTPUT_LIMIT) : s;
    const output = [tail(result.stdout), tail(result.stderr)]
      .filter((s) => s.trim().length > 0)
      .join("\n---\n");

    return {
      status: "CHANGES_REQUESTED",
      checks: [
        {
          name: "tests",
          passed: false,
          details: `E2E(Playwright) 검증 실패 — ${reason}${url ? ` (대상: ${url})` : ""}`,
        },
      ],
      findings: [
        {
          severity: "critical",
          location: url || "(e2e)",
          description:
            `E2E 테스트가 실패하여 PR 생성을 보류했습니다.\n` +
            (output.length > 0 ? `실행 출력(말미):\n${output}` : "(출력 없음)"),
          suggestion:
            "실패한 e2e 시나리오의 원인(렌더링/네비게이션/API 연동 등)을 수정하세요. " +
            "변경 후 동일 검증이 다시 실행됩니다.",
        },
      ],
      summary: `E2E 검증 실패(${reason})로 PR 생성을 보류합니다.`,
      recommendation: "partial",
    };
  }

  /**
   * e2e 검증 실행.
   * - 종료 코드 0 → passed=true.
   * - 명령 자체를 실행하지 못하면 E2eExecutionError.
   */
  async verify(request: E2eVerifyRequest): Promise<E2eResult> {
    const { file, args } = E2eVerifier.parseCommand(request.command);

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (request.url) {
      env["PLAYWRIGHT_BASE_URL"] = request.url;
      env["BASE_URL"] = request.url;
      env["E2E_BASE_URL"] = request.url;
    }
    // CI 환경처럼 동작하도록 강제(불필요한 watch/UI 모드 방지)
    env["CI"] = env["CI"] ?? "true";

    this.logger.info(
      `E2E 검증 시작: ${request.command}${request.url ? ` (base=${request.url})` : ""}`,
    );

    return new Promise<E2eResult>((resolve, reject) => {
      const start = performance.now();
      const proc = spawn(file, args, {
        cwd: request.projectPath,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let timedOut = false;

      proc.stdout.on("data", (chunk: Buffer) => {
        if (stdoutSize < MAX_STDOUT_CAPTURE) {
          stdoutChunks.push(chunk);
          stdoutSize += chunk.length;
        }
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, SIGTERM_GRACE_PERIOD);
      }, request.timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        const duration = Math.round(performance.now() - start);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const passed = !timedOut && code === 0;

        if (passed) {
          this.logger.info(`E2E 검증 통과 (${duration}ms)`);
        } else if (timedOut) {
          this.logger.warn(`E2E 검증 타임아웃 (${request.timeout}ms)`);
        } else {
          this.logger.warn(`E2E 검증 실패 (exit=${code})`);
        }

        resolve({ passed, exitCode: code, timedOut, stdout, stderr, duration });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        // 명령 미존재(ENOENT) 등 실행 자체 실패는 테스트 실패와 구분해 에러로 전파.
        reject(
          new E2eExecutionError(
            `E2E 명령 실행 실패: ${file} (${(error as Error).message})`,
          ),
        );
      });
    });
  }
}
