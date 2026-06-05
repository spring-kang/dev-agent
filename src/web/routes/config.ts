/**
 * 설정 REST API 라우트
 */

import { Router, type Request, type Response } from "express";
import type { ConfigManager } from "../../components/config-manager.js";
import type { Logger } from "../../components/logger.js";
import type { WorkflowConfig } from "../../types/config.js";

export function createConfigRoutes(
  configManager: ConfigManager,
  logger: Logger,
): Router {
  const router = Router();

  /**
   * GET /api/config - 전체 설정 조회
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const config = await configManager.show();
      res.json(config);
    } catch (error) {
      logger.error(`설정 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/config/:key - 개별 설정 조회
   */
  router.get("/:key", async (req: Request, res: Response) => {
    try {
      const key = req.params["key"] as keyof WorkflowConfig;
      const result = await configManager.get(key);
      res.json(result);
    } catch (error) {
      logger.error(`설정 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * PUT /api/config/:key - 설정 변경
   * Body: { value }
   */
  router.put("/:key", async (req: Request, res: Response) => {
    try {
      const key = req.params["key"] as keyof WorkflowConfig;
      const { value } = req.body as { value: unknown };

      if (value === undefined) {
        res.status(400).json({ error: "value는 필수입니다" });
        return;
      }

      await configManager.setGlobal(key, value);
      res.json({ key, value, message: "설정이 저장되었습니다" });
    } catch (error) {
      logger.error(`설정 변경 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
