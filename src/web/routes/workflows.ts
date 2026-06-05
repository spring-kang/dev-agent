/**
 * 워크플로우 REST API 라우트
 */

import { Router, type Request, type Response } from "express";
import type { WorkflowService } from "../../services/workflow.service.js";
import type { Logger } from "../../components/logger.js";
import type { WorkflowConfig } from "../../types/config.js";

export function createWorkflowRoutes(
  workflowService: WorkflowService,
  logger: Logger,
): Router {
  const router = Router();

  /**
   * POST /api/workflows - 워크플로우 시작
   * Body: { projectPath, taskDescription, config? }
   */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { projectPath, taskDescription, config } = req.body as {
        projectPath: string;
        taskDescription: string;
        config?: Partial<WorkflowConfig>;
      };

      if (!projectPath || !taskDescription) {
        res.status(400).json({
          error: "projectPath와 taskDescription은 필수입니다",
        });
        return;
      }

      // 비동기 실행 (워크플로우는 오래 걸리므로 즉시 응답)
      const promise = workflowService.execute(projectPath, taskDescription, config);

      // 워크플로우 ID는 상태 조회로 확인
      res.status(202).json({
        message: "워크플로우가 시작되었습니다",
        projectPath,
        taskDescription,
      });

      // 비동기로 완료 대기 (에러 로깅만)
      promise.catch((error) => {
        logger.error(`워크플로우 실행 실패: ${(error as Error).message}`);
      });
    } catch (error) {
      logger.error(`워크플로우 시작 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/workflows/status - 워크플로우 상태 조회
   * Query: { projectPath? }
   */
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const projectPath = req.query["projectPath"] as string | undefined;
      const statuses = await workflowService.getStatus(projectPath);
      res.json({ workflows: statuses });
    } catch (error) {
      logger.error(`상태 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/workflows/resume - 워크플로우 재시작
   * Body: { projectPath }
   */
  router.post("/resume", async (req: Request, res: Response) => {
    try {
      const { projectPath } = req.body as { projectPath: string };

      if (!projectPath) {
        res.status(400).json({ error: "projectPath는 필수입니다" });
        return;
      }

      const promise = workflowService.resume(projectPath);

      res.status(202).json({
        message: "워크플로우 재시작 요청됨",
        projectPath,
      });

      promise.catch((error) => {
        logger.error(`워크플로우 재시작 실패: ${(error as Error).message}`);
      });
    } catch (error) {
      logger.error(`워크플로우 재시작 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/workflows/report - 리포트 조회
   */
  router.get("/report", (_req: Request, res: Response) => {
    try {
      const report = workflowService.getReport();
      if (!report) {
        res.status(404).json({ error: "리포트 데이터가 없습니다" });
        return;
      }
      res.json(report);
    } catch (error) {
      logger.error(`리포트 조회 실패: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
