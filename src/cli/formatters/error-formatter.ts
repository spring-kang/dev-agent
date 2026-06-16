/**
 * 에러 포매팅 - 사용자 친화적 에러 메시지 생성
 */

import { AppError, ERROR_HINTS } from "../../types/errors.js";

export function formatError(error: unknown, verbose: boolean = false): string {
  if (error instanceof AppError) {
    const icon = error.severity === "critical" ? "\u274C" : "\u26A0\uFE0F";
    const hint = ERROR_HINTS[error.code];
    let message = `${icon} ${error.message}`;

    // 실제 원인(예: gh/git이 출력한 stderr)을 함께 노출한다.
    // 고정 힌트만으로는 진단이 어려운 경우(예: 인증은 정상인데 PR 생성 실패)를 방지.
    const stderr = extractStderr(error);
    if (stderr) {
      message += `\n  \uD83D\uDD0E 원인: ${stderr}`;
    }

    if (hint) {
      message += `\n  \uD83D\uDCA1 ${hint}`;
    }

    if (verbose && error.stack) {
      message += `\n\n--- Stack Trace ---\n${error.stack}`;
      if (error.cause) {
        message += `\n\nCaused by: ${error.cause.message}`;
      }
    }

    return message;
  }

  if (error instanceof Error) {
    let message = `\u274C 예상치 못한 오류가 발생했습니다: ${error.message}`;
    if (verbose && error.stack) {
      message += `\n\n--- Stack Trace ---\n${error.stack}`;
    }
    return message;
  }

  return `\u274C 알 수 없는 오류: ${String(error)}`;
}

/**
 * AppError에 담긴 stderr(gh/git의 실제 출력)를 안전하게 추출한다.
 * - GitError / GitPushError / GitPrError 등 stderr 필드를 가진 에러를 모두 커버.
 * - 빈 문자열/공백만 있으면 undefined 반환.
 * - 과도하게 긴 출력은 잘라낸다.
 */
function extractStderr(error: AppError): string | undefined {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr !== "string") {
    return undefined;
  }
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const MAX_STDERR_LENGTH = 1_000;
  return trimmed.length > MAX_STDERR_LENGTH
    ? `${trimmed.slice(0, MAX_STDERR_LENGTH)}…(생략)`
    : trimmed;
}
