"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PhaseBadge } from "@/components/phase-badge";
import { PhaseProgress } from "@/components/phase-progress";
import { EventLog } from "@/components/event-log";
import { useSocket } from "@/lib/socket";
import {
  getWorkflowStatuses,
  getWorkflowReport,
  resumeWorkflow,
  type WorkflowStatus,
  type WorkflowReport,
} from "@/lib/api";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [report, setReport] = useState<WorkflowReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { events } = useSocket();

  // 이 워크플로우의 이벤트만 필터링
  const filteredEvents = events.filter((e) => {
    if ("workflowId" in e) {
      return e.workflowId === workflowId;
    }
    return false;
  });

  useEffect(() => {
    async function load() {
      try {
        const [statusRes] = await Promise.all([getWorkflowStatuses()]);
        const found = statusRes.workflows.find((w) => w.workflowId === workflowId);
        setWorkflow(found ?? null);

        // 리포트 시도
        try {
          const rpt = await getWorkflowReport();
          if (rpt.workflowId === workflowId) {
            setReport(rpt);
          }
        } catch {
          // 리포트 없을 수 있음
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [workflowId]);

  async function handleResume() {
    if (!workflow) return;
    try {
      await resumeWorkflow(workflow.projectPath);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading...</div>;
  }

  if (!workflow) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Workflow not found: {workflowId}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 text-brand-600 hover:underline text-sm"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">
              {workflow.projectName}
            </h1>
            <PhaseBadge phase={workflow.currentPhase} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{workflow.taskDescription}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            {workflow.workflowId}
          </p>
        </div>

        {/* 재시작 버튼 */}
        {(workflow.currentPhase === "stopped" || workflow.currentPhase === "failed") && (
          <button
            onClick={handleResume}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Resume
          </button>
        )}
      </div>

      {/* 진행 상태 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Progress</h2>
        <PhaseProgress currentPhase={workflow.currentPhase} />
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Current Cycle</span>
            <p className="font-semibold text-gray-900">{workflow.currentCycle}</p>
          </div>
          <div>
            <span className="text-gray-500">Elapsed</span>
            <p className="font-semibold text-gray-900">
              {formatDuration(workflow.elapsed)}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Last Review</span>
            <p
              className={`font-semibold ${
                workflow.lastReviewStatus === "APPROVED"
                  ? "text-green-600"
                  : workflow.lastReviewStatus === "CHANGES_REQUESTED"
                    ? "text-amber-600"
                    : "text-gray-400"
              }`}
            >
              {workflow.lastReviewStatus ?? "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* 리포트 (있을 때) */}
      {report && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Report</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Total Cycles</span>
              <p className="font-semibold">{report.totalCycles}</p>
            </div>
            <div>
              <span className="text-gray-500">Total Duration</span>
              <p className="font-semibold">{formatDuration(report.totalDuration)}</p>
            </div>
          </div>

          {/* 사이클 기록 */}
          {report.cycles.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-gray-500 mb-2">Cycles</h3>
              <div className="space-y-2">
                {report.cycles.map((cycle) => (
                  <div
                    key={cycle.cycleNumber}
                    className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg text-sm"
                  >
                    <span className="font-medium">Cycle {cycle.cycleNumber}</span>
                    <div className="flex items-center gap-4">
                      <span
                        className={
                          cycle.reviewStatus === "APPROVED"
                            ? "text-green-600 font-medium"
                            : "text-amber-600 font-medium"
                        }
                      >
                        {cycle.reviewStatus}
                      </span>
                      <span className="text-gray-500">
                        {cycle.findingsCount} findings
                      </span>
                      <span className="text-gray-400">{formatDuration(cycle.duration)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PR 링크 */}
          {report.prUrl && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <a
                href={report.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline text-sm font-medium"
              >
                View Pull Request
              </a>
            </div>
          )}
        </div>
      )}

      {/* 실시간 이벤트 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Live Events</h2>
        <EventLog events={filteredEvents} />
      </div>

      {/* 에러 */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
    </div>
  );
}
