"use client";

import type { WorkflowEvent } from "@/lib/socket";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getEventLabel(event: WorkflowEvent): { label: string; color: string; detail: string } {
  switch (event.type) {
    case "workflow:start":
      return {
        label: "START",
        color: "text-blue-600 bg-blue-50",
        detail: `Workflow started: ${event.taskDescription}`,
      };
    case "workflow:end":
      return {
        label: event.result.status.toUpperCase(),
        color:
          event.result.status === "completed"
            ? "text-green-600 bg-green-50"
            : "text-red-600 bg-red-50",
        detail: `${event.result.status} (${event.result.totalCycles} cycles)${
          event.result.prUrl ? ` - PR: ${event.result.prUrl}` : ""
        }`,
      };
    case "phase:start":
      return {
        label: "PHASE",
        color: "text-purple-600 bg-purple-50",
        detail: `${event.phase} started (cycle ${event.cycleNumber})`,
      };
    case "phase:complete":
      return {
        label: "DONE",
        color: "text-emerald-600 bg-emerald-50",
        detail: `${event.phase} completed (${Math.round(event.duration / 1000)}s)`,
      };
    case "cycle:complete":
      return {
        label: event.reviewResult.status === "APPROVED" ? "PASS" : "RETRY",
        color:
          event.reviewResult.status === "APPROVED"
            ? "text-green-600 bg-green-50"
            : "text-amber-600 bg-amber-50",
        detail: `Cycle ${event.cycleNumber}: ${event.reviewResult.status} (${event.reviewResult.findings.length} findings)`,
      };
    default:
      return { label: "EVENT", color: "text-gray-600 bg-gray-50", detail: "Unknown event" };
  }
}

export function EventLog({ events }: { events: WorkflowEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8">
        Waiting for events...
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto">
      {events.map((event, index) => {
        const { label, color, detail } = getEventLabel(event);
        return (
          <div
            key={index}
            className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-50 text-sm"
          >
            <span className="text-xs text-gray-400 font-mono w-16 flex-shrink-0">
              {formatTimestamp(event.timestamp)}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color} flex-shrink-0`}
            >
              {label}
            </span>
            <span className="text-gray-700">{detail}</span>
          </div>
        );
      })}
    </div>
  );
}
