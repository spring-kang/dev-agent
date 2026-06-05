"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  startWorkflow,
  validateProject,
  startNotionWorkflow,
  getNotionStatus,
  getNotionTasks,
  type NotionTaskSummary,
} from "@/lib/api";

type Mode = "manual" | "notion";

export default function NewWorkflowPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("manual");
  const [notionEnabled, setNotionEnabled] = useState(false);
  const [hasDefaultDb, setHasDefaultDb] = useState(false);

  // 공통
  const [projectPath, setProjectPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 수동 모드
  const [taskDescription, setTaskDescription] = useState("");
  const [maxIterations, setMaxIterations] = useState(5);

  // Notion 모드
  const [tasks, setTasks] = useState<NotionTaskSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [manualPageId, setManualPageId] = useState<string>("");
  const [skipEnhancement, setSkipEnhancement] = useState(false);

  // Notion 상태 조회
  useEffect(() => {
    (async () => {
      try {
        const s = await getNotionStatus();
        setNotionEnabled(s.configured);
        setHasDefaultDb(Boolean(s.defaultDatabaseId));
      } catch {
        setNotionEnabled(false);
      }
    })();
  }, []);

  // Notion 모드 진입 시 task 로드 (default DB가 있는 경우만)
  useEffect(() => {
    if (mode !== "notion" || !notionEnabled || !hasDefaultDb) return;
    let cancelled = false;
    setTasksLoading(true);
    (async () => {
      try {
        const { tasks } = await getNotionTasks({ max: 50 });
        if (!cancelled) setTasks(tasks);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, notionEnabled, hasDefaultDb]);

  async function handleValidate() {
    if (!projectPath.trim()) return;
    setValidating(true);
    setValidation(null);
    try {
      const result = await validateProject(projectPath);
      setValidation(result);
    } catch (err) {
      setValidation({
        valid: false,
        errors: [(err as Error).message],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === "manual") {
        await startWorkflow(projectPath, taskDescription, { maxIterations });
      } else {
        const pageId = (selectedPageId || manualPageId).trim();
        if (!pageId) {
          throw new Error("Notion page ID 또는 URL을 입력하세요");
        }
        await startNotionWorkflow({
          pageId,
          ...(projectPath.trim() ? { projectPath } : {}),
          skipClaudeEnhancement: skipEnhancement,
        });
      }
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting &&
    (mode === "manual"
      ? projectPath.trim() && taskDescription.trim()
      : selectedPageId || manualPageId.trim());

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Workflow</h1>

      {/* 모드 탭 */}
      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`px-4 py-1.5 text-sm rounded-md ${
            mode === "manual"
              ? "bg-brand-600 text-white"
              : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          직접 입력
        </button>
        <button
          type="button"
          onClick={() => setMode("notion")}
          disabled={!notionEnabled}
          title={!notionEnabled ? "Notion 통합이 필요합니다" : undefined}
          className={`px-4 py-1.5 text-sm rounded-md ${
            mode === "notion"
              ? "bg-brand-600 text-white"
              : "text-gray-600 hover:bg-gray-50"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Notion Task
        </button>
      </div>

      {!notionEnabled && (
        <p className="text-xs text-gray-500 mb-4">
          Notion task 기반 워크플로우를 사용하려면{" "}
          <Link href="/settings" className="text-brand-700 underline">
            설정 페이지
          </Link>
          에서 Notion 인증을 등록하세요.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 프로젝트 경로 (수동에서만 필수, Notion 모드에서는 선택) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project Path {mode === "notion" && <span className="text-xs text-gray-400">(선택 - Notion 속성 우선)</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={projectPath}
              onChange={(e) => {
                setProjectPath(e.target.value);
                setValidation(null);
              }}
              placeholder="/path/to/your/project"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none"
              required={mode === "manual"}
            />
            <button
              type="button"
              onClick={handleValidate}
              disabled={validating || !projectPath.trim()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {validating ? "Checking..." : "Validate"}
            </button>
          </div>

          {validation && (
            <div
              className={`mt-2 p-3 rounded-lg text-sm ${
                validation.valid
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {validation.valid ? (
                <p>Project is valid and ready.</p>
              ) : (
                <ul className="space-y-1">
                  {validation.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
              {validation.warnings.length > 0 && (
                <ul className="mt-1 text-amber-600 space-y-1">
                  {validation.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 모드별 입력 */}
        {mode === "manual" ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Description
              </label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="What should the AI agents work on?"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none resize-none"
                required={mode === "manual"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Iterations
              </label>
              <input
                type="number"
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
                min={1}
                max={20}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Maximum number of plan-implement-review cycles (1-20)
              </p>
            </div>
          </>
        ) : (
          <>
            {hasDefaultDb ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notion Task (Default DB)
                </label>
                {tasksLoading ? (
                  <div className="text-sm text-gray-400 py-2">
                    task 불러오는 중…
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="text-sm text-gray-500 py-2">
                    조회된 task가 없습니다.{" "}
                    <Link
                      href="/integrations/notion"
                      className="text-brand-700 underline"
                    >
                      Notion Tasks 보기
                    </Link>
                  </div>
                ) : (
                  <select
                    value={selectedPageId}
                    onChange={(e) => {
                      setSelectedPageId(e.target.value);
                      setManualPageId("");
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none"
                  >
                    <option value="">task를 선택하세요</option>
                    {tasks.map((t) => (
                      <option key={t.pageId} value={t.pageId}>
                        {t.title} ({t.status ?? "-"})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                또는 Notion Page ID / URL 직접 입력
              </label>
              <input
                type="text"
                value={manualPageId}
                onChange={(e) => {
                  setManualPageId(e.target.value);
                  setSelectedPageId("");
                }}
                placeholder="https://www.notion.so/... 또는 32자리 UUID"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={skipEnhancement}
                  onChange={(e) => setSkipEnhancement(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Claude 보강 건너뛰기 (즉시 fallback 사용)
              </label>
            </div>
          </>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Starting..." : "Start Workflow"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
