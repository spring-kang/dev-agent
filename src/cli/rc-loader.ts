/**
 * .devagentrc 그러파일 로더
 *
 * 우선순위 (높은 → 낮은):
 *   1. CLI 옵션 (사용자가 명령어에 명시한 값)
 *   2. 환경변수 DEVAGENT_* (예: DEVAGENT_TASK, DEVAGENT_VERBOSE)
 *   3. cwd ↑ 상위 디렉토리에서 발견된 .devagentrc.json (가장 가까운 것)
 *   4. ~/.dev-agent/devagentrc.json (글로벌 사용자 기본값)
 *
 * 지원 키:
 *   - task          : 기본 Notion task ID/URL (run --task 생략 시 사용)
 *   - projectPath   : 기본 프로젝트 경로
 *   - maxIterations : 기본 최대 사이클 수
 *   - verbose       : 항상 verbose 모드
 *   - skipEnhancement : 기본 skip-enhancement 동작
 *   - notion        : { defaultDatabaseId } — Notion 관련 기본값
 *
 * 모든 키는 선택. 빈 파일/누락 키는 무시.
 */

import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

export interface DevAgentRC {
  task?: string;
  projectPath?: string;
  maxIterations?: number;
  verbose?: boolean;
  skipEnhancement?: boolean;
  notion?: {
    defaultDatabaseId?: string;
  };
}

export interface RCResolveResult {
  rc: DevAgentRC;
  sources: string[]; // 어떤 파일/환경에서 왔는지 (디버그용)
}

const RC_FILENAMES = [".devagentrc.json", ".devagentrc"];
const GLOBAL_RC_PATH = path.join(homedir(), ".dev-agent", "devagentrc.json");

/**
 * cwd부터 root까지 거슬러 올라가며 가장 가까운 rc 파일을 찾는다.
 * 못 찾으면 null.
 */
async function findNearestRC(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    for (const filename of RC_FILENAMES) {
      const candidate = path.join(current, filename);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // 파일 없음 → 다음 후보
      }
    }
    if (current === root) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readJSONSafe(filePath: string): Promise<DevAgentRC | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length === 0) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DevAgentRC;
  } catch {
    return null;
  }
}

/**
 * 환경변수 → rc로 변환.
 * DEVAGENT_TASK, DEVAGENT_PROJECT_PATH, DEVAGENT_MAX_ITERATIONS,
 * DEVAGENT_VERBOSE, DEVAGENT_SKIP_ENHANCEMENT, DEVAGENT_DEFAULT_DB
 */
function rcFromEnv(env: NodeJS.ProcessEnv): DevAgentRC {
  const rc: DevAgentRC = {};

  if (env["DEVAGENT_TASK"]) rc.task = env["DEVAGENT_TASK"];
  if (env["DEVAGENT_PROJECT_PATH"]) rc.projectPath = env["DEVAGENT_PROJECT_PATH"];

  const maxIter = env["DEVAGENT_MAX_ITERATIONS"];
  if (maxIter && !isNaN(Number(maxIter))) {
    rc.maxIterations = Number(maxIter);
  }

  if (env["DEVAGENT_VERBOSE"] === "1" || env["DEVAGENT_VERBOSE"] === "true") {
    rc.verbose = true;
  }
  if (
    env["DEVAGENT_SKIP_ENHANCEMENT"] === "1" ||
    env["DEVAGENT_SKIP_ENHANCEMENT"] === "true"
  ) {
    rc.skipEnhancement = true;
  }

  if (env["DEVAGENT_DEFAULT_DB"]) {
    rc.notion = { defaultDatabaseId: env["DEVAGENT_DEFAULT_DB"] };
  }

  return rc;
}

/**
 * 두 rc 객체를 병합. b가 a를 override.
 */
function mergeRC(a: DevAgentRC, b: DevAgentRC): DevAgentRC {
  const merged: DevAgentRC = { ...a };

  if (b.task !== undefined) merged.task = b.task;
  if (b.projectPath !== undefined) merged.projectPath = b.projectPath;
  if (b.maxIterations !== undefined) merged.maxIterations = b.maxIterations;
  if (b.verbose !== undefined) merged.verbose = b.verbose;
  if (b.skipEnhancement !== undefined) merged.skipEnhancement = b.skipEnhancement;
  if (b.notion) {
    merged.notion = { ...(a.notion ?? {}), ...b.notion };
  }

  return merged;
}

/**
 * 그러파일을 읽고 환경변수와 병합하여 최종 rc를 반환.
 * 우선순위: env > 프로젝트 rc > 글로벌 rc.
 * (CLI 옵션은 호출자가 별도로 override.)
 */
export async function loadRC(cwd: string = process.cwd()): Promise<RCResolveResult> {
  const sources: string[] = [];
  let merged: DevAgentRC = {};

  // 1. 글로벌 rc
  const globalRC = await readJSONSafe(GLOBAL_RC_PATH);
  if (globalRC) {
    merged = mergeRC(merged, globalRC);
    sources.push(`global:${GLOBAL_RC_PATH}`);
  }

  // 2. 프로젝트 rc (cwd → root)
  const projectRCPath = await findNearestRC(cwd);
  if (projectRCPath) {
    const projectRC = await readJSONSafe(projectRCPath);
    if (projectRC) {
      merged = mergeRC(merged, projectRC);
      sources.push(`project:${projectRCPath}`);
    }
  }

  // 3. 환경변수
  const envRC = rcFromEnv(process.env);
  if (Object.keys(envRC).length > 0) {
    merged = mergeRC(merged, envRC);
    sources.push("env:DEVAGENT_*");
  }

  return { rc: merged, sources };
}

/**
 * rc 값과 CLI 옵션을 합쳐서 최종 옵션 객체를 만든다.
 * CLI 옵션이 항상 우선.
 *
 * @param rc loadRC 결과
 * @param cliOptions Commander로부터 받은 옵션 객체 (run 커맨드 기준)
 */
export function applyRCToRunOptions(
  rc: DevAgentRC,
  cliOptions: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...cliOptions };

  if (merged["task"] === undefined && rc.task) {
    merged["task"] = rc.task;
  }
  if (merged["project"] === undefined && rc.projectPath) {
    merged["project"] = rc.projectPath;
  }
  if (merged["maxIterations"] === undefined && rc.maxIterations !== undefined) {
    merged["maxIterations"] = rc.maxIterations;
  }
  if (merged["skipEnhancement"] === undefined && rc.skipEnhancement) {
    merged["skipEnhancement"] = true;
  }
  // verbose는 program 레벨에서 처리되므로 별도

  return merged;
}
