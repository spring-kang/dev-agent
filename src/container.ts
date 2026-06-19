/**
 * DI Composition Root - 의존성 조립
 * 빌드 순서: U-01 → U-02 → U-04 → U-03 → U-05 → U-06(Notion Integration)
 */

import { EventEmitter } from "node:events";
import { Logger, type LogConfig } from "./components/logger.js";
import { ConfigManager } from "./components/config-manager.js";
import { WorkspaceManager } from "./components/workspace-manager.js";
import { StateManager } from "./components/state-manager.js";
import { ClaudeAgent } from "./components/claude-agent.js";
import { CodexAgent } from "./components/codex-agent.js";
import { GitManager } from "./components/git-manager.js";
import { GitService } from "./services/git.service.js";
import { ReviewEngine } from "./components/review-engine.js";
import { PipelineService } from "./services/pipeline.service.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { MonitoringService } from "./services/monitoring.service.js";
import { WorkflowService } from "./services/workflow.service.js";
import { CLI } from "./cli/cli.js";
import { NotionConfigManager } from "./integrations/notion-config.js";
import { NotionClient } from "./integrations/notion-client.js";
import { NotionStatusSync } from "./integrations/notion-status-sync.js";
import { NotionBlockAppender } from "./integrations/notion-block-appender.js";
import { NotionArtifactSync } from "./integrations/notion-artifact-sync.js";
import { NotionFollowUpService } from "./integrations/notion-follow-up-service.js";

export interface Container {
  cli: CLI;
  logger: Logger;
}

/**
 * 웹 서버용 확장 컨테이너
 * CLI 외에 웹 서버가 필요로 하는 서비스를 노출
 */
export interface WebContainer extends Container {
  workflowService: WorkflowService;
  configManager: ConfigManager;
  workspaceManager: WorkspaceManager;
  eventEmitter: EventEmitter;
  notionConfig: NotionConfigManager;
}

/**
 * 비동기 통합 서비스 조립 결과
 */
interface IntegrationServices {
  notionConfig: NotionConfigManager;
  notionClient?: NotionClient;
  notionStatusSync?: NotionStatusSync;
  notionArtifactSync?: NotionArtifactSync;
  notionFollowUpService?: NotionFollowUpService;
}

/**
 * Notion 통합 비동기 조립 (Notion 토큰이 저장되어 있을 때만 활성화)
 */
async function assembleIntegrations(
  logger: Logger,
  eventEmitter: EventEmitter,
): Promise<IntegrationServices> {
  const notionConfig = new NotionConfigManager(logger);

  try {
    const cfg = await notionConfig.getNotion();
    if (!cfg) {
      return { notionConfig };
    }

    const notionClient = new NotionClient(cfg.auth, logger, cfg.propertyMapping);
    const notionStatusSync = new NotionStatusSync(
      notionClient,
      eventEmitter,
      logger,
      cfg.statusMapping,
    );
    const notionBlockAppender = new NotionBlockAppender(cfg.auth, logger);
    const notionArtifactSync = new NotionArtifactSync(
      notionBlockAppender,
      eventEmitter,
      logger,
    );
    const notionFollowUpService = new NotionFollowUpService(
      notionClient,
      notionBlockAppender,
      logger,
    );

    return {
      notionConfig,
      notionClient,
      notionStatusSync,
      notionArtifactSync,
      notionFollowUpService,
    };
  } catch (error) {
    logger.warn(`Notion 통합 조립 실패: ${(error as Error).message}`);
    return { notionConfig };
  }
}

export async function createContainer(): Promise<Container> {
  const { logger, workflowService, configManager, workspaceManager } = await buildCore();
  const cli = new CLI(workflowService, configManager, workspaceManager, logger);
  return { cli, logger };
}

/**
 * 비동기 컨테이너 생성 (Notion 통합 포함)
 */
export async function createContainerAsync(): Promise<Container> {
  const core = await buildCore();
  const integrations = await assembleIntegrations(core.logger, core.eventEmitter);

  // 통합 서비스를 WorkflowService에 주입한 새 인스턴스
  const workflowService = new WorkflowService(
    core.orchestrator,
    core.configManager,
    core.workspaceManager,
    core.stateManager,
    core.gitManager,
    core.monitoringService,
    core.logger,
    core.eventEmitter,
    integrations.notionStatusSync,
    integrations.notionArtifactSync,
    integrations.notionClient,
    integrations.notionFollowUpService,
  );

  const cli = new CLI(
    workflowService,
    core.configManager,
    core.workspaceManager,
    core.logger,
    integrations.notionConfig,
    integrations.notionClient,
  );
  return { cli, logger: core.logger };
}

/**
 * 웹 서버용 컨테이너 생성 (비동기 - Notion 통합 포함)
 */
export async function createWebContainer(): Promise<WebContainer> {
  const core = await buildCore();
  const integrations = await assembleIntegrations(core.logger, core.eventEmitter);

  const workflowService = new WorkflowService(
    core.orchestrator,
    core.configManager,
    core.workspaceManager,
    core.stateManager,
    core.gitManager,
    core.monitoringService,
    core.logger,
    core.eventEmitter,
    integrations.notionStatusSync,
    integrations.notionArtifactSync,
    integrations.notionClient,
    integrations.notionFollowUpService,
  );

  const cli = new CLI(
    workflowService,
    core.configManager,
    core.workspaceManager,
    core.logger,
    integrations.notionConfig,
    integrations.notionClient,
  );

  return {
    cli,
    logger: core.logger,
    workflowService,
    configManager: core.configManager,
    workspaceManager: core.workspaceManager,
    eventEmitter: core.eventEmitter,
    notionConfig: integrations.notionConfig,
  };
}

// ── 내부: 공통 코어 빌드 ──

interface CoreServices {
  logger: Logger;
  configManager: ConfigManager;
  workspaceManager: WorkspaceManager;
  stateManager: StateManager;
  gitManager: GitManager;
  orchestrator: Orchestrator;
  monitoringService: MonitoringService;
  workflowService: WorkflowService;
  eventEmitter: EventEmitter;
}

async function buildCore(): Promise<CoreServices> {
  // ── Phase 1: U-01 Core Infrastructure ──
  const logConfig: LogConfig = {
    level: "info",
    noColor: process.env["NO_COLOR"] !== undefined,
  };
  const logger = new Logger(logConfig);
  const configManager = new ConfigManager();
  const workspaceManager = new WorkspaceManager(logger);
  const stateManager = new StateManager(logger);

  // ── Phase 2: U-02 Agent Integration ──
  // 전역 설정에서 agent timeout 읽기 (project별 override는 phase 실행 시점에서는 적용 불가)
  const globalConfig = await configManager.load();
  const claudeTimeout = globalConfig.value.claudeTimeout;
  const codexTimeout = globalConfig.value.codexTimeout;
  const reviewModel = globalConfig.value.reviewModel;
  const claudeAgent = new ClaudeAgent(logger, claudeTimeout, reviewModel);
  const codexAgent = new CodexAgent(logger, codexTimeout);

  // ── Phase 3: U-04 Git & PR ──
  const gitManager = new GitManager(logger);
  const gitService = new GitService(gitManager, logger);

  // ── Phase 4: U-03 Domain Logic ──
  const reviewEngine = new ReviewEngine();
  const eventEmitter = new EventEmitter();
  const pipelineService = new PipelineService(
    claudeAgent,
    codexAgent,
    gitManager,
    reviewEngine,
    stateManager,
    eventEmitter,
    logger,
  );
  const orchestrator = new Orchestrator(
    pipelineService,
    gitService,
    stateManager,
    reviewEngine,
    eventEmitter,
    logger,
  );

  // ── Phase 5: U-05 CLI & Workflow ──
  const monitoringService = new MonitoringService(eventEmitter, logger);
  const workflowService = new WorkflowService(
    orchestrator,
    configManager,
    workspaceManager,
    stateManager,
    gitManager,
    monitoringService,
    logger,
    eventEmitter,
  );

  return {
    logger,
    configManager,
    workspaceManager,
    stateManager,
    gitManager,
    orchestrator,
    monitoringService,
    workflowService,
    eventEmitter,
  };
}
