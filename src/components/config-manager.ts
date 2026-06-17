/**
 * ConfigManager (C-03) - 4-소스 설정 병합 및 검증
 * 소스 우선순위: CLI > env > project > global > default
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  type WorkflowConfig,
  type ConfigSource,
  type ConfigWithSource,
  DEFAULT_CONFIG,
  CONFIG_KEYS,
  CONFIG_VALIDATION_RULES,
} from "../types/config.js";
import { ConfigError, ConfigValidationError } from "../types/errors.js";

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".dev-agent");
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
const PROJECT_CONFIG_FILE = ".dev-agent.json";

// 환경변수 매핑
const ENV_PREFIX = "DEV_AGENT_";
const ENV_KEY_MAP: Record<string, keyof WorkflowConfig> = {
  DEV_AGENT_MAX_ITERATIONS: "maxIterations",
  DEV_AGENT_BRANCH_PREFIX: "branchPrefix",
  DEV_AGENT_LOG_LEVEL: "logLevel",
  DEV_AGENT_CLAUDE_TIMEOUT: "claudeTimeout",
  DEV_AGENT_CODEX_TIMEOUT: "codexTimeout",
  DEV_AGENT_BASE_BRANCH: "baseBranch",
};

export class ConfigManager {
  /**
   * 설정 로드 (4-소스 병합)
   */
  async load(projectPath?: string, cliOverrides?: Partial<WorkflowConfig>): Promise<ConfigWithSource> {
    const sources: Record<keyof WorkflowConfig, ConfigSource> = {} as Record<
      keyof WorkflowConfig,
      ConfigSource
    >;

    // 1. 기본값
    const result: WorkflowConfig = { ...DEFAULT_CONFIG };
    for (const key of CONFIG_KEYS) {
      sources[key] = "default";
    }

    // 2. 글로벌 설정
    const globalConfig = await this.loadJsonFile(GLOBAL_CONFIG_FILE);
    if (globalConfig) {
      this.mergeConfig(result, sources, globalConfig, "global");
    }

    // 3. 프로젝트 설정
    if (projectPath) {
      const projectConfigPath = path.join(projectPath, PROJECT_CONFIG_FILE);
      const projectConfig = await this.loadJsonFile(projectConfigPath);
      if (projectConfig) {
        this.mergeConfig(result, sources, projectConfig, "project");
      }
    }

    // 4. 환경변수
    const envConfig = this.loadEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      this.mergeConfig(result, sources, envConfig, "env");
    }

    // 5. CLI 오버라이드
    if (cliOverrides) {
      this.mergeConfig(result, sources, cliOverrides, "cli");
    }

    // 검증
    this.validate(result);

    return { value: result, sources };
  }

  /**
   * 특정 키의 값과 출처 조회
   */
  async get(
    key: keyof WorkflowConfig,
    projectPath?: string,
  ): Promise<{ value: unknown; source: ConfigSource }> {
    const config = await this.load(projectPath);
    return { value: config.value[key], source: config.sources[key] };
  }

  /**
   * 글로벌 설정 파일에 값 저장
   */
  async setGlobal(key: keyof WorkflowConfig, value: unknown): Promise<void> {
    if (!CONFIG_KEYS.includes(key)) {
      throw new ConfigError(`알 수 없는 설정 키: ${key}`, GLOBAL_CONFIG_FILE);
    }

    // 단일 키 검증
    const rule = CONFIG_VALIDATION_RULES.find((r) => r.key === key);
    if (rule && !rule.validate(value)) {
      throw new ConfigValidationError(rule.message, [key], GLOBAL_CONFIG_FILE);
    }

    // 기존 파일 로드
    let existing: Record<string, unknown> = {};
    const loaded = await this.loadJsonFile(GLOBAL_CONFIG_FILE);
    if (loaded) {
      existing = loaded as Record<string, unknown>;
    }

    // 값 설정
    existing[key] = value;

    // 저장
    await fs.mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
    await fs.writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(existing, null, 2) + "\n");
  }

  /**
   * 현재 적용되는 전체 설정 조회 (출처 포함)
   */
  async show(projectPath?: string): Promise<ConfigWithSource> {
    return this.load(projectPath);
  }

  private mergeConfig(
    target: WorkflowConfig,
    sources: Record<keyof WorkflowConfig, ConfigSource>,
    partial: Partial<WorkflowConfig>,
    source: ConfigSource,
  ): void {
    for (const key of CONFIG_KEYS) {
      if (key in partial && partial[key] !== undefined) {
        // WorkflowConfig의 키를 동적으로 설정하기 위한 타입 단언
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target as any)[key] = partial[key];
        sources[key] = source;
      }
    }
  }

  private validate(config: WorkflowConfig): void {
    const errors: string[] = [];

    for (const rule of CONFIG_VALIDATION_RULES) {
      const value = config[rule.key];
      if (!rule.validate(value)) {
        errors.push(`${rule.key}: ${rule.message} (현재 값: ${JSON.stringify(value)})`);
      }
    }

    if (errors.length > 0) {
      throw new ConfigValidationError(
        `설정 검증 실패:\n${errors.join("\n")}`,
        errors.map((e) => e.split(":")[0] ?? ""),
        "merged config",
      );
    }
  }

  private async loadJsonFile(filePath: string): Promise<Partial<WorkflowConfig> | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // 알 수 없는 키 경고 (에러 아님)
      for (const key of Object.keys(parsed)) {
        if (!CONFIG_KEYS.includes(key as keyof WorkflowConfig)) {
          // 알 수 없는 키는 무시 (하위 호환성)
        }
      }

      return parsed as Partial<WorkflowConfig>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new ConfigError(`설정 파일 파싱 실패: ${filePath}`, filePath, error as Error);
    }
  }

  private loadEnvConfig(): Partial<WorkflowConfig> {
    const result: Partial<WorkflowConfig> = {};

    for (const [envKey, configKey] of Object.entries(ENV_KEY_MAP)) {
      const value = process.env[envKey];
      if (value !== undefined) {
        const converted = this.convertEnvValue(configKey, value);
        if (converted !== undefined) {
          (result as Record<string, unknown>)[configKey] = converted;
        }
      }
    }

    return result;
  }

  private convertEnvValue(key: keyof WorkflowConfig, value: string): unknown {
    switch (key) {
      case "maxIterations":
      case "claudeTimeout":
      case "codexTimeout":
        return parseInt(value, 10);
      case "prIncludeReviewSummary":
      case "autoCommit":
        return value.toLowerCase() === "true";
      default:
        return value;
    }
  }
}
