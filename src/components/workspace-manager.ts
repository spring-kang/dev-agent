/**
 * WorkspaceManager (C-04) - 프로젝트 검증 및 CLI 도구 확인
 * NFR: 경로 이탈 방지, 심볼릭 링크 해제
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectInfo, ValidationResult, PrerequisiteResult } from "../types/config.js";
import { WorkspaceError, PrerequisiteError } from "../types/errors.js";
import { WORKFLOW_DIRS } from "../types/workflow.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);

const REQUIRED_TOOLS = [
  { tool: "git", args: ["--version"], required: true },
  { tool: "claude", args: ["--version"], required: true },
  { tool: "codex", args: ["--version"], required: true },
  { tool: "gh", args: ["--version"], required: false },
];

export class WorkspaceManager {
  constructor(private readonly logger: Logger) {}

  /**
   * 프로젝트 경로 유효성 검증
   */
  async validateProject(projectPath: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 경로 정규화 + 존재 확인
    const resolvedPath = path.resolve(projectPath);
    let realPath: string;

    try {
      realPath = await fs.realpath(resolvedPath);
    } catch {
      return {
        valid: false,
        errors: [`프로젝트 경로가 존재하지 않습니다: ${resolvedPath}`],
        warnings: [],
      };
    }

    // 2. 디렉토리 여부 확인
    try {
      const stat = await fs.stat(realPath);
      if (!stat.isDirectory()) {
        errors.push(`프로젝트 경로가 디렉토리가 아닙니다: ${realPath}`);
        return { valid: false, errors, warnings };
      }
    } catch (error) {
      errors.push(`프로젝트 경로 접근 실패: ${(error as Error).message}`);
      return { valid: false, errors, warnings };
    }

    // 3. 접근 권한 확인
    try {
      await fs.access(realPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      errors.push(`프로젝트 경로에 읽기/쓰기 권한이 없습니다: ${realPath}`);
      return { valid: false, errors, warnings };
    }

    // 4. Git 저장소 확인
    const hasGit = await this.checkFileExists(path.join(realPath, ".git"));
    if (!hasGit) {
      errors.push("프로젝트에 Git 저장소가 초기화되지 않았습니다. 'git init'을 실행하세요.");
    }

    // 5. package.json 확인 (경고만)
    const hasPackageJson = await this.checkFileExists(path.join(realPath, "package.json"));
    if (!hasPackageJson) {
      warnings.push("package.json이 없습니다. Node.js 프로젝트가 아닐 수 있습니다.");
    }

    const projectName = path.basename(realPath);

    return {
      valid: errors.length === 0,
      projectInfo: {
        projectPath: realPath,
        projectName,
        hasGit,
        hasPackageJson,
      },
      errors,
      warnings,
    };
  }

  /**
   * 필수 CLI 도구 존재 확인
   */
  async checkPrerequisites(): Promise<PrerequisiteResult> {
    const checks = await Promise.all(
      REQUIRED_TOOLS.map(async ({ tool, args, required }) => {
        try {
          const { stdout } = await execFileAsync(tool, args, { timeout: 5000 });
          const version = stdout.trim().split("\n")[0] ?? "";
          return {
            tool,
            required,
            found: true,
            version,
          };
        } catch {
          return {
            tool,
            required,
            found: false,
          };
        }
      }),
    );

    const missingRequired = checks.filter((c) => c.required && !c.found);
    const allPassed = missingRequired.length === 0;

    if (!allPassed) {
      this.logger.error(
        `필수 도구가 설치되지 않았습니다: ${missingRequired.map((c) => c.tool).join(", ")}`,
      );
    }

    // 선택 도구 누락 시 경고
    const missingOptional = checks.filter((c) => !c.required && !c.found);
    for (const check of missingOptional) {
      this.logger.warn(`선택 도구가 설치되지 않았습니다: ${check.tool} (일부 기능 제한)`);
    }

    return { allPassed, checks };
  }

  /**
   * 워크플로우 디렉토리 초기화 (멱등)
   *
   * @param projectPath 프로젝트 루트 경로
   * @param options.archiveExisting true일 때 기존 current/ 가 있으면
   *   archive/<workflowId>-<ISO_TS>/ 로 이동 후 새 current/ 생성.
   *   workflowId 는 state.json 에서 읽어 사용하며, 없으면 "unknown" fallback.
   */
  async initWorkflowDirs(
    projectPath: string,
    options?: { archiveExisting?: boolean },
  ): Promise<void> {
    if (options?.archiveExisting) {
      await this.archiveCurrentIfExists(projectPath);
    }

    const dirs = [
      path.join(projectPath, WORKFLOW_DIRS.root),
      path.join(projectPath, WORKFLOW_DIRS.current),
      path.join(projectPath, WORKFLOW_DIRS.archive),
      path.join(projectPath, WORKFLOW_DIRS.logs),
      path.join(projectPath, WORKFLOW_DIRS.artifacts),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * 기존 current/ 디렉토리가 있으면 archive/<workflowId>-<ts>/ 로 이동
   * state.json 이 없거나 workflowId 추출 실패 시 "unknown" 으로 fallback.
   */
  private async archiveCurrentIfExists(projectPath: string): Promise<void> {
    const currentDir = path.join(projectPath, WORKFLOW_DIRS.current);
    const exists = await this.checkFileExists(currentDir);
    if (!exists) return;

    // workflowId 추출 시도
    let workflowId = "unknown";
    try {
      const stateRaw = await fs.readFile(
        path.join(currentDir, "state.json"),
        "utf-8",
      );
      const state = JSON.parse(stateRaw) as { workflowId?: string };
      if (typeof state.workflowId === "string" && state.workflowId.trim()) {
        workflowId = state.workflowId.trim();
      }
    } catch {
      // state.json 없음/파싱 실패 → unknown 으로 진행
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveRoot = path.join(projectPath, WORKFLOW_DIRS.archive);
    await fs.mkdir(archiveRoot, { recursive: true });

    const targetDir = path.join(archiveRoot, `${workflowId}-${ts}`);
    await fs.rename(currentDir, targetDir);

    this.logger.info(`기존 기획을 ${targetDir} 로 백업했습니다.`);
  }

  /**
   * 프로젝트 목록 조회 (projects/ 디렉토리 스캔)
   */
  async listProjects(basePath: string): Promise<ProjectInfo[]> {
    const projectsDir = path.join(basePath, "projects");

    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      const projects: ProjectInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectPath = path.join(projectsDir, entry.name);
          const hasGit = await this.checkFileExists(path.join(projectPath, ".git"));
          const hasPackageJson = await this.checkFileExists(
            path.join(projectPath, "package.json"),
          );

          projects.push({
            projectPath,
            projectName: entry.name,
            hasGit,
            hasPackageJson,
          });
        }
      }

      return projects;
    } catch {
      return [];
    }
  }

  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
