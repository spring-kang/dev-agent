/**
 * BatchScheduler 단위 테스트 — 순수 함수 검증
 *
 * 검증 항목:
 *   - parseDomainKey / parseSliceNumber: 제목 prefix 파싱
 *   - groupTasksByDomain: 도메인 그룹핑 + 레인 내 슬라이스 정렬 + 레인 정렬
 *   - toBatchTaskInput: NotionTaskSummary 유사 객체 변환
 *   - runWithConcurrency: 동시성 제한 + 입력 순서 보존 + 최대 동시 실행 수 제한
 *   - summarizeOutcomes: 통계 집계 + 레인 요약
 */
import { describe, it, expect } from "vitest";
import {
  parseDomainKey,
  parseSliceNumber,
  groupTasksByDomain,
  toBatchTaskInput,
  runWithConcurrency,
  summarizeOutcomes,
  type BatchTaskInput,
  type BatchTaskOutcome,
} from "../../../src/services/batch-scheduler.js";

describe("parseDomainKey", () => {
  it("prefix 패턴에서 도메인 키를 소문자로 추출한다", () => {
    expect(parseDomainKey("interview-1: 세션 생성")).toBe("interview");
    expect(parseDomainKey("Identity-4 — 토큰 발급")).toBe("identity");
    expect(parseDomainKey("auth_v2-12: refresh")).toBe("auth_v2");
  });

  it("prefix 패턴이 없으면 제목 전체를 소문자로 반환한다", () => {
    expect(parseDomainKey("일반 작업")).toBe("일반 작업");
    expect(parseDomainKey("  Standalone Task  ")).toBe("standalone task");
  });
});

describe("parseSliceNumber", () => {
  it("prefix 패턴에서 슬라이스 번호를 추출한다", () => {
    expect(parseSliceNumber("interview-1: ...")).toBe(1);
    expect(parseSliceNumber("learning-12 — ...")).toBe(12);
  });

  it("prefix 패턴이 없으면 0을 반환한다", () => {
    expect(parseSliceNumber("제목만 있음")).toBe(0);
  });
});

describe("groupTasksByDomain", () => {
  it("도메인별로 그룹핑하고 레인 내부는 슬라이스 오름차순 정렬한다", () => {
    const tasks: BatchTaskInput[] = [
      { pageId: "a", title: "interview-3", domain: "interview", slice: 3, projectPath: "/p" },
      { pageId: "b", title: "interview-1", domain: "interview", slice: 1, projectPath: "/p" },
      { pageId: "c", title: "learning-2", domain: "learning", slice: 2, projectPath: "/p" },
      { pageId: "d", title: "interview-2", domain: "interview", slice: 2, projectPath: "/p" },
    ];

    const lanes = groupTasksByDomain(tasks);

    // 레인은 도메인명 오름차순
    expect(lanes.map((l) => l.domain)).toEqual(["interview", "learning"]);
    // interview 레인은 슬라이스 1,2,3 순
    expect(lanes[0]!.tasks.map((t) => t.slice)).toEqual([1, 2, 3]);
    expect(lanes[1]!.tasks.map((t) => t.slice)).toEqual([2]);
  });

  it("슬라이스가 같으면 제목 오름차순으로 정렬한다", () => {
    const tasks: BatchTaskInput[] = [
      { pageId: "a", title: "community-1: B", domain: "community", slice: 1, projectPath: "/p" },
      { pageId: "b", title: "community-1: A", domain: "community", slice: 1, projectPath: "/p" },
    ];
    const lanes = groupTasksByDomain(tasks);
    expect(lanes[0]!.tasks.map((t) => t.title)).toEqual([
      "community-1: A",
      "community-1: B",
    ]);
  });

  it("빈 목록은 빈 레인 배열을 반환한다", () => {
    expect(groupTasksByDomain([])).toEqual([]);
  });
});

describe("toBatchTaskInput", () => {
  it("제목에서 도메인/슬라이스를 채워 변환한다", () => {
    const input = toBatchTaskInput({
      pageId: "p1",
      title: "admin-5: 통계 대시보드",
      projectPath: "/repo",
    });
    expect(input).toEqual({
      pageId: "p1",
      title: "admin-5: 통계 대시보드",
      projectPath: "/repo",
      domain: "admin",
      slice: 5,
    });
  });
});

describe("runWithConcurrency", () => {
  it("결과를 입력 순서대로 보존한다", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("동시 실행 수가 concurrency를 초과하지 않는다", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrency(items, 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("concurrency가 1이면 순차 실행된다", async () => {
    const order: number[] = [];
    await runWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 1));
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("빈 목록은 빈 결과를 반환한다", async () => {
    const results = await runWithConcurrency([], 4, async (n) => n);
    expect(results).toEqual([]);
  });
});

describe("summarizeOutcomes", () => {
  it("성공/실패/건너뜀 통계를 집계한다", () => {
    const outcomes: BatchTaskOutcome[] = [
      { pageId: "a", title: "interview-1", domain: "interview", status: "succeeded", prUrl: "http://pr/1" },
      { pageId: "b", title: "interview-2", domain: "interview", status: "failed", error: "boom" },
      { pageId: "c", title: "interview-3", domain: "interview", status: "skipped" },
      { pageId: "d", title: "learning-1", domain: "learning", status: "succeeded" },
    ];
    const lanes = groupTasksByDomain([
      { pageId: "a", title: "interview-1", domain: "interview", slice: 1, projectPath: "/p" },
      { pageId: "d", title: "learning-1", domain: "learning", slice: 1, projectPath: "/p" },
    ]);

    const summary = summarizeOutcomes(outcomes, lanes, false);

    expect(summary.total).toBe(4);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.dryRun).toBe(false);
    expect(summary.lanes).toEqual([
      { domain: "interview", titles: ["interview-1"] },
      { domain: "learning", titles: ["learning-1"] },
    ]);
  });

  it("dryRun 플래그를 보존한다", () => {
    const summary = summarizeOutcomes([], [], true);
    expect(summary.dryRun).toBe(true);
    expect(summary.total).toBe(0);
  });
});
