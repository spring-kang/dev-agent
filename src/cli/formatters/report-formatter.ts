/**
 * 리포트 텍스트 포매팅
 */

import type { WorkflowReport } from "../../services/monitoring.service.js";

export function formatReportText(report: WorkflowReport): string {
  const lines: string[] = [];

  lines.push("\u2550".repeat(50));
  lines.push("  Workflow Report");
  lines.push("\u2550".repeat(50));
  lines.push("");
  lines.push(`  Project:      ${report.projectPath}`);
  lines.push(`  Task:         ${report.taskDescription}`);
  lines.push(`  Status:       ${getStatusIcon(report.status)} ${report.status}`);
  lines.push(`  Duration:     ${formatDuration(report.totalDuration)}`);
  lines.push(`  Total Cycles: ${report.totalCycles}`);
  lines.push(`  PR:           ${report.prUrl ?? "N/A"}`);
  lines.push("");

  if (report.cycles.length > 0) {
    lines.push("\u2500".repeat(50));
    lines.push("  Cycle Summary");
    lines.push("\u2500".repeat(50));
    lines.push("");
    lines.push("  #  \u2502 Duration \u2502 Review          \u2502 Findings");
    lines.push("  \u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

    for (const cycle of report.cycles) {
      const statusIcon = cycle.reviewStatus === "APPROVED" ? "\u2705" : "\u274C";
      const duration = formatDuration(cycle.duration).padEnd(8);
      const status = `${statusIcon} ${cycle.reviewStatus}`.padEnd(15);
      const findings = `${cycle.findingsCount} (${cycle.criticalCount} critical)`;
      lines.push(`  ${String(cycle.cycleNumber).padEnd(2)} \u2502 ${duration} \u2502 ${status} \u2502 ${findings}`);
    }

    lines.push("");
  }

  lines.push("\u2550".repeat(50));
  lines.push(`  Generated at: ${report.generatedAt}`);
  lines.push("\u2550".repeat(50));

  return lines.join("\n");
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "\u2705";
    case "failed":
      return "\u274C";
    case "stopped":
      return "\u23F9\uFE0F";
    default:
      return "\u2753";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}
