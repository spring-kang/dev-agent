/**
 * SocketBridge - EventEmitter 이벤트를 Socket.IO로 브릿지
 * 워크플로우 진행 상황을 실시간으로 프론트엔드에 전달
 */

import type { EventEmitter } from "node:events";
import type { Server as SocketServer } from "socket.io";
import type { Logger } from "../components/logger.js";
import { WORKFLOW_EVENTS } from "../types/events.js";
import type { WorkflowEvent } from "../types/events.js";

export class SocketBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<string, (...args: any[]) => void> = new Map();

  constructor(
    private readonly io: SocketServer,
    private readonly eventEmitter: EventEmitter,
    private readonly logger: Logger,
  ) {}

  /**
   * 브릿지 시작 - 모든 워크플로우 이벤트를 Socket.IO로 포워딩
   */
  start(): void {
    for (const eventType of WORKFLOW_EVENTS) {
      const handler = (event: WorkflowEvent) => {
        try {
          this.io.emit(eventType, event);
          this.logger.debug(`Socket.IO 포워딩: ${eventType}`);
        } catch (error) {
          this.logger.warn(
            `Socket.IO 포워딩 실패: ${eventType} - ${(error as Error).message}`,
          );
        }
      };

      this.handlers.set(eventType, handler);
      this.eventEmitter.on(eventType, handler);
    }

    this.logger.debug("SocketBridge 시작: 이벤트 포워딩 활성화");
  }

  /**
   * 브릿지 중지 - 이벤트 구독 해제
   */
  stop(): void {
    for (const [eventType, handler] of this.handlers) {
      this.eventEmitter.off(eventType, handler);
    }
    this.handlers.clear();
    this.logger.debug("SocketBridge 중지: 이벤트 포워딩 비활성화");
  }
}
