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
          "  단축 명령어: task <id>, notion (login/test/list/clear), serve",
      )
      .option("--verbose", "상세 로그 출력")
      .option("--no-color", "색상 비활성화")
      .hook("preAction", (thisCommand) => {
        const cliVerbose = thisCommand.opts()["verbose"] === true;
        this.verbose = cliVerbose || this.rc.verbose === true;
      });

    // run 커맨드
    this.program
      .command("run")
      .description("워크플로우 시작")
      .option(
        "-p, --project <path>",
        "프로젝트 경로 (--task 사용 시 생략 가능, Notion Project Path 속성보다 우선)",
      )
      .option("-m, --max-iterations <number>", "최대 반복 횟수", parseInt)
      .option("-c, --config <path>", "설정 파일 경로")
      .option(
        "-t, --task <pageIdOrUrl>",
        "Notion task page ID 또는 URL (지정 시 Notion 기반 워크플로우)",
      )
      .option("--skip-enhancement", "Claude 기획 고도화 건너뛰기 (fallback 사용)")
      .argument("[task]", "작업 설명 (--task 사용 시 생략 가능)")
      .action(async (task: string | undefined, options: Record<string, unknown>) => {
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
    // task <id> — DEPRECATED: plan / build 로 분리됨
    this.program
      .command("task")
      .description("[제거됨] `devagent plan <id>` → 승인 → `devagent build <id>` 로 분리")
      .argument("[pageIdOrUrl]", "(무시됨)")
      .action(async () => {
        console.error(
          "❌ `devagent task` 는 제거되었습니다.\n" +
            "   기획-개발이 2단계로 분리되었습니다:\n" +
            "     1) devagent plan <pageId>   (기획 고도화 + Planning)\n" +
            "     2) Notion 에서 Status 를 \"Approved\" 로 전이\n" +
            "     3) devagent build <pageId>  (개발 + 리뷰 + PR)\n",
        );
        process.exit(1);
      });

    // plan <pageId> — 기획 고도화 + Planning 단계만 실행
    this.program
      .command("plan")
      .description("Notion task 기획 단계 실행 (PlanningEnhancer + Claude.plan)")
      .argument("[pageIdOrUrl]", "Notion page ID 또는 URL")
      .option("-p, --project <path>", "프로젝트 경로 override")
      .option("--skip-enhancement", "Claude 기획 고도화 건너뛰기 (fallback 사용)")
      .action(async (pageIdOrUrl: string | undefined, options: Record<string, unknown>) => {
        const taskValue = pageIdOrUrl ?? this.rc.task;
        if (!taskValue) {
          throw new Error(
            "page ID 가 필요합니다. 인자로 전달하거나 .devagentrc.json 의 'task' 키를 설정하세요.",
          );
        }
        await this.handlePlan(taskValue, options);
      });

    // build <pageId> — Status=Approved 검증 → Implementation/Review/PR
    this.program
      .command("build")
      .description("승인된 기획 기반 개발 단계 실행 (Status=Approved 검증 후 Implementation→Review→PR)")
      .argument("[pageIdOrUrl]", "Notion page ID 또는 URL")
      .option("-p, --project <path>", "프로젝트 경로 (생략 시 rc 의 projectPath)")
      .option("-m, --max-iterations <number>", "최대 반복 횟수", parseInt)
      .action(async (pageIdOrUrl: string | undefined, options: Record<string, unknown>) => {
        const taskValue = pageIdOrUrl ?? this.rc.task;
        if (!taskValue) {
          throw new Error(
            "page ID 가 필요합니다. 인자로 전달하거나 .devagentrc.json 의 'task' 키를 설정하세요.",
          );
        }
        await this.handleBuild(taskValue, options);
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
      .description("Notion 통합 상태")
      .action(async () => {
        await this.handleNotionStatus();
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
    task: string | undefined,
    options: Record<string, unknown>,
  ): Promise<void> {
    // .devagentrc/환경변수 값을 CLI 옵션에 병합 (CLI 옵션 우선)
    const merged = applyRCToRunOptions(this.rc, options);

    const cliOverrides: Partial<import("../types/config.js").WorkflowConfig> = {};

    if (merged["maxIterations"]) {
      cliOverrides.maxIterations = merged["maxIterations"] as number;
    }

    const notionTask = merged["task"] as string | undefined;
    options = merged;

    if (notionTask) {
      // Notion 기반 워크플로우
      const projectPathOpt = options["project"] as string | undefined;
      const projectPath = projectPathOpt ? path.resolve(projectPathOpt) : undefined;
      const skipEnhancement = options["skipEnhancement"] === true;

      console.log(`Notion task 기반 워크플로우 시작: ${notionTask}`);
      const result = await this.workflowService.executeFromNotion(notionTask, {
        ...(projectPath ? { projectPath } : {}),
        cliOverrides,
        skipClaudeEnhancement: skipEnhancement,
      });
      console.log(
        `기획 고도화 완료 - 참조 페이지 ${result.enhancedPlan.context.task.referencedPages.length}개`,
      );
      this.printWorkflowResult(result);
      return;
    }

    // 일반 모드: --project 와 task 인자 둘 다 필요
    const projectPathOpt = options["project"] as string | undefined;
    if (!projectPathOpt) {
      throw new Error("--project 옵션이 필요합니다");
    }
    if (!task) {
      throw new Error("task 인자가 필요합니다 (또는 --task <pageId> 옵션 사용)");
    }

    const projectPath = path.resolve(projectPathOpt);
    const result = await this.workflowService.execute(projectPath, task, cliOverrides);
    this.printWorkflowResult(result);
  }

  /**
   * `devagent plan <pageId>` 핸들러
   * - WorkflowService.executeFromNotionPlanOnly 호출
   * - 결과: 기획 산출물 경로 + Notion Status → "Plan Review"
   */
  private async handlePlan(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const projectPathOpt = (options["project"] as string | undefined) ?? this.rc.projectPath;
    const projectPath = projectPathOpt ? path.resolve(projectPathOpt) : undefined;
    const skipEnhancement = options["skipEnhancement"] === true;

    console.log(`Notion task 기획 단계 시작: ${pageIdOrUrl}`);
    const result = await this.workflowService.executeFromNotionPlanOnly(pageIdOrUrl, {
      ...(projectPath ? { projectPath } : {}),
      skipClaudeEnhancement: skipEnhancement,
    });

    console.log("");
    console.log("✅ 기획 단계 완료");
    console.log(`  Task        : ${result.enhancedPlan.taskTitle}`);
    console.log(`  Workflow ID : ${result.workflowId}`);
    console.log(`  산출물      : ${result.artifactsPath}`);
    console.log("");
    console.log("📋 다음 단계:");
    console.log("  1) Notion 페이지에서 기획을 검토하세요");
    console.log("  2) 만족하면 Status 를 \"Approved\" 로 변경하세요");
    console.log(`  3) devagent build ${pageIdOrUrl}`);
    console.log("");
    console.log("  ⚠️  수정이 필요하면 devagent plan 을 재실행하세요");
    console.log("     (기존 산출물은 .ai-workflow/archive/ 로 백업됩니다)");
    console.log("");
  }

  /**
   * `devagent build <pageId>` 핸들러
   * - WorkflowService.executeFromNotionBuildOnly 호출
   * - Status=Approved 검증 실패 시 즉시 거부
   */
  private async handleBuild(
    pageIdOrUrl: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const projectPathOpt = (options["project"] as string | undefined) ?? this.rc.projectPath;
    if (!projectPathOpt) {
      throw new Error(
        "프로젝트 경로가 필요합니다. --project 옵션 또는 .devagentrc.json 의 'projectPath' 키를 설정하세요.",
      );
    }
    const projectPath = path.resolve(projectPathOpt);

    const cliOverrides: Partial<import("../types/config.js").WorkflowConfig> = {};
    if (options["maxIterations"]) {
      cliOverrides.maxIterations = options["maxIterations"] as number;
    }

    console.log(`Notion task 개발 단계 시작: ${pageIdOrUrl}`);
    const result = await this.workflowService.executeFromNotionBuildOnly(pageIdOrUrl, {
      projectPath,
      cliOverrides,
    });

    this.printWorkflowResult(result);
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
