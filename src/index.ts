#!/usr/bin/env node

/**
 * dev-agent - AI-powered development pipeline orchestrator
 * 진입점: CLI 초기화 + SIGINT 핸들링
 */

import { createContainerAsync } from "./container.js";

async function main(): Promise<void> {
  const { cli, logger } = await createContainerAsync();

  // Graceful Shutdown 처리
  let sigintCount = 0;
  let lastSigintTime = 0;

  process.on("SIGINT", () => {
    const now = Date.now();

    if (now - lastSigintTime < 1000) {
      // 1초 내 두 번째 SIGINT → 강제 종료
      logger.warn("강제 종료합니다.");
      process.exit(1);
    }

    sigintCount++;
    lastSigintTime = now;

    logger.info("\n중단 요청을 받았습니다. 상태를 저장하는 중...");
    logger.info("상태가 저장되었습니다. 'dev-agent resume'로 재시작 가능합니다.");
    process.exit(0);
  });

  // 미처리 에러 핸들링
  process.on("unhandledRejection", (reason) => {
    logger.error(`미처리 Promise 거부: ${String(reason)}`);
    process.exitCode = 1;
  });

  process.on("uncaughtException", (error) => {
    logger.error(`미처리 예외: ${error.message}`);
    process.exitCode = 1;
  });

  await cli.run(process.argv);
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${(error as Error).message}\n`);
  process.exit(1);
});
