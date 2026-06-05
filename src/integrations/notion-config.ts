/**
 * NotionConfigManager
 *
 * Notion 통합 인증(Integration Token)과 기본 DB ID, 속성/상태 매핑을
 * ~/.dev-agent/integrations.json 에 안전하게 보관한다.
 *
 * 저장 규칙:
 *   - 파일 권한: 0o600 (소유자만 읽기/쓰기)
 *   - atomic write: tmp 파일 작성 → rename
 *   - showMasked()는 token을 절대 노출하지 않음
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "../components/logger.js";
import type {
  NotionAuth,
  NotionConfig,
  NotionPropertyMapping,
} from "../types/integrations.js";
import type { WorkflowPhase } from "../types/workflow.js";

const CONFIG_FILENAME = "integrations.json";
const CONFIG_DIR = ".dev-agent";

export class NotionConfigManager {
  private readonly configPath: string;
  private cache: NotionConfig | null = null;

  constructor(
    private readonly logger: Logger,
    /** 테스트용 override (기본: ~/.dev-agent/integrations.json) */
    configPath?: string,
  ) {
    this.configPath =
      configPath ?? join(homedir(), CONFIG_DIR, CONFIG_FILENAME);
  }

  /**
   * 설정 파일을 로드. 존재하지 않으면 빈 객체 반환.
   */
  async load(): Promise<NotionConfig> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as NotionConfig;
      this.cache = parsed;
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.cache = {};
        return this.cache;
      }
      this.logger.warn(
        `통합 설정 파일 읽기 실패 (${this.configPath}): ${(err as Error).message}`,
      );
      this.cache = {};
      return this.cache;
    }
  }

  /**
   * Notion 인증 정보 저장 (기존 옵션 보존).
   */
  async setNotion(
    auth: NotionAuth,
    options?: {
      defaultDatabaseId?: string;
      statusMapping?: Partial<Record<WorkflowPhase, string>>;
      propertyMapping?: NotionPropertyMapping;
    },
  ): Promise<void> {
    const config = await this.load();
    const existing = config.notion;
    config.notion = {
      auth,
      ...(options?.defaultDatabaseId !== undefined
        ? { defaultDatabaseId: options.defaultDatabaseId }
        : existing?.defaultDatabaseId
          ? { defaultDatabaseId: existing.defaultDatabaseId }
          : {}),
      ...(options?.statusMapping
        ? { statusMapping: options.statusMapping }
        : existing?.statusMapping
          ? { statusMapping: existing.statusMapping }
          : {}),
      ...(options?.propertyMapping
        ? { propertyMapping: options.propertyMapping }
        : existing?.propertyMapping
          ? { propertyMapping: existing.propertyMapping }
          : {}),
    };
    await this.persist(config);
  }

  /**
   * Notion 인증 제거.
   */
  async clearNotion(): Promise<void> {
    const config = await this.load();
    delete config.notion;
    await this.persist(config);
  }

  /**
   * Notion 인증 + 옵션 조회 (없으면 null).
   */
  async getNotion(): Promise<NotionConfig["notion"] | null> {
    const config = await this.load();
    return config.notion ?? null;
  }

  async getNotionAuth(): Promise<NotionAuth | null> {
    const cfg = await this.getNotion();
    return cfg?.auth ?? null;
  }

  async isNotionEnabled(): Promise<boolean> {
    const auth = await this.getNotionAuth();
    return Boolean(auth?.integrationToken);
  }

  /**
   * 토큰을 마스킹한 안전 표시용 객체.
   * UI/CLI 표시 전용.
   */
  async showMasked(): Promise<{
    notion: {
      configured: boolean;
      defaultDatabaseId?: string;
      tokenPreview?: string;
    };
  }> {
    const cfg = await this.getNotion();
    if (!cfg) {
      return { notion: { configured: false } };
    }
    const token = cfg.auth.integrationToken;
    const preview =
      token.length > 8
        ? `${token.slice(0, 4)}…${token.slice(-4)}`
        : "***";
    return {
      notion: {
        configured: true,
        ...(cfg.defaultDatabaseId && { defaultDatabaseId: cfg.defaultDatabaseId }),
        tokenPreview: preview,
      },
    };
  }

  /**
   * 디렉토리 생성 + 0o600 권한으로 atomic write.
   */
  private async persist(config: NotionConfig): Promise<void> {
    const dir = dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const tmpPath = `${this.configPath}.${process.pid}.tmp`;
    const json = JSON.stringify(config, null, 2);
    await fs.writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmpPath, this.configPath);

    // 캐시 갱신
    this.cache = config;
    this.logger.debug(`통합 설정 저장: ${this.configPath}`);
  }
}
