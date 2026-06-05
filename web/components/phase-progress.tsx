/**
 * PhaseProgress - 워크플로우 단계 진행 바
 */

const PHASES = [
  { key: "initializing", label: "Init" },
  { key: "planning", label: "Plan" },
  { key: "implementation", label: "Impl" },
  { key: "review", label: "Review" },
  { key: "pr_creation", label: "PR" },
];

const TERMINAL_PHASES = ["completed", "failed", "stopped"];

export function PhaseProgress({ currentPhase }: { currentPhase: string }) {
  const isTerminal = TERMINAL_PHASES.includes(currentPhase);
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, index) => {
        let status: "done" | "active" | "pending";

        if (isTerminal) {
          status = "done";
        } else if (index < currentIndex) {
          status = "done";
        } else if (index === currentIndex) {
          status = "active";
        } else {
          status = "pending";
        }

        return (
          <div key={phase.key} className="flex items-center">
            {index > 0 && (
              <div
                className={`w-6 h-0.5 ${
                  status === "pending" ? "bg-gray-200" : "bg-brand-400"
                }`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  status === "done"
                    ? "bg-brand-500 text-white"
                    : status === "active"
                      ? "bg-brand-100 text-brand-700 ring-2 ring-brand-400"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                {status === "done" ? "\u2713" : index + 1}
              </div>
              <span className="text-[10px] text-gray-500 mt-1">{phase.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
