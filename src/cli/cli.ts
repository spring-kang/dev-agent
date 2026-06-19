/**
 * CLI (C-01) - Commander.js 기반 서브커맨드 CLI
 * Notion 통합 버전
 */

import { Command } from "commander";
import * as path from "node:path";
import type { WorkflowService } from "../services/workflow.service.js";
import type { ConfigManager } from "../components/config-manager.js";
import type { WorkspaceManager } from "../components/workspace-manager.js";
import type { Logger } from "../components/logger.js";
import type { NotionConfigManager } from "../integrations/notion-config.js";
import type { NotionClient } from "../integrations/notion-client.js";
import { formatError } from "./formatters/error-formatter.js";
import { formatReportText } from "./formatters/report-formatter.js";
import { loadRC, applyRCToRunOptions, type DevAgentRC } from "./rc-loader.js";

export class CLI {
  private program: Command;
  private verbose = false;
  private rc: DevAgentRC = {};

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly configManager: ConfigManager,
    private readonly workspaceManager: WorkspaceManager,
    private readonly logger: Logger,
    private readonly notionConfig?: NotionConfigManager,
    private readonly notionClient?: NotionClient,
  ) {
    this.program = new Command();
    this.setupProgram();
  }

  async run(argv: string[]): Promise<void> {
    try {
      // 1. 그러파일/환경변수 사전 로딩 (CLI 옵션보다 낮은 우선순위)
      const { rc } = await loadRC();
      this.rc = rc;

      await this.program.parseAsync(argv);
    } catch (error) {
      process.stderr.write(formatError(error, this.verbose) + "\n");
      process.exitCode = 1;
    }
  }

  private setupProgram(): void {
    this.program
      .name("devagent")
      .version("1.0.0")
      .description(
        "AI-powered development pipeline orchestrator\n" +
          "  주요 명령어: build <pageId>, notion (login/test/list/status/pull/push), serve\n" +
          "  기획은 claude 에서 devagent-planner 스킬로 수행합니다 (\"Notion task <pageId> 기획해줘\")",
      )
      .option("--verbose", "상세 로그 출력")
      .option("--no-color", "색상 비활성화")
      .hook("preAction", (thisCommand) => {
        const cliVerbose = thisCommand.opts()["verbose"] === true;
        this.verbose = cliVerbose || this.rc.verbose === true;
      });

    // run 커맨드 (Notion 미사용 일반 모드)
    this.program
      .command("run")
      .description("일반 워크플로우 시작 (Notion 사용 시 `devagent build <pageId>` 권장)")
      .requiredOption("-p, --project <path>", "프로젝트 경로")
      .option("-m, --max-iterations <number>", "최대 반복 횟수", parseInt)
      .option("-c, --config <path>", "설정 파일 경로")
      .argument("<task>", "작업 설명")
      .action(async (task: string, options: Record<string, unknown>) => {
        await this.handleRun(task, options);
      });

    // status 커맨드
    this.program
      .command("status")
      .description("워크플로우 상태 조회")
      .argument("[project]", "프로젝트 경로")
      .option("--json", "JSON 형식 출력")
      .action(async (project: string | undefined, options: Record<string, unknown>) => {
        await this.handleStatus(project, options);
      });

    // resume 커맨드
    this.program
      .command("resume")
      .description("워크플로우 재시작")
      .argument("<project>", "프로젝트 경로")
      .action(async (project: string) => {
        await this.handleResume(project);
      });

    // list 커맨드
    this.program
      .command("list")
      .description("프로젝트 목록 조회")
      .action(async () => {
        await this.handleList();
      });

    // config 커맨드
    const configCmd = this.program.command("config").description("설정 관리");

    configCmd
      .command("show")
      .description("전체 설정 표시")
      .action(async () => {
        await this.handleConfigShow();
      });

    configCmd
      .command("get")
      .description("설정 값 조회")
      .argument("<key>", "설정 키")
      .action(async (key: string) => {
        await this.handleConfigGet(key);
      });

    configCmd
      .command("set")
      .description("설정 값 변경")
      .argument("<key>", "설정 키")
      .argument("<value>", "설정 값")
      .action(async (key: string, value: string) => {
        await this.handleConfigSet(key, value);
      });

    // integrations notion 커맨드
    const integrationsCmd = this.program
      .command("integrations")
      .description("외부 통합 관리 (Notion)");

    const notionCmd = integrationsCmd
      .command("notion")
      .description("Notion 통합 관리");

    notionCmd
      .command("status")
      .description("Notion 통합 상태 표시")
      .action(async () => {
        await this.handleNotionStatus();
      });

    notionCmd
      .command("set")
      .description("Notion Internal Integration Token 저장")
      .requiredOption("--token <token>", "Notion Internal Integration Token (ntn_... / secret_...)")
      .option("--default-db <id>", "기본 Task Database ID")
      .action(async (options: Record<string, unknown>) => {
        await this.handleNotionSet(options);
      });

    notionCmd
      .command("test")
      .description("저장된 Notion 인증 테스트")
      .action(async () => {
        await this.handleNotionTest();
      });

    notionCmd
      .command("tasks")
      .description("Notion DB에서 task 목록 조회")
      .option("--db <id>", "Database ID (생략 시 기본 DB 사용)")
      .option("--status <name>", "상태 필터")
      .option("--max <number>", "최대 개수", parseInt, 20)
      .action(async (options: Record<string, unknown>) => {
        await this.handleNotionListTasks(options);
      });

    notionCmd
      .command("clear")
      .description("저장된 Notion 인증 제거")
      .action(async () => {
        await this.handleNotionClear();
      });

    // serve 커맨드
    this.program
      .command("serve")
      .description("웹 대시보드 서버 시작")
      .option("--port <number>", "API 서버 포트", parseInt)
      .option("--host <hostname>", "바인드 호스트")
      .action(async (options: Record<string, unknown>) => {
        await this.handleServe(options);
      });

    // report 커맨드
    this.program
      .command("report")
      .description("리포트 생성")
      .argument("<project>", "프로젝트 경로")
      .option("-f, --format <type>", "출력 형식 (text/json)", "text")
      .option("-o, --output <path>", "파일 출력 경로")
      .action(async (project: string, options: Record<string, unknown>) => {
        await this.handleReport(project, options);
      });

    // ── 단축 명령어 (alias) ──
    this.setupShortcutCommands();
  }

  /**
   * 자주 쓰는 명령어 alias.
   * - task <id>        → run --task <id>
   * - notion login     → integrations notion set
   * - notion logout    → integrations notion clear
   * - notion test      → integrations notion test
   * - notion list      → integrations notion tasks
   * - notion status    → integrations notion status
   * - rc               → 현재 로드된 .devagentrc 출력
   */
  private setupShortcutCommands(): void {
    // build <pageId> — Status=Approved 검증 → Implementation/Review/PR (단일 진입점)
    this.program
      .command("build")
      .description("승인된 Notion task 기반 개발 실행 (Status=Approved 검증 후 Implementation→Review→PR)")
      .argument("[pageIdOrUrl]", "Notion page ID 또는 URL")
      .option("-p, --project <path>", "프로젝트 경로 (생략 시 rc 또는 Notion 속성)")
      .option("-m, --max-iterations <number>", "최대 반복 횟수", parseInt)
      .option(
        "--no-follow-up",
        "반복 소진/정체로 종료 시 후속 작업 Notion 티켓 자동 생성 비활성화",
      )
      .action(async (pageIdOrUrl: string | undefined, options: Record<string, unknown>) => {
        const taskValue = pageIdOrUrl ?? this.rc.task;
        if (!taskValue) {
          throw new Error(
            "page ID 가 필요합니다. 인자로 전달하거나 .devagentrc.json 의 'task' 키를 설정하세요.",
          );
        }
        await this.handleBuild(taskValue, options);
      });

    // batch-build — Approved task 일괄 빌드 (도메인 간 병렬 / 같은 도메인 순차, git worktree 격리)
    this.program
      .command("batch-build")
      .description(
        "Notion DB의 Approved task를 일괄 빌드 (도메인 간 병렬, 같은 도메인 순차, git worktree 격리)",
      )
      .option("-p, --project <path>", "base 저장소 경로 (생략 시 Notion 'Project Path' 속성)")
      .option("--db <id>", "Notion Database ID (생략 시 기본 DB)")
      .option("-c, --concurrency <number>", "도메인 레인 동시 실행 수", parseInt)
      .option("-m, --max-iterations <number>", "task당 최대 반복 횟수", parseInt)
      .option("--dry-run", "실제 빌드 없이 실행 스케줄(레인/순서)만 출력")
      .option("--keep-worktrees", "빌드 후 임시 worktree를 제거하지 않음 (디버깅용)")
      .action(async (options: Record<string, unknown>) => {
        await this.handleBatchBuild(options);
      });

    // notion <subcommand> — integrations notion의 평탄화 alias
    const notionAliasCmd = this.program
      .command("notion")
      .description("Notion 통합 단축 명령어 (login/logout/test/list/status)");

    notionAliasCmd
      .command("login")
      .description("Notion 토큰 저장 (integrations notion set의 alias)")
      .requiredOption("--token <token>", "Notion Internal Integration Token")
      .option("--default-db <id>", "기본 Task Database ID")
      .action(async (options: Record<string, unknown>) => {
        await this.handleNotionSet(options);
      });

    notionAliasCmd
      .command("logout")
      .description("Notion 인증 제거 (integrations notion clear의 alias)")
      .action(async () => {
        await this.handleNotionClear();
      });

    notionAliasCmd
      .command("test")
      .description("Notion 인증 확인")
      .action(async () => {
        await this.handleNotionTest();
      });

    notionAliasCmd
      .command("status")
      .description("Notion 통합 상태 표시 또는 페이지 Status 변경")
      .argument("[pageIdOrUrl]", "(선택) Status 를 변경할 Notion 페이지")
      .argument("[statusName]", "(선택) 변경할 Status 값 (예: Approved, Done)")
      .action(async (pageIdOrUrl?: string, statusName?: string) => {
        if (pageIdOrUrl && statusName) {
          await this.handleNotionSetStatus(pageIdOrUrl, statusName);
        } else {
          await this.handleNotionStatus();
        }
      });

    notionAliasCmd
      .command("list")
      .description("Notion DB에서 task 목록 조회")
      .option("--db <id>", "Database ID")
      .option("--status <name>", "상태 필터")
      .option("--max <number>", "최대 개수", parseInt, 20)
      .action(async (options: Record<string, unknown>) => {
        await this.handleNotionListTasks(options);
      });

    // pull <pageId> — Notion 페이지 본문을 마크다운으로 stdout/파일로 추출
    notionAliasCmd
      .command("pull")
      .description("Notion 페이지 본문(markdown)을 stdout 또는 파일로 추출")
      .argument("<pageIdOrUrl>", "Notion page ID 또는 URL")
      .option("-o, --output <path>", "파일 경로 (생략 시 stdout)")
      .action(async (pageIdOrUrl: string, options: Record<string, unknown>) => {
        await this.handleNotionPull(pageIdOrUrl, options);
      });

    // push <pageId> --from <file> — 로컬 마크다운을 Notion 페이지 본문에 append/replace
    notionAliasCmd
      .command("push")
      .description("로컬 마크다운 파일을 Notion 페이지 본문에 append (--replace 시 본문 교체)")
      .argument("<pageIdOrUrl>", "Notion page ID 또는 URL")
      .requiredOption("--from <path>", "올릴 마크다운 파일 경로")
      .option("--replace", "기존 본문 블록을 모두 삭제하고 새 내용으로 교체")
      .action(async (pageIdOrUrl: string, options: Record<string, unknown>) => {
        await this.handleNotionPush(pageIdOrUrl, options);
      });

    // comments <pageId> — Notion 페이지 댓글 조회 (기획 수정 반영용)
    notionAliasCmd
      .command("comments")
      .description("Notion 페이지의 (열린) 댓글 목록 조회")
      .argument("<pageIdOrUrl>", "Notion page ID 또는 URL")
      .option("-o, --output <path>", "markdown 파일로 저장 (생략 시 stdout)")
      .action(async (pageIdOrUrl: string, options: Record<string, unknown>) => {
        await this.handleNotionComments(pageIdOrUrl, options);
      });

    // rc — 현재 로드된 .devagentrc 출력 (디버깅용)
    this.program
      .command("rc")
      .description("현재 로드된 .devagentrc 설정 확인")
      .action(async () => {
        await this.handleShowRC();
      });
  }

  // ── 커맨드 핸들러 ──

  private async handleRun(
    task: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const merged = applyRCToRunOptions(this.rc, options);

    const cliOverrides: Partial<import("../types/config.js").WorkflowConfig> = {};
    if (merged["maxIterations"]) {
      cliOverrides.maxIterations = merged["maxIterations"] as number;
    }

    const projectPathOpt = merged["project"] as string | undefined;
    if (!projectPathOpt) {
      throw new Error("--project 옵션이 필요합니다");
    }

    const projectPath = path.resolve(projectPathOpt);
    const result = await this.workflowService.execute(projectPath, task, cliOverrides);
    this.printWorkflowResult(result);
  }

  /**
   * `devagent build <pageId>` 핸들러
   * - WorkflowService.executeBuildFromNotion 호출
   * - Status=Approved 검증 실패 시 즉시 거부
   * - Notion task 본문(markdown)을 그대로 Codex 구현 명세로 전달 (Planning 스킵)
   */
  private async handleBuild(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const projectPathOpt = (options["project"] as string | undefined) ?? this.rc.projectPath;
    const projectPath = projectPathOpt ? path.resolve(projectPathOpt) : undefined;

    const cliOverrides: Partial<import("../types/config.js").WorkflowConfig> = {};
    if (options["maxIterations"]) {
      cliOverrides.maxIterations = options["maxIterations"] as number;
    }

    // commander: `--no-follow-up` 지정 시 options.followUp === false (미지정 시 true)
    const createFollowUp = options["followUp"] !== false;

    console.log(`Notion task 개발 시작: ${pageIdOrUrl}`);
    const result = await this.workflowService.executeBuildFromNotion(pageIdOrUrl, {
      ...(projectPath ? { projectPath } : {}),
      cliOverrides,
      createFollowUp,
    });

    this.printWorkflowResult(result);
  }

  /**
   * `devagent batch-build` 핸들러
   * - Notion DB의 Approved task를 도메인 레인으로 묶어 일괄 빌드
   * - 도메인 간 병렬 / 같은 도메인 순차 / git worktree 격리
   */
  private async handleBatchBuild(options: Record<string, unknown>): Promise<void> {
    const cfg = this.getNotionConfig();
    const notion = await cfg.getNotion();
    if (!notion) {
      console.log("❌ Notion 인증이 설정되지 않았습니다. 'dev-agent notion login' 실행");
      process.exitCode = 1;
      return;
    }

    const databaseId = (options["db"] as string | undefined) ?? notion.defaultDatabaseId;
    if (!databaseId) {
      console.log(
        "❌ Database ID가 필요합니다. --db <id> 옵션 또는 'notion login --default-db' 사용",
      );
      process.exitCode = 1;
      return;
    }

    const projectPathOpt = (options["project"] as string | undefined) ?? this.rc.projectPath;
    const basePath = projectPathOpt ? path.resolve(projectPathOpt) : undefined;

    const cliOverrides: Partial<import("../types/config.js").WorkflowConfig> = {};
    if (options["maxIterations"]) {
      cliOverrides.maxIterations = options["maxIterations"] as number;
    }

    const dryRun = options["dryRun"] === true;
    const keepWorktrees = options["keepWorktrees"] === true;
    const concurrency = options["concurrency"] as number | undefined;

    console.log(dryRun ? "배치 빌드 스케줄 미리보기 (dry-run)" : "배치 빌드 시작");
    const summary = await this.workflowService.executeBuildFromNotionBatch({
      databaseId,
      ...(basePath ? { basePath } : {}),
      ...(concurrency ? { concurrency } : {}),
      cliOverrides,
      dryRun,
      keepWorktrees,
    });

    this.printBatchSummary(summary);
  }

  private printBatchSummary(
    summary: import("../services/batch-scheduler.js").BatchBuildSummary,
  ): void {
    console.log("");
    console.log("실행 스케줄 (도메인 레인):");
    if (summary.lanes.length === 0) {
      console.log("  (Approved task 없음)");
    }
    for (const lane of summary.lanes) {
      console.log(`  [${lane.domain}] (순차)`);
      for (const title of lane.titles) {
        console.log(`     - ${title}`);
      }
    }

    if (summary.dryRun) {
      console.log("");
      console.log(`dry-run: 총 ${summary.total}개 task, ${summary.lanes.length}개 도메인 레인`);
      console.log("  💡 실제 실행하려면 --dry-run 없이 다시 실행하세요");
      console.log("");
      return;
    }

    console.log("");
    console.log("빌드 결과:");
    for (const o of summary.outcomes) {
      const icon =
        o.status === "succeeded" ? "\u2705" : o.status === "skipped" ? "\u23ED\uFE0F" : "\u274C";
      const extra = o.prUrl ? ` → ${o.prUrl}` : o.error ? ` (${o.error})` : "";
      console.log(`  ${icon} [${o.domain}] ${o.title}${extra}`);
    }

    console.log("");
    console.log(
      `요약: 총 ${summary.total} / 성공 ${summary.succeeded} / 실패 ${summary.failed} / 건너뜀 ${summary.skipped}`,
    );
    console.log("");

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  }

  private async handleStatus(
    project: string | undefined,
    options: Record<string, unknown>,
  ): Promise<void> {
    const projectPath = project ? path.resolve(project) : undefined;
    const statuses = await this.workflowService.getStatus(projectPath);

    if (statuses.length === 0) {
      console.log("진행 중인 워크플로우가 없습니다.");
      return;
    }

    if (options["json"]) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }

    for (const status of statuses) {
      console.log(`프로젝트: ${status.projectName}`);
      console.log(`  상태: ${status.currentPhase}`);
      console.log(`  사이클: ${status.currentCycle}`);
      console.log(`  경과: ${this.formatDuration(status.elapsed)}`);
      console.log("");
    }
  }

  private async handleResume(project: string): Promise<void> {
    const projectPath = path.resolve(project);
    const result = await this.workflowService.resume(projectPath);
    this.printWorkflowResult(result);
  }

  private async handleList(): Promise<void> {
    const projects = await this.workspaceManager.listProjects(process.cwd());

    if (projects.length === 0) {
      console.log("등록된 프로젝트가 없습니다.");
      return;
    }

    for (const project of projects) {
      const gitStatus = project.hasGit ? "\u2705" : "\u274C";
      console.log(`${gitStatus} ${project.projectName} (${project.projectPath})`);
    }
  }

  private async handleConfigShow(): Promise<void> {
    const config = await this.configManager.show();
    console.log("\n현재 설정:");
    for (const [key, value] of Object.entries(config.value)) {
      const source = config.sources[key as keyof typeof config.sources];
      console.log(`  ${key} = ${JSON.stringify(value)} (${source})`);
    }
    console.log("");
  }

  private async handleConfigGet(key: string): Promise<void> {
    const result = await this.configManager.get(
      key as keyof import("../types/config.js").WorkflowConfig,
    );
    console.log(`${key} = ${JSON.stringify(result.value)} (source: ${result.source})`);
  }

  private async handleConfigSet(key: string, value: string): Promise<void> {
    let convertedValue: unknown = value;
    if (value === "true") convertedValue = true;
    else if (value === "false") convertedValue = false;
    else if (!isNaN(Number(value))) convertedValue = Number(value);

    await this.configManager.setGlobal(
      key as keyof import("../types/config.js").WorkflowConfig,
      convertedValue,
    );
    console.log(`\u2705 ${key} = ${JSON.stringify(convertedValue)} (saved to ~/.dev-agent/config.json)`);
  }

  private async handleReport(project: string, options: Record<string, unknown>): Promise<void> {
    const report = this.workflowService.getReport();

    if (!report) {
      console.log("해당 프로젝트의 리포트 데이터가 없습니다.");
      return;
    }

    const format = (options["format"] as string) ?? "text";

    if (format === "json") {
      const output = JSON.stringify(report, null, 2);
      if (options["output"]) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(options["output"] as string, output);
        console.log(`리포트가 ${options["output"]}에 저장되었습니다.`);
      } else {
        console.log(output);
      }
    } else {
      console.log(formatReportText(report));
    }
  }

  private async handleServe(options: Record<string, unknown>): Promise<void> {
    const { createWebContainer } = await import("../container.js");
    const { WebServer } = await import("../web/server.js");

    const webContainer = await createWebContainer();
    const webConfig: Record<string, unknown> = {};

    if (options["port"]) {
      webConfig["port"] = options["port"];
    }
    if (options["host"]) {
      webConfig["host"] = options["host"];
    }

    const server = new WebServer(
      webContainer.workflowService,
      webContainer.configManager,
      webContainer.workspaceManager,
      webContainer.eventEmitter,
      webContainer.logger,
      webConfig as Partial<import("../web/server.js").WebServerConfig>,
      webContainer.notionConfig,
    );

    await server.start();

    const shutdown = async () => {
      console.log("\n웹 서버 종료 중...");
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await new Promise(() => {
      // 무한 대기 (SIGINT/SIGTERM으로 종료)
    });
  }

  // ── Notion 통합 핸들러 ──

  private getNotionConfig(): NotionConfigManager {
    if (this.notionConfig) return this.notionConfig;
    throw new Error(
      "Notion 통합 모듈이 초기화되지 않았습니다. dev-agent를 최신 빌드로 사용하세요.",
    );
  }

  private async handleNotionStatus(): Promise<void> {
    const cfg = this.getNotionConfig();
    const masked = (await cfg.showMasked()).notion;
    console.log("");
    console.log(`Notion : ${masked.configured ? "활성" : "비활성"}`);
    if (masked.configured) {
      console.log(`  Token       : ${masked.tokenPreview ?? "-"}`);
      if (masked.defaultDatabaseId) {
        console.log(`  Default DB  : ${masked.defaultDatabaseId}`);
      }
    } else {
      console.log("  💡 'dev-agent integrations notion set --token <token>' 으로 등록하세요");
    }
    console.log("");
  }

  private async handleNotionSet(options: Record<string, unknown>): Promise<void> {
    const cfg = this.getNotionConfig();
    const token = String(options["token"]).trim();
    if (!token) {
      console.log("❌ --token 값이 비어있습니다");
      process.exitCode = 1;
      return;
    }
    const defaultDb = options["defaultDb"] as string | undefined;
    await cfg.setNotion(
      { integrationToken: token },
      defaultDb ? { defaultDatabaseId: defaultDb } : undefined,
    );
    console.log("✅ Notion 인증이 저장되었습니다 (~/.dev-agent/integrations.json)");
    console.log("   💡 Notion에서 해당 페이지/DB를 integration에 연결(Connections)했는지 확인하세요");
  }

  private async handleNotionTest(): Promise<void> {
    const cfg = this.getNotionConfig();
    const notion = await cfg.getNotion();
    if (!notion) {
      console.log("❌ Notion 인증이 설정되지 않았습니다. 'dev-agent integrations notion set' 실행");
      process.exitCode = 1;
      return;
    }
    const { NotionClient } = await import("../integrations/notion-client.js");
    const client = new NotionClient(notion.auth, this.logger, notion.propertyMapping);
    try {
      const me = await client.verifyAuth();
      console.log(`✅ Notion 인증 성공: ${me.name ?? "(이름 미상)"}`);
    } catch (error) {
      console.log(`❌ Notion 인증 실패: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }

  private async handleNotionListTasks(options: Record<string, unknown>): Promise<void> {
    const cfg = this.getNotionConfig();
    const notion = await cfg.getNotion();
    if (!notion) {
      console.log("❌ Notion 인증이 설정되지 않았습니다");
      process.exitCode = 1;
      return;
    }
    const dbId = (options["db"] as string | undefined) ?? notion.defaultDatabaseId;
    if (!dbId) {
      console.log(
        "❌ Database ID가 필요합니다. --db <id> 옵션 또는 'integrations notion set --default-db' 사용",
      );
      process.exitCode = 1;
      return;
    }

    const { NotionClient } = await import("../integrations/notion-client.js");
    const client = new NotionClient(notion.auth, this.logger, notion.propertyMapping);
    const max = (options["max"] as number) ?? 20;
    const statusFilter = options["status"] as string | undefined;

    const tasks = await client.queryDatabase(dbId, {
      pageSize: max,
      ...(statusFilter ? { status: statusFilter } : {}),
    });

    if (tasks.length === 0) {
      console.log("조회된 task가 없습니다.");
      return;
    }

    console.log("");
    for (const t of tasks) {
      const status = (t.status ?? "-").padEnd(14);
      const assignees = t.assignees.map((a) => a.name).join(",") || "-";
      console.log(`  ${t.pageId}  [${status}]  ${t.title}  (${assignees})`);
    }
    console.log("");
    console.log(`총 ${tasks.length}개 (max=${max})`);
  }

  private async handleNotionClear(): Promise<void> {
    const cfg = this.getNotionConfig();
    await cfg.clearNotion();
    console.log("✅ Notion 인증이 제거되었습니다");
  }

  /**
   * `devagent notion pull <pageId> [-o file]`
   * Notion 페이지 본문(markdown)을 stdout 또는 파일로 추출.
   */
  private async handleNotionPull(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const client = await this.requireNotionClient();
    const task = await client.getTask(pageIdOrUrl);
    if (!task) {
      console.log(`❌ Notion 페이지를 찾을 수 없습니다: ${pageIdOrUrl}`);
      process.exitCode = 1;
      return;
    }

    const header = `# ${task.title}\n\n`;
    const body = task.bodyMarkdown ?? "";
    const content = header + body + (body.endsWith("\n") ? "" : "\n");

    const outputPath = options["output"] as string | undefined;
    if (outputPath) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.resolve(outputPath), content, "utf-8");
      console.log(`✅ ${outputPath} 에 저장 (${content.length}자)`);
    } else {
      process.stdout.write(content);
    }
  }

  /**
   * `devagent notion push <pageId> --from <file>`
   * 로컬 마크다운 파일을 Notion 페이지 본문에 append.
   */
  private async handleNotionPush(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const cfg = this.getNotionConfig();
    const notion = await cfg.getNotion();
    if (!notion) {
      console.log("❌ Notion 인증이 설정되지 않았습니다");
      process.exitCode = 1;
      return;
    }

    const filePath = path.resolve(String(options["from"]));
    const { readFile } = await import("node:fs/promises");
    const markdown = await readFile(filePath, "utf-8");
    if (markdown.trim().length === 0) {
      console.log(`❌ 파일이 비어 있습니다: ${filePath}`);
      process.exitCode = 1;
      return;
    }

    const { NotionBlockAppender } = await import("../integrations/notion-block-appender.js");
    const appender = new NotionBlockAppender(notion.auth, this.logger);
    const pageId = this.extractPageId(pageIdOrUrl);
    const blocks = appender.markdownToBlocks(markdown);

    if (options["replace"]) {
      const deleted = await appender.replaceBlocks(pageId, blocks);
      console.log(
        `✅ Notion 페이지 ${pageId} 본문 교체 완료 (기존 ${deleted}개 삭제 → 신규 ${blocks.length}개)`,
      );
    } else {
      await appender.appendBlocks(pageId, blocks);
      console.log(`✅ Notion 페이지 ${pageId} 에 ${blocks.length}개 block append 완료`);
    }
  }

  /**
   * `devagent notion comments <pageId> [-o file]`
   * 페이지의 (열린) 댓글을 시간순으로 조회. 기획 수정 피드백 반영용.
   */
  private async handleNotionComments(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const client = await this.requireNotionClient();
    const pageId = this.extractPageId(pageIdOrUrl);
    const comments = await client.getComments(pageId);

    if (comments.length === 0) {
      const empty = `# 댓글 (${pageId})\n\n(열린 댓글이 없습니다)\n`;
      const outputPath0 = options["output"] as string | undefined;
      if (outputPath0) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.resolve(outputPath0), empty, "utf-8");
        console.log(`✅ ${outputPath0} 에 저장 (댓글 0개)`);
      } else {
        console.log("(열린 댓글이 없습니다)");
      }
      return;
    }

    const lines: string[] = [`# 댓글 (${comments.length}개) — ${pageId}`, ""];
    comments.forEach((c, idx) => {
      const when = c.createdTime ? c.createdTime.slice(0, 16).replace("T", " ") : "";
      lines.push(`## ${idx + 1}. ${when}${c.createdById ? ` · ${c.createdById}` : ""}`);
      lines.push("");
      lines.push(c.text || "(빈 댓글)");
      lines.push("");
    });
    const content = lines.join("\n");

    const outputPath = options["output"] as string | undefined;
    if (outputPath) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.resolve(outputPath), content + "\n", "utf-8");
      console.log(`✅ ${outputPath} 에 저장 (댓글 ${comments.length}개)`);
    } else {
      process.stdout.write(content + "\n");
    }
  }

  /**
   * `devagent notion status <pageId> <statusName>`
   * Notion 페이지의 Status 속성을 변경.
   */
  private async handleNotionSetStatus(
    pageIdOrUrl: string,
    statusName: string,
  ): Promise<void> {
    const client = await this.requireNotionClient();
    const pageId = this.extractPageId(pageIdOrUrl);
    await client.updateStatus(pageId, statusName);
    console.log(`✅ ${pageId} Status → "${statusName}"`);
  }

  /**
   * NotionClient 가 주입되어 있지 않으면 즉시 생성한다.
   */
  private async requireNotionClient(): Promise<NotionClient> {
    if (this.notionClient) return this.notionClient;
    const cfg = this.getNotionConfig();
    const notion = await cfg.getNotion();
    if (!notion) {
      throw new Error("Notion 인증이 설정되지 않았습니다. `devagent notion login --token <...>` 실행");
    }
    const { NotionClient } = await import("../integrations/notion-client.js");
    return new NotionClient(notion.auth, this.logger, notion.propertyMapping);
  }

  /**
   * Notion 페이지 URL 또는 raw ID 에서 pageId 추출.
   * URL 패턴: https://www.notion.so/.../<title>-<32hex>
   * raw ID: 8-4-4-4-12 hyphen 형식 또는 32hex
   */
  private extractPageId(input: string): string {
    const trimmed = input.trim();
    const hexMatch = trimmed.match(/([0-9a-fA-F]{32})/);
    if (hexMatch?.[1]) {
      const h = hexMatch[1].toLowerCase();
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    const uuidMatch = trimmed.match(
      /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (uuidMatch?.[1]) return uuidMatch[1].toLowerCase();
    return trimmed;
  }

  // ── rc 표시 ──

  private async handleShowRC(): Promise<void> {
    const { rc, sources } = await loadRC();

    console.log("");
    console.log("📄 .devagentrc 로드 결과");
    console.log("");

    if (sources.length === 0) {
      console.log("  (적용된 소스 없음 — 모든 옵션은 CLI 인자로 지정해야 합니다)");
    } else {
      console.log("  소스 (낮은 → 높은 우선순위):");
      for (const s of sources) {
        console.log(`    - ${s}`);
      }
    }
    console.log("");
    console.log("  병합된 값:");
    if (Object.keys(rc).length === 0) {
      console.log("    (비어있음)");
    } else {
      console.log(JSON.stringify(rc, null, 2).replace(/^/gm, "    "));
    }
    console.log("");
    console.log("  💡 우선순위: CLI 옵션 > env(DEVAGENT_*) > 프로젝트 rc > 글로벌 rc");
    console.log("");
  }

  // ── 유틸리티 ──

  private printWorkflowResult(result: import("../types/workflow.js").WorkflowResult): void {
    console.log("");

    switch (result.status) {
      case "completed":
        console.log("\u2705 워크플로우 완료!");
        if (result.prUrl) {
          console.log(`  PR: ${result.prUrl}`);
        }
        console.log(`  사이클: ${result.totalCycles}회 (총 소요: ${this.formatDuration(result.duration)})`);
        break;

      case "stopped":
        console.log("\u23F9\uFE0F  워크플로우 중단됨");
        console.log(`  진행: ${result.totalCycles}회 사이클`);
        console.log("  💡 'dev-agent resume'로 재시작 가능");
        break;

      case "failed":
        console.log("\u274C 워크플로우 실패");
        if (result.error) {
          console.log(`  원인: ${result.error.message}`);
        }
        console.log("  💡 'dev-agent resume'로 재시작 가능");
        process.exitCode = 1;
        break;
    }

    console.log("");
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
    const min = Math.floor(ms / 60_000);
    const sec = Math.round((ms % 60_000) / 1000);
    return `${min}분 ${sec}초`;
  }
}
