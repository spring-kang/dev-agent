"use client";

import { useEffect, useState } from "react";
import {
  getNotionStatus,
  saveNotionAuth,
  clearNotionAuth,
  testNotionAuth,
  type NotionStatus,
} from "@/lib/api";

export function NotionSettingsPanel() {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [defaultDb, setDefaultDb] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  async function refresh() {
    try {
      const s = await getNotionStatus();
      setStatus(s);
      if (s.defaultDatabaseId) setDefaultDb(s.defaultDatabaseId);
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSave() {
    if (!token.trim()) {
      setMessage({ kind: "err", text: "Token을 입력하세요" });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      await saveNotionAuth({
        token: token.trim(),
        ...(defaultDb.trim() ? { defaultDatabaseId: defaultDb.trim() } : {}),
      });
      setToken("");
      setMessage({ kind: "ok", text: "Notion 인증이 저장되었습니다" });
      await refresh();
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function handleClear() {
    if (!confirm("Notion 인증을 정말 제거할까요?")) return;
    setBusy("clear");
    setMessage(null);
    try {
      await clearNotionAuth();
      setMessage({ kind: "ok", text: "Notion 인증이 제거되었습니다" });
      await refresh();
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await testNotionAuth();
      if (result.ok) {
        setMessage({
          kind: "ok",
          text: `Notion 인증 성공: ${result.bot?.name ?? "(이름 미상)"}`,
        });
      } else {
        setMessage({ kind: "err", text: result.error ?? "인증 실패" });
      }
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Notion Integration</h2>
        {status?.configured && (
          <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded">
            Connected
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <>
          {status?.configured && (
            <div className="mb-4 p-3 bg-gray-50 rounded text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Token</span>
                <span className="font-mono text-gray-700">
                  {status.tokenPreview ?? "-"}
                </span>
              </div>
              {status.defaultDatabaseId && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Default DB</span>
                  <span className="font-mono text-gray-700 text-xs">
                    {status.defaultDatabaseId}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Internal Integration Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ntn_... 또는 secret_..."
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Notion → Settings → My connections → Develop integrations
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Default Task Database ID (선택)
              </label>
              <input
                type="text"
                value={defaultDb}
                onChange={(e) => setDefaultDb(e.target.value)}
                placeholder="32자리 UUID 또는 하이픈 포함"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={busy !== null}
                className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {busy === "save" ? "Saving..." : "Save"}
              </button>
              {status?.configured && (
                <>
                  <button
                    onClick={handleTest}
                    disabled={busy !== null}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    {busy === "test" ? "Testing..." : "Test"}
                  </button>
                  <button
                    onClick={handleClear}
                    disabled={busy !== null}
                    className="px-4 py-2 bg-red-50 text-red-700 rounded text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                  >
                    {busy === "clear" ? "Clearing..." : "Clear"}
                  </button>
                </>
              )}
            </div>

            {message && (
              <div
                className={`p-2 rounded text-sm ${
                  message.kind === "ok"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {message.text}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
