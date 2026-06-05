"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getNotionStatus,
  getNotionTasks,
  type NotionStatus,
  type NotionTaskSummary,
} from "@/lib/api";

export default function NotionTasksPage() {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [tasks, setTasks] = useState<NotionTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbInput, setDbInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  async function loadStatus() {
    try {
      const s = await getNotionStatus();
      setStatus(s);
      if (s.defaultDatabaseId) setDbInput(s.defaultDatabaseId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadTasks(opts?: { db?: string; status?: string }) {
    setLoading(true);
    setError(null);
    try {
      const params: { db?: string; status?: string; max?: number } = { max: 50 };
      if (opts?.db) params.db = opts.db;
      if (opts?.status) params.status = opts.status;
      const res = await getNotionTasks(params);
      setTasks(res.tasks);
    } catch (err) {
      setError((err as Error).message);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadStatus();
      await loadTasks();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status && !status.configured) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Notion Tasks</h1>
        <div className="p-4 bg-amber-50 text-amber-800 rounded-lg">
          Notion 인증이 설정되지 않았습니다.{" "}
          <Link href="/settings" className="underline font-medium">
            설정 페이지
          </Link>
          에서 Integration Token을 등록하세요.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Notion Tasks</h1>
        {status?.configured && (
          <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded">
            {status.tokenPreview}
          </span>
        )}
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Database ID
          </label>
          <input
            type="text"
            value={dbInput}
            onChange={(e) => setDbInput(e.target.value)}
            placeholder={status?.defaultDatabaseId ? "(default DB 사용)" : "32자리 UUID"}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
          />
        </div>
        <div className="w-48">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Status (Notion 옵션명)
          </label>
          <input
            type="text"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="e.g. To Do"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <button
          onClick={() =>
            loadTasks({
              ...(dbInput.trim() ? { db: dbInput.trim() } : {}),
              ...(statusFilter.trim() ? { status: statusFilter.trim() } : {}),
            })
          }
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium hover:bg-brand-700"
        >
          조회
        </button>
      </div>

      {/* 결과 */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          조회된 task가 없습니다. Database가 통합에 연결되어 있는지 확인하세요.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Title
                </th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Status
                </th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Assignee
                </th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Project Path
                </th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">
                  Refs
                </th>
                <th className="text-left px-4 py-2 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((t) => (
                <tr key={t.pageId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {t.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{t.status ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {t.assignees.map((a) => a.name).join(", ") || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                    {t.projectPath || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.referenceUrls.length}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/workflows/new?pageId=${encodeURIComponent(t.pageId)}`}
                      className="px-3 py-1 bg-brand-50 text-brand-700 rounded text-xs font-medium hover:bg-brand-100"
                    >
                      Run
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
