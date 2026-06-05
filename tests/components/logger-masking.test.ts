/**
 * Logger 민감 정보 마스킹 테스트 (보안)
 * SENSITIVE_PATTERNS: secret|token|key|password|api_key|credential
 *
 * 전략: maskSensitiveData는 private이지만, Logger 인스턴스를 통해
 * 파일 로그에 기록되는 내용으로 간접 검증.
 * fileHandle 캐싱 문제를 회피하기 위해 단일 Logger 인스턴스를 사용하고
 * 모든 write 호출을 순차적으로 수집.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Logger } from "../../src/components/logger.js";

// 모든 write 호출을 수집
const allWrites: string[] = [];

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockImplementation(async () => ({
    write: vi.fn().mockImplementation(async (data: string) => {
      allWrites.push(data);
    }),
    datasync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("Logger - 민감 정보 마스킹", () => {
  let logger: Logger;

  beforeAll(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // 단일 Logger 인스턴스 (fileHandle 한번만 open)
    logger = new Logger({
      level: "info",
      noColor: true,
      logFilePath: "/tmp/masking-test.log",
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  async function logAndGetEntry(meta: Record<string, unknown>): Promise<Record<string, unknown>> {
    const idx = allWrites.length;
    logger.info("test", meta);
    // fire-and-forget async 대기
    await new Promise((r) => setTimeout(r, 200));
    const line = allWrites[idx];
    if (!line) {
      throw new Error(`캡처 실패: idx=${idx}, total=${allWrites.length}`);
    }
    return JSON.parse(line.trim()) as Record<string, unknown>;
  }

  it("meta에 'secret' 키가 있으면 **** 으로 마스킹", async () => {
    const entry = await logAndGetEntry({ secret: "my-secret-value", normalData: "visible" });
    expect(entry.secret).toBe("****");
    expect(entry.normalData).toBe("visible");
  });

  it("'token', 'password', 'api_key', 'credential' 키 모두 마스킹", async () => {
    const entry = await logAndGetEntry({
      token: "jwt-token-123",
      password: "pass123",
      api_key: "key-456",
      credential: "cred-789",
      username: "user1",
    });
    expect(entry.token).toBe("****");
    expect(entry.password).toBe("****");
    expect(entry.api_key).toBe("****");
    expect(entry.credential).toBe("****");
    expect(entry.username).toBe("user1");
  });

  it("중첩 객체에서도 재귀적으로 마스킹", async () => {
    const entry = await logAndGetEntry({
      config: {
        secret: "deep-secret",
        visible: "this-is-fine",
      },
    });
    const config = entry.config as Record<string, unknown>;
    expect(config.secret).toBe("****");
    expect(config.visible).toBe("this-is-fine");
  });

  it("대소문자 구분 없이 마스킹 (SECRET, Token 등)", async () => {
    const entry = await logAndGetEntry({
      SECRET: "should-mask",
      Token: "should-mask-too",
      normalValue: "visible",
    });
    expect(entry.SECRET).toBe("****");
    expect(entry.Token).toBe("****");
    expect(entry.normalValue).toBe("visible");
  });

  it("'key' 패턴을 포함하는 키도 마스킹 (apiKey, accessKey 등)", async () => {
    const entry = await logAndGetEntry({
      apiKey: "should-mask",
      accessKey: "should-mask",
      description: "visible",
    });
    expect(entry.apiKey).toBe("****");
    expect(entry.accessKey).toBe("****");
    expect(entry.description).toBe("visible");
  });
});
