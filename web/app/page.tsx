"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkflowCard } from "@/components/workflow-card";
import { EventLog } from "@/components/event-log";
import { useSocket } from "@/lib/socket";
import { getWorkflowStatuses, getPrerequisites, type WorkflowStatus, type PrerequisiteCheck } from "@/lib/api";

export default function DashboardPage() {
  const [workflows, setWorkflows] = useState<WorkflowStatus[]>([]);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { connected, events } = useSocket();

  useEffect(() => {
    async function load() {
      try {
        const [statusRes, prereqRes] = await Promise.all([
          getWorkflowStatuses(),
          getPrerequisites(),
        ]);
        setWorkflows(statusRes.workflows);
        setPrerequisites(prereqRes.checks);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();

    // 30초마다 상태 갱신
    const interval = setInterval(async () => {
      try {
        const res = await getWorkflowStatuses();
        setWorkflows(res.workflows);
      } catch {
        // 무시
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            AI Development Pipeline Overview
          </p>
        </div>
        <Link
          href="/workflows/new"
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          + New Workflow
        </Link>
      </div>

      {/* 상태 요약 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Active Workflows"
          value={workflows.filter((w) => !["completed", "failed", "stopped"].includes(w.currentPhase)).length}
          color="text-blue-600"
        />
        <StatCard
          label="Completed"
          value={workflows.filter((w) => w.currentPhase === "completed").length}
          color="text-green-600"
        />
        <StatCard
          label="Failed"
          value={workflows.filter((w) => w.currentPhase === "failed").length}
          color="text-red-600"
        />
        <StatCard
          label="Tools Ready"
          value={`${prerequisites.filter((p) => p.found).length}/${prerequisites.length}`}
          color={prerequisites.every((p) => !p.required || p.found) ? "text-green-600" : "text-amber-600"}
        />
      </div>

      {/* 연결 상태 */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-gray-500">
          {connected ? "Real-time connected" : "Connecting..."}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">
          Error: {error}
          <p className="text-sm text-gray-400 mt-2">API server is running? (dev-agent serve)</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {/* 워크플로우 목록 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Workflows</h2>
            {workflows.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
                <p>No workflows yet.</p>
                <Link
                  href="/workflows/new"
                  className="text-brand-600 hover:underline text-sm mt-2 inline-block"
                >
                  Start your first workflow
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {workflows.map((w) => (
                  <WorkflowCard key={w.workflowId} workflow={w} />
                ))}
              </div>
            )}
          </div>

          {/* 실시간 이벤트 로그 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Live Events</h2>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <EventLog events={events} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
