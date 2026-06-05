/**
 * 에러 계층 구조 - 모든 애플리케이션 에러의 베이스 클래스
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly severity: "critical" | "recoverable";
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    // Error 프로토타입 체인 복원
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toLogEntry(): Record<string, unknown> {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

// ── U-01: Config 에러 ──

export class ConfigError extends AppError {
  readonly code = "CONFIG_ERROR" as const;
  readonly severity = "critical" as const;
  readonly configSource: string;

  constructor(message: string, configSource: string, cause?: Error) {
    super(message, cause);
    this.configSource = configSource;
  }
}

export class ConfigValidationError extends AppError {
  readonly code = "CONFIG_VALIDATION_ERROR" as const;
  readonly severity = "critical" as const;
  readonly invalidKeys: string[];
  readonly configSource: string;

  constructor(message: string, invalidKeys: string[], configSource: string) {
    super(message);
    this.invalidKeys = invalidKeys;
    this.configSource = configSource;
  }
}

// ── U-01: Workspace 에러 ──

export class WorkspaceError extends AppError {
  readonly code = "WORKSPACE_ERROR" as const;
  readonly severity = "critical" as const;
  readonly projectPath: string;

  constructor(message: string, projectPath: string, cause?: Error) {
    super(message, cause);
    this.projectPath = projectPath;
  }
}

export class PrerequisiteError extends AppError {
  readonly code = "PREREQUISITE_ERROR" as const;
  readonly severity = "critical" as const;
  readonly missingTools: string[];

  constructor(message: string, missingTools: string[]) {
    super(message);
    this.missingTools = missingTools;
  }
}

// ── U-01: State 에러 ──

export class StateError extends AppError {
  readonly code = "STATE_ERROR" as const;
  readonly severity: "critical" | "recoverable";
  readonly statePath: string;

  constructor(
    message: string,
    statePath: string,
    severity: "critical" | "recoverable" = "recoverable",
    cause?: Error,
  ) {
    super(message, cause);
    this.severity = severity;
    this.statePath = statePath;
  }
}

// ── U-02: Agent 에러 ──

export class AgentTimeoutError extends AppError {
  readonly code = "AGENT_TIMEOUT" as const;
  readonly severity = "recoverable" as const;
  readonly agentName: string;
  readonly timeout: number;

  constructor(agentName: string, timeout: number) {
    super(`${agentName} 에이전트가 ${Math.round(timeout / 1000)}초 내에 응답하지 않았습니다`);
    this.agentName = agentName;
    this.timeout = timeout;
  }
}

export class AgentProcessError extends AppError {
  readonly code = "AGENT_PROCESS_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly agentName: string;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(agentName: string, exitCode: number, stderr: string) {
    super(`${agentName} 에이전트가 비정상 종료되었습니다 (exit code: ${exitCode})`);
    this.agentName = agentName;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class AgentOutputError extends AppError {
  readonly code = "AGENT_OUTPUT_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly agentName: string;
  readonly rawOutput: string;

  constructor(agentName: string, rawOutput: string) {
    super(`${agentName} 에이전트 출력을 파싱할 수 없습니다`);
    this.agentName = agentName;
    this.rawOutput = rawOutput.slice(0, 500);
  }
}

// ── U-04: Git 에러 ──

export class GitError extends AppError {
  readonly code = "GIT_ERROR" as const;
  readonly severity: "critical" | "recoverable";
  readonly command: string;
  readonly stderr: string;
  readonly cwd: string;

  constructor(
    message: string,
    command: string,
    stderr: string,
    cwd: string,
    severity: "critical" | "recoverable" = "recoverable",
    cause?: Error,
  ) {
    super(message, cause);
    this.command = command;
    this.stderr = stderr;
    this.cwd = cwd;
    this.severity = severity;
  }
}

export class GitTimeoutError extends AppError {
  readonly code = "GIT_TIMEOUT" as const;
  readonly severity = "recoverable" as const;
  readonly command: string;
  readonly timeout: number;
  readonly cwd: string;

  constructor(command: string, timeout: number, cwd: string) {
    super(`Git 명령 타임아웃 (${Math.round(timeout / 1000)}s): ${command}`);
    this.command = command;
    this.timeout = timeout;
    this.cwd = cwd;
  }
}

export class GitPushError extends AppError {
  readonly code = "GIT_PUSH_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly branchName: string;
  readonly stderr: string;
  readonly cwd: string;

  constructor(branchName: string, stderr: string, cwd: string) {
    super(`Git push 실패: ${branchName}`);
    this.branchName = branchName;
    this.stderr = stderr;
    this.cwd = cwd;
  }
}

export class GitPrError extends AppError {
  readonly code = "GIT_PR_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly stderr: string;
  readonly cwd: string;
  readonly existingPrUrl?: string;

  constructor(stderr: string, cwd: string, existingPrUrl?: string) {
    super("PR 생성 실패");
    this.stderr = stderr;
    this.cwd = cwd;
    this.existingPrUrl = existingPrUrl;
  }
}

// ── U-03: Orchestrator 에러 ──

export class OrchestratorError extends AppError {
  readonly code = "ORCHESTRATOR_ERROR" as const;
  readonly severity: "critical" | "recoverable";
  readonly workflowId: string;
  readonly phase?: string;
  readonly cycleNumber?: number;

  constructor(
    message: string,
    workflowId: string,
    severity: "critical" | "recoverable" = "recoverable",
    phase?: string,
    cycleNumber?: number,
    cause?: Error,
  ) {
    super(message, cause);
    this.workflowId = workflowId;
    this.severity = severity;
    this.phase = phase;
    this.cycleNumber = cycleNumber;
  }
}

export class ParallelConflictError extends AppError {
  readonly code = "PARALLEL_CONFLICT" as const;
  readonly severity = "critical" as const;
  readonly conflictingPaths: string[];

  constructor(conflictingPaths: string[]) {
    super(`같은 프로젝트에 대한 병렬 실행은 허용되지 않습니다: ${conflictingPaths.join(", ")}`);
    this.conflictingPaths = conflictingPaths;
  }
}

export class ReviewParseError extends AppError {
  readonly code = "REVIEW_PARSE_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly rawOutput: string;
  readonly parseAttempts: string[];

  constructor(rawOutput: string, parseAttempts: string[]) {
    super("리뷰 결과를 파싱할 수 없습니다");
    this.rawOutput = rawOutput.slice(0, 500);
    this.parseAttempts = parseAttempts;
  }
}

// ── U-05: CLI 에러 ──

export class CliError extends AppError {
  readonly code = "CLI_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly command: string;
  readonly exitCode: number;

  constructor(message: string, command: string, exitCode: number = 1) {
    super(message);
    this.command = command;
    this.exitCode = exitCode;
  }
}

export class CliValidationError extends AppError {
  readonly code = "CLI_VALIDATION_ERROR" as const;
  readonly severity = "recoverable" as const;
  readonly command: string;
  readonly exitCode = 2;
  readonly invalidArgs: string[];

  constructor(message: string, command: string, invalidArgs: string[] = []) {
    super(message);
    this.command = command;
    this.invalidArgs = invalidArgs;
  }
}

export class WorkflowServiceError extends AppError {
  readonly code = "WORKFLOW_SERVICE_ERROR" as const;
  readonly severity: "critical" | "recoverable";
  readonly phase?: string;

  constructor(
    message: string,
    severity: "critical" | "recoverable" = "recoverable",
    phase?: string,
    cause?: Error,
  ) {
    super(message, cause);
    this.severity = severity;
    this.phase = phase;
  }
}

export class PreflightError extends AppError {
  readonly code = "PREFLIGHT_ERROR" as const;
  readonly severity = "critical" as const;
  readonly failedChecks: string[];

  constructor(failedChecks: string[]) {
    super(`사전 검증 실패: ${failedChecks.join(", ")}`);
    this.failedChecks = failedChecks;
  }
}

// ── 에러 힌트 매핑 ──

export const ERROR_HINTS: Record<string, string> = {
  AGENT_TIMEOUT: "'dev-agent resume'로 재시작해보세요",
  AGENT_PROCESS_ERROR: "에이전트 CLI가 올바르게 설치되었는지 확인하세요",
  AGENT_OUTPUT_ERROR: "에이전트 출력 형식이 변경되었을 수 있습니다",
  GIT_ERROR: "Git 저장소 상태를 확인하세요",
  GIT_PUSH_ERROR: "네트워크 연결 또는 원격 저장소 접근 권한을 확인하세요",
  GIT_PR_ERROR: "GitHub CLI(gh) 인증 상태를 확인하세요",
  GIT_TIMEOUT: "네트워크 연결을 확인하세요",
  PREREQUISITE_ERROR: "'claude --version', 'codex --version' 명령으로 설치를 확인하세요",
  CONFIG_ERROR: "설정 파일 형식을 확인하세요",
  CONFIG_VALIDATION_ERROR: "설정 값의 유효성을 확인하세요",
  WORKSPACE_ERROR: "프로젝트 경로가 올바른지 확인하세요",
  STATE_ERROR: "'dev-agent resume'로 복구하거나 새로 시작하세요",
  ORCHESTRATOR_ERROR: "'dev-agent resume'로 재시작해보세요",
  PARALLEL_CONFLICT: "각 프로젝트 경로가 고유한지 확인하세요",
  PREFLIGHT_ERROR: "필수 조건을 충족한 후 다시 시도하세요",
  CLI_VALIDATION_ERROR: "'dev-agent --help'로 사용법을 확인하세요",
};
