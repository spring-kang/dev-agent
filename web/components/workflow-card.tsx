"use client";

import Link from "next/link";
import { PhaseBadge } from "./phase-badge";
import { PhaseProgress } from "./phase-progress";
import type { WorkflowStatus } from "@/lib/api";

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WorkflowCard({ workflow }: { workflow: WorkflowStatus }) {
  return (
    <Link
      href={`/workflows/${workflow.workflowId}`}
      className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
    >
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{workflow.projectName}</h3>
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
            {workflow.taskDescription}
          </p>
        </div>
        <PhaseBadge phase={workflow.currentPhase} />
      </div>

      {/* 진행 바 */}
      <div className="mb-4">
        <PhaseProgress currentPhase={workflow.currentPhase} />
      </div>

      {/* 하단 메타 */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <span>Cycle {workflow.currentCycle}</span>
          <span>{formatElapsed(workflow.elapsed)}</span>
        </div>
        <span>{formatTime(workflow.startedAt)}</span>
      </div>

      {/* 리뷰 상태 */}
      {workflow.lastReviewStatus && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <span
            className={`text-xs font-medium ${
              workflow.lastReviewStatus === "APPROVED"
                ? "text-green-600"
                : "text-amber-600"
            }`}
          >
            Last Review: {workflow.lastReviewStatus}
          </span>
        </div>
      )}
    </Link>
  );
}
