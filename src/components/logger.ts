/**
 * Logger (C-07) - 터미널 출력 + JSON Lines 파일 로깅
 * NFR: 민감 정보 마스킹, NO_COLOR 지원, 크기 제한
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import chalk from "chalk";
import type { LogLevel } from "../types/config.js";
import { LOG_LEVEL_PRIORITY } from "../types/config.js";
import { PHASE_ICONS, PHASE_COLORS, type WorkflowPhase } from "../types/workflow.js";

const SENSITIVE_PATTERNS = /secret|token|key|password|api_key|credential/i;
const MAX_LOG_ENTRY_SIZE = 10_000;

export interface LogConfig {
  level: LogLevel;
  logFilePath?: string;
  noColor?: boolean;
  workflowId?: string;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  wfId?: string;
  phase?: string;
  cycle?: number;
  [key: string]: unknown;
}

export class Logger {
  private level: LogLevel;
  private logFilePath?: string;
  private noColor: boolean;
  private workflowId?: string;
  private phase?: WorkflowPhase;
  private cycleNumber?: number;
  private fileHandle?: fs.FileHandle;

  constructor(config: LogConfig) {
    this.level = config.level;
    this.logFilePath = config.logFilePath;
    this.noColor = config.noColor ?? !process.stdout.isTTY;
    this.workflowId = config.workflowId;

    // NO_COLOR 환경변수 존중
    if (process.env["NO_COLOR"] !== undefined) {
      this.noColor = true;
    }
  }

  setPhase(phase: WorkflowPhase): void {
    this.phase = phase;
  }

  setCycleNumber(cycleNumber: number): void {
    this.cycleNumber = cycleNumber;
  }

  setWorkflowId(workflowId: string): void {
    this.workflowId = workflowId;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  /**
   * 자식 로거 생성 (병렬 워크플로우 격리용)
   */
  createChildLogger(workflowId: string, logFilePath?: string): Logger {
    const childConfig: LogConfig = {
      level: this.level,
      logFilePath: logFilePath ?? this.logFilePath,
      noColor: this.noColor,
      workflowId,
    };
    return new Logger(childConfig);
  }

  /**
   * 로그 파일 핸들 닫기
   */
  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = undefined;
    }
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const sanitizedMessage = this.truncate(message);
    const sanitizedMeta = meta ? this.maskSensitiveData(meta) : undefined;

    // 터미널 출력
    this.writeToTerminal(level, sanitizedMessage);

    // 파일 출력
    if (this.logFilePath) {
      const entry = this.buildLogEntry(level, sanitizedMessage, sanitizedMeta);
      this.writeToFile(entry).catch(() => {
        // 로그 파일 쓰기 실패는 무시 (로깅이 핵심 기능 차단 안 함)
      });
    }
  }

  private writeToTerminal(level: LogLevel, message: string): void {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    const phaseIcon = this.phase ? PHASE_ICONS[this.phase] : "";
    const phaseLabel = this.phase ? `[${this.phase}]` : "";

    let prefix: string;
    if (this.noColor) {
      const levelLabel = level.toUpperCase().padEnd(5);
      prefix = `[${time}] ${levelLabel} ${phaseIcon} ${phaseLabel}`;
    } else {
      const colorFn = this.getLevelColor(level);
      const phaseColorName = this.phase ? PHASE_COLORS[this.phase] : undefined;
      const phaseColor = phaseColorName
        ? this.getChalkColor(phaseColorName)
        : (text: string) => text;
      prefix = `${chalk.gray(`[${time}]`)} ${colorFn(level.toUpperCase().padEnd(5))} ${phaseIcon} ${phaseColor(phaseLabel)}`;
    }

    const output = `${prefix} ${message}`;
    if (level === "error") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }

  private buildLogEntry(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): LogEntry {
    return {
      ts: new Date().toISOString(),
      level,
      msg: message,
      wfId: this.workflowId,
      phase: this.phase,
      cycle: this.cycleNumber,
      ...meta,
    };
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    if (!this.logFilePath) return;

    try {
      if (!this.fileHandle) {
        const dir = path.dirname(this.logFilePath);
        await fs.mkdir(dir, { recursive: true });
        this.fileHandle = await fs.open(this.logFilePath, "a");
      }
      const line = JSON.stringify(entry) + "\n";
      await this.fileHandle.write(line);
    } catch {
      // 파일 쓰기 실패 무시
    }
  }

  private getLevelColor(level: LogLevel): (text: string) => string {
    switch (level) {
      case "debug":
        return chalk.gray;
      case "info":
        return chalk.blue;
      case "warn":
        return chalk.yellow;
      case "error":
        return chalk.red;
    }
  }

  private maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_PATTERNS.test(key)) {
        masked[key] = "****";
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        masked[key] = this.maskSensitiveData(value as Record<string, unknown>);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  private getChalkColor(colorName: string): (text: string) => string {
    switch (colorName) {
      case "cyan": return chalk.cyan;
      case "blue": return chalk.blue;
      case "yellow": return chalk.yellow;
      case "magenta": return chalk.magenta;
      case "green": return chalk.green;
      case "red": return chalk.red;
      case "gray": return chalk.gray;
      default: return (text: string) => text;
    }
  }

  private truncate(message: string): string {
    if (message.length > MAX_LOG_ENTRY_SIZE) {
      return message.slice(0, MAX_LOG_ENTRY_SIZE) + `[truncated: ${message.length} chars]`;
    }
    return message;
  }
}
