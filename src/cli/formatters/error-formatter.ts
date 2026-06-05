/**
 * 에러 포매팅 - 사용자 친화적 에러 메시지 생성
 */

import { AppError, ERROR_HINTS } from "../../types/errors.js";

export function formatError(error: unknown, verbose: boolean = false): string {
  if (error instanceof AppError) {
    const icon = error.severity === "critical" ? "\u274C" : "\u26A0\uFE0F";
    const hint = ERROR_HINTS[error.code];
    let message = `${icon} ${error.message}`;

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
