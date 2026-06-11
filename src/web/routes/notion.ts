/**
 * Notion 통합 REST API 라우트
 * 마운트 경로: /api/integrations/notion
 */

import { Router, type Request, type Response } from "express";
import type { WorkflowService } from "../../services/workflow.service.js";
import type { NotionConfigManager } from "../../integrations/notion-config.js";
import type { Logger } from "../../components/logger.js";
import type { WorkflowConfig } from "../../types/config.js";

export function createNotionRoutes(
  workflowService: WorkflowService,
  notionConfig: NotionConfigManager,
  logger: Logger,
): Router {
  const router = Router();

  /**
   * GET /api/integrations/notion/status
   * 마스킹된 인증 상태
   */
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const masked = await notionConfig.showMasked();
      res.json(masked.notion);
    } catch (error) {
      logger.error(`Notion 상태 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/integrations/notion/config
   * Body: { token: string, defaultDatabaseId?: string }
   */
  router.post("/config", async (req: Request, res: Response) => {
    try {
      const { token, defaultDatabaseId } = req.body as {
        token?: string;
        defaultDatabaseId?: string;
      };

      if (!token || typeof token !== "string" || token.trim().length === 0) {
        res.status(400).json({ error: "token은 필수입니다" });
        return;
      }

      await notionConfig.setNotion(
        { integrationToken: token.trim() },
        defaultDatabaseId ? { defaultDatabaseId } : undefined,
      );

      const masked = await notionConfig.showMasked();
      res.json({ message: "Notion 인증이 저장되었습니다", notion: masked.notion });
    } catch (error) {
      logger.error(`Notion 인증 저장 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * DELETE /api/integrations/notion/config
   */
  router.delete("/config", async (_req: Request, res: Response) => {
    try {
      await notionConfig.clearNotion();
      res.json({ message: "Notion 인증이 제거되었습니다" });
    } catch (error) {
      logger.error(`Notion 인증 제거 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/integrations/notion/test
   * 저장된 토큰으로 /users/me 호출
   */
  router.post("/test", async (_req: Request, res: Response) => {
    try {
      const cfg = await notionConfig.getNotion();
      if (!cfg) {
        res.status(400).json({ error: "Notion 인증이 설정되지 않았습니다" });
        return;
      }
      const { NotionClient } = await import("../../integrations/notion-client.js");
      const client = new NotionClient(cfg.auth, logger, cfg.propertyMapping);
      const me = await client.verifyAuth();
      res.json({ ok: true, bot: me });
    } catch (error) {
      logger.warn(`Notion 인증 테스트 실패: ${(error as Error).message}`);
      res.status(400).json({ ok: false, error: (error as Error).message });
    }
  });

  /**
   * GET /api/integrations/notion/tasks
   * Query: { db?, status?, max? }
   */
  router.get("/tasks", async (req: Request, res: Response) => {
    try {
      const cfg = await notionConfig.getNotion();
      if (!cfg) {
        res.status(400).json({ error: "Notion 인증이 설정되지 않았습니다" });
        return;
      }

      const dbId =
        (req.query["db"] as string | undefined) ?? cfg.defaultDatabaseId;
      if (!dbId) {
        res.status(400).json({
          error:
            "database ID가 필요합니다. ?db=<id> 또는 defaultDatabaseId 설정 필요",
        });
        return;
      }

      const status = req.query["status"] as string | undefined;
      const maxRaw = req.query["max"] as string | undefined;
      const max = maxRaw ? Math.max(1, Math.min(100, parseInt(maxRaw, 10))) : 50;

      const { NotionClient } = await import("../../integrations/notion-client.js");
      const client = new NotionClient(cfg.auth, logger, cfg.propertyMapping);

      const tasks = await client.queryDatabase(dbId, {
        pageSize: max,
        ...(status ? { status } : {}),
      });

      res.json({ tasks, count: tasks.length });
    } catch (error) {
      logger.error(`Notion task 목록 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/integrations/notion/tasks/:pageId
   * 단일 task 상세 (본문 + 참조 페이지 포함)
   */
  router.get("/tasks/:pageId", async (req: Request, res: Response) => {
    try {
      const cfg = await notionConfig.getNotion();
      if (!cfg) {
        res.status(400).json({ error: "Notion 인증이 설정되지 않았습니다" });
        return;
      }

      const pageId = req.params["pageId"];
      if (!pageId) {
        res.status(400).json({ error: "pageId가 필요합니다" });
        return;
      }

      const { NotionClient } = await import("../../integrations/notion-client.js");
      const client = new NotionClient(cfg.auth, logger, cfg.propertyMapping);
      const task = await client.getTask(String(pageId));
      if (!task) {
        res.status(404).json({ error: "Task를 찾을 수 없습니다" });
        return;
      }
      res.json(task);
    } catch (error) {
      logger.error(`Notion task 상세 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/integrations/notion/run
   * Body: { pageId, projectPath?, config?, skipClaudeEnhancement? }
   * Notion task 기반 워크플로우 시작
   */
  router.post("/run", async (req: Request, res: Response) => {
    try {
      const { pageId, projectPath, config } = req.body as {
        pageId?: string;
        projectPath?: string;
        config?: Partial<WorkflowConfig>;
      };

      if (!pageId || typeof pageId !== "string") {
        res.status(400).json({ error: "pageId는 필수입니다" });
        return;
      }

      const promise = workflowService.executeBuildFromNotion(pageId, {
        ...(projectPath ? { projectPath } : {}),
        ...(config ? { cliOverrides: config } : {}),
      });

      res.status(202).json({
        message: "Notion 기반 개발 워크플로우가 시작되었습니다 (Status=Approved 검증 후)",
        pageId,
      });

      promise.catch((error) => {
        logger.error(
          `Notion 워크플로우 실행 실패 (${pageId}): ${(error as Error).message}`,
        );
      });
    } catch (error) {
      logger.error(`Notion run 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
