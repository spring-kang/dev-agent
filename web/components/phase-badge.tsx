/**
 * PhaseBadge - 워크플로우 단계 상태 배지
 */

const PHASE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  initializing: { label: "Initializing", color: "bg-cyan-100 text-cyan-700", icon: "..." },
  planning: { label: "Planning", color: "bg-blue-100 text-blue-700", icon: "..." },
  implementation: { label: "Implementation", color: "bg-yellow-100 text-yellow-700", icon: "..." },
  review: { label: "Review", color: "bg-purple-100 text-purple-700", icon: "..." },
  pr_creation: { label: "PR Creation", color: "bg-green-100 text-green-700", icon: "..." },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700", icon: "..." },
  failed: { label: "Failed", color: "bg-red-100 text-red-700", icon: "..." },
  stopped: { label: "Stopped", color: "bg-gray-100 text-gray-700", icon: "..." },
};

export function PhaseBadge({ phase }: { phase: string }) {
  const config = PHASE_CONFIG[phase] ?? {
    label: phase,
    color: "bg-gray-100 text-gray-600",
    icon: "?",
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}
