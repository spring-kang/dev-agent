/**
 * 프로젝트 REST API 라우트
 */

import { Router, type Request, type Response } from "express";
import type { WorkspaceManager } from "../../components/workspace-manager.js";
import type { Logger } from "../../components/logger.js";

export function createProjectRoutes(
  workspaceManager: WorkspaceManager,
  logger: Logger,
): Router {
  const router = Router();

  /**
   * GET /api/projects - 프로젝트 목록 조회
   * Query: { basePath? }
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const basePath = (req.query["basePath"] as string) ?? process.cwd();
      const projects = await workspaceManager.listProjects(basePath);
      res.json({ projects });
    } catch (error) {
      logger.error(`프로젝트 목록 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/validate - 프로젝트 검증
   * Body: { projectPath }
   */
  router.post("/validate", async (req: Request, res: Response) => {
    try {
      const { projectPath } = req.body as { projectPath: string };

      if (!projectPath) {
        res.status(400).json({ error: "projectPath는 필수입니다" });
        return;
      }

      const validation = await workspaceManager.validateProject(projectPath);
      res.json(validation);
    } catch (error) {
      logger.error(`프로젝트 검증 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/projects/prerequisites - 필수 도구 확인
   */
  router.get("/prerequisites", async (_req: Request, res: Response) => {
    try {
      const result = await workspaceManager.checkPrerequisites();
      res.json(result);
    } catch (error) {
      logger.error(`필수 도구 확인 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
