/**
 * Socket.IO 클라이언트 - 실시간 워크플로우 이벤트 수신
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = "http://localhost:3001";

// ── 이벤트 타입 (백엔드와 동기화) ──

export interface PhaseStartEvent {
  type: "phase:start";
  phase: string;
  cycleNumber: number;
  workflowId: string;
  timestamp: string;
}

export interface PhaseCompleteEvent {
  type: "phase:complete";
  phase: string;
  cycleNumber: number;
  workflowId: string;
  duration: number;
  timestamp: string;
}

export interface CycleCompleteEvent {
  type: "cycle:complete";
  cycleNumber: number;
  workflowId: string;
  reviewResult: {
    status: "APPROVED" | "CHANGES_REQUESTED";
    findings: Array<{ severity: string; description: string }>;
    summary: string;
  };
  duration: number;
  timestamp: string;
}

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
  result: {
    status: "completed" | "failed" | "stopped";
    prUrl?: string;
    totalCycles: number;
    duration: number;
  };
  timestamp: string;
}

export type WorkflowEvent =
  | PhaseStartEvent
  | PhaseCompleteEvent
  | CycleCompleteEvent
  | WorkflowStartEvent
  | WorkflowEndEvent;

// ── Socket Hook ──

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    // 모든 워크플로우 이벤트 수신
    const eventTypes = [
      "workflow:start",
      "workflow:end",
      "phase:start",
      "phase:complete",
      "cycle:complete",
    ];

    for (const eventType of eventTypes) {
      socket.on(eventType, (event: WorkflowEvent) => {
        setEvents((prev) => [...prev, event]);
      });
    }

    return () => {
      socket.disconnect();
    };
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return { connected, events, clearEvents };
}
