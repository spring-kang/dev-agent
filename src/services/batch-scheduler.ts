/**
 * BatchScheduler - Approved task 일괄 빌드용 스케줄링 순수 함수 모음
 *
 * 핵심 규칙:
 *   - task 제목 prefix(`interview-1` → `interview`)로 도메인을 식별한다.
 *   - 같은 도메인 task 는 같은 모듈/스키마/파일을 건드리고 슬라이스 간 의존이
 *     있으므로 한 "레인(lane)" 안에서 슬라이스 번호 오름차순으로 순차 실행한다.
 *   - 서로 다른 도메인 레인은 동시(병렬) 실행 가능하다.
 *
 * 이 파일은 부수효과가 없는 순수 함수만 포함하여 단위 테스트가 쉽다.
 * (worktree 생성/빌드 실행 등 부수효과는 WorkflowService 가 담당)
 */

/** 도메인 그룹핑·실행 대상이 되는 단일 task 입력 */
export interface BatchTaskInput {
  pageId: string;
  title: string;
  domain: string;
  /** 슬라이스 번호 (제목에서 추출, 없으면 0) */
  slice: number;
  /** Notion 속성에서 읽은 프로젝트 경로 (빌드 base 저장소 결정에 사용) */
  projectPath: string;
}

/** 동일 도메인 task 묶음 (레인) */
export interface DomainLane {
  domain: string;
  tasks: BatchTaskInput[];
}

/** task 1건의 빌드 결과 */
export interface BatchTaskOutcome {
  pageId: string;
  title: string;
  domain: string;
  status: "succeeded" | "failed" | "skipped";
  prUrl?: string;
  error?: string;
}

/** 배치 전체 요약 */
export interface BatchBuildSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  outcomes: BatchTaskOutcome[];
  dryRun: boolean;
  /** 레인별 실행 순서 (도메인 → 슬라이스 정렬된 제목) */
  lanes: Array<{ domain: string; titles: string[] }>;
}

const DOMAIN_PATTERN = /^([a-zA-Z][a-zA-Z0-9_]*)\s*-\s*(\d+)/;

/**
 * task 제목에서 도메인 키를 추출한다.
 * 예: "interview-1: ..." → "interview", "identity-4 — ..." → "identity"
 * prefix 패턴이 없으면 제목 전체를 소문자로 (= 단독 레인) 반환한다.
 */
export function parseDomainKey(title: string): string {
  const trimmed = title.trim();
  const m = trimmed.match(DOMAIN_PATTERN);
  if (m && m[1]) return m[1].toLowerCase();
  return trimmed.toLowerCase();
}

/**
 * task 제목에서 슬라이스 번호를 추출한다. 없으면 0.
 * 예: "interview-12: ..." → 12
 */
export function parseSliceNumber(title: string): number {
  const m = title.trim().match(DOMAIN_PATTERN);
  if (m && m[2]) {
    const n = Number.parseInt(m[2], 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * task 목록을 도메인 레인으로 그룹핑한다.
 * - 각 레인 내부는 슬라이스 번호 오름차순(동률 시 제목 오름차순) 정렬
 * - 레인 자체는 도메인명 오름차순 정렬 (결정적 순서 보장)
 */
export function groupTasksByDomain(tasks: BatchTaskInput[]): DomainLane[] {
  const byDomain = new Map<string, BatchTaskInput[]>();
  for (const task of tasks) {
    const list = byDomain.get(task.domain);
    if (list) {
      list.push(task);
    } else {
      byDomain.set(task.domain, [task]);
    }
  }

  const lanes: DomainLane[] = [];
  for (const [domain, list] of byDomain) {
    const sorted = [...list].sort((a, b) => {
      if (a.slice !== b.slice) return a.slice - b.slice;
      return a.title.localeCompare(b.title);
    });
    lanes.push({ domain, tasks: sorted });
  }

  lanes.sort((a, b) => a.domain.localeCompare(b.domain));
  return lanes;
}

/**
 * NotionTaskSummary 유사 객체(제목·pageId·projectPath 보유)를 BatchTaskInput 으로 변환.
 */
export function toBatchTaskInput(task: {
  pageId: string;
  title: string;
  projectPath: string;
}): BatchTaskInput {
  return {
    pageId: task.pageId,
    title: task.title,
    projectPath: task.projectPath,
    domain: parseDomainKey(task.title),
    slice: parseSliceNumber(task.title),
  };
}

/**
 * items 를 최대 concurrency 개씩 동시에 처리하는 일반 풀.
 * 결과는 입력 순서를 보존한다. worker 가 throw 하면 해당 항목은 reject 되지만
 * (Promise.all 의미상) 다른 항목 실행에는 영향을 주지 않도록 호출 측에서
 * worker 내부에서 try/catch 로 결과를 감싸 사용하는 것을 권장한다.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const current = cursor++;
      if (current >= items.length) return;
      const item = items[current] as T;
      results[current] = await worker(item, current);
    }
  }

  const workers: Array<Promise<void>> = [];
  const n = Math.min(limit, items.length);
  for (let i = 0; i < n; i++) {
    workers.push(runner());
  }
  await Promise.all(workers);
  return results;
}

/**
 * 배치 결과 outcome 목록으로 요약 통계를 만든다.
 */
export function summarizeOutcomes(
  outcomes: BatchTaskOutcome[],
  lanes: DomainLane[],
  dryRun: boolean,
): BatchBuildSummary {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o.status === "succeeded") succeeded++;
    else if (o.status === "failed") failed++;
    else skipped++;
  }
  return {
    total: outcomes.length,
    succeeded,
    failed,
    skipped,
    outcomes,
    dryRun,
    lanes: lanes.map((l) => ({ domain: l.domain, titles: l.tasks.map((t) => t.title) })),
  };
}
