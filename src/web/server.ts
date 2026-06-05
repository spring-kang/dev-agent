/**
 * WebServer - Express + Socket.IO 기반 웹 서버
 * CLI의 'serve' 커맨드에서 시작되며 프론트엔드와 통신
 */

import { createServer, type Server as HttpServer } from "node:http";
import express, { type Express } from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";
import type { WorkflowService } from "../services/workflow.service.js";
import type { ConfigManager } from "../components/config-manager.js";
import type { WorkspaceManager } from "../components/workspace-manager.js";
import type { Logger } from "../components/logger.js";
import type { EventEmitter } from "node:events";
import type { NotionConfigManager } from "../integrations/notion-config.js";
import { createWorkflowRoutes } from "./routes/workflows.js";
import { createConfigRoutes } from "./routes/config.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createNotionRoutes } from "./routes/notion.js";
import { SocketBridge } from "./socket-bridge.js";

export interface WebServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
}

const DEFAULT_WEB_CONFIG: WebServerConfig = {
  port: 3001,
  host: "localhost",
  corsOrigin: "http://localhost:3000",
};

export class WebServer {
  private app: Express;
  private httpServer: HttpServer;
  private io: SocketServer;
  private socketBridge: SocketBridge;
  private config: WebServerConfig;

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly configManager: ConfigManager,
    private readonly workspaceManager: WorkspaceManager,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
    config?: Partial<WebServerConfig>,
    private readonly notionConfig?: NotionConfigManager,
  ) {
    this.config = { ...DEFAULT_WEB_CONFIG, ...config };

    // Express 설정
    this.app = express();
    this.app.use(cors({ origin: this.config.corsOrigin }));
    this.app.use(express.json());

    // HTTP + Socket.IO
    this.httpServer = createServer(this.app);
    this.io = new SocketServer(this.httpServer, {
      cors: { origin: this.config.corsOrigin, methods: ["GET", "POST"] },
    });

    // Socket Bridge 연결
    this.socketBridge = new SocketBridge(this.io, this.eventEmitter, this.logger);

    // 라우트 등록
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  private setupRoutes(): void {
    // 헬스체크
    this.app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", uptime: process.uptime() });
    });

    // 워크플로우 API
    this.app.use(
      "/api/workflows",
      createWorkflowRoutes(this.workflowService, this.logger),
    );

    // 설정 API
    this.app.use(
      "/api/config",
      createConfigRoutes(this.configManager, this.logger),
    );

    // 프로젝트 API
    this.app.use(
      "/api/projects",
      createProjectRoutes(this.workspaceManager, this.logger),
    );

    // Notion 통합 API - notionConfig가 주입된 경우에만
    if (this.notionConfig) {
      this.app.use(
        "/api/integrations/notion",
        createNotionRoutes(
          this.workflowService,
          this.notionConfig,
          this.logger,
        ),
      );
    }
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      this.logger.debug(`WebSocket 연결: ${socket.id}`);

      socket.on("disconnect", () => {
        this.logger.debug(`WebSocket 해제: ${socket.id}`);
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          `웹 서버 시작: http://${this.config.host}:${this.config.port}`,
        );
        this.socketBridge.start();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.socketBridge.stop();
    return new Promise((resolve, reject) => {
      this.io.close();
      this.httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info("웹 서버 종료");
          resolve();
        }
      });
    });
  }
}
