/**
 * 워크플로우 이벤트 타입 정의
 */

import type { WorkflowPhase, WorkflowResult } from "./workflow.js";
import type { ReviewResult } from "./review.js";

export type WorkflowEventType =
  | "workflow:start"
  | "workflow:end"
  | "phase:start"
  | "phase:complete"
  | "cycle:complete";

export const WORKFLOW_EVENTS: WorkflowEventType[] = [
  "workflow:start",
  "workflow:end",
  "phase:start",
  "phase:complete",
  "cycle:complete",
];

export interface WorkflowStartEvent {
  type: "workflow:start";
  workflowId: string;
  projectPath: string;
  taskDescription: string;
  timestamp: string;
}

export interface WorkflowEndEvent {
  type: "workflow:end";
  workflowId: string;
  result: WorkflowResult;
  timestamp: string;
}

export interface PhaseStartEvent {
  type: "phase:start";
  phase: WorkflowPhase;
  cycleNumber: number;
  workflowId: string;
  timestamp: string;
}

export interface PhaseCompleteEvent {
  type: "phase:complete";
  phase: WorkflowPhase;
  cycleNumber: number;
  workflowId: string;
  duration: number;
  timestamp: string;
}

export interface CycleCompleteEvent {
  type: "cycle:complete";
  cycleNumber: number;
  workflowId: string;
  reviewResult: ReviewResult;
  duration: number;
  timestamp: string;
}

export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowEndEvent
  | PhaseStartEvent
  | PhaseCompleteEvent
  | CycleCompleteEvent;
