"use client";

import { useEffect, useState } from "react";
import {
  getConfig,
  setConfigValue,
  getPrerequisites,
  type ConfigWithSource,
  type PrerequisiteCheck,
} from "@/lib/api";
import { NotionSettingsPanel } from "@/components/notion-settings-panel";

const CONFIG_LABELS: Record<string, { label: string; description: string; type: string }> = {
  maxIterations: {
    label: "Max Iterations",
    description: "Maximum plan-implement-review cycles (1-20)",
    type: "number",
  },
  branchPrefix: {
    label: "Branch Prefix",
    description: "Git branch prefix for AI workflows",
    type: "text",
  },
  logLevel: {
    label: "Log Level",
    description: "Logging verbosity level",
    type: "select",
  },
  claudeTimeout: {
    label: "Claude Timeout (ms)",
    description: "Timeout for Claude agent operations (30s-15m)",
    type: "number",
  },
  codexTimeout: {
    label: "Codex Timeout (ms)",
    description: "Timeout for Codex agent operations (1m-30m)",
    type: "number",
  },
  prIncludeReviewSummary: {
    label: "PR Review Summary",
    description: "Include review summary in pull requests",
    type: "boolean",
  },
  autoCommit: {
    label: "Auto Commit",
    description: "Automatically commit changes after implementation",
    type: "boolean",
  },
};

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigWithSource | null>(null);
  const [prerequisites, setPrereqs] = useState<PrerequisiteCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [configRes, prereqRes] = await Promise.all([
          getConfig(),
          getPrerequisites(),
        ]);
        setConfig(configRes);
        setPrereqs(prereqRes.checks);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(key: string, value: unknown) {
    setSaving(key);
    setError(null);
    setSuccess(null);
    try {
      await setConfigValue(key, value);
      // 설정 다시 로드
      const configRes = await getConfig();
      setConfig(configRes);
      setSuccess(`${key} saved successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure workflow parameters and view system status
        </p>
      </div>

      {/* 알림 */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>
      )}

      {/* 필수 도구 상태 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Prerequisites</h2>
        <div className="space-y-3">
          {prerequisites.map((check) => (
            <div
              key={check.tool}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    check.found ? "bg-green-500" : check.required ? "bg-red-500" : "bg-gray-300"
                  }`}
                />
                <span className="text-sm font-medium text-gray-700">
                  {check.tool}
                </span>
                {check.required && !check.found && (
                  <span className="text-xs text-red-500 font-medium">Required</span>
                )}
              </div>
              <span className="text-xs text-gray-500 font-mono">
                {check.found ? check.version ?? "found" : "not found"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Notion 통합 */}
      <NotionSettingsPanel />

      {/* 설정 값 */}
      {config && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Workflow Configuration
          </h2>
          <div className="space-y-5">
            {Object.entries(config.value).map(([key, value]) => {
              const meta = CONFIG_LABELS[key];
              if (!meta) return null;

              return (
                <ConfigField
                  key={key}
                  configKey={key}
                  value={value}
                  source={config.sources[key] ?? "default"}
                  meta={meta}
                  saving={saving === key}
                  onSave={(v) => handleSave(key, v)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigField({
  configKey,
  value,
  source,
  meta,
  saving,
  onSave,
}: {
  configKey: string;
  value: unknown;
  source: string;
  meta: { label: string; description: string; type: string };
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const [editValue, setEditValue] = useState<string>(String(value));
  const [edited, setEdited] = useState(false);

  function handleChange(newValue: string) {
    setEditValue(newValue);
    setEdited(newValue !== String(value));
  }

  function handleSave() {
    let parsed: unknown = editValue;
    if (meta.type === "number") parsed = Number(editValue);
    if (meta.type === "boolean") parsed = editValue === "true";
    onSave(parsed);
    setEdited(false);
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">{meta.label}</label>
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
            {source}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
      </div>

      <div className="flex items-center gap-2">
        {meta.type === "boolean" ? (
          <select
            value={String(editValue)}
            onChange={(e) => {
              handleChange(e.target.value);
              // 부울은 즉시 저장
              let parsed: unknown = e.target.value;
              parsed = e.target.value === "true";
              onSave(parsed);
            }}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm"
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ) : meta.type === "select" ? (
          <select
            value={editValue}
            onChange={(e) => {
              handleChange(e.target.value);
              onSave(e.target.value);
            }}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm"
          >
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        ) : (
          <>
            <input
              type={meta.type}
              value={editValue}
              onChange={(e) => handleChange(e.target.value)}
              className="w-32 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
            />
            {edited && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "..." : "Save"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
