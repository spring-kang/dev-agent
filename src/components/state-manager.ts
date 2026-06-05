/**
 * StateManager (C-06) - 워크플로우 상태 영속화
 * NFR: Atomic write (write-then-rename), 무결성 검증, fallback 복원
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowState, WorkflowPhase } from "../types/workflow.js";
import { WORKFLOW_DIRS, STATE_FILE, PHASE_ORDER } from "../types/workflow.js";
import { StateError } from "../types/errors.js";
import type { Logger } from "./logger.js";

const REQUIRED_STATE_FIELDS = [
  "workflowId",
  "projectPath",
  "status",
  "currentPhase",
] as const;

export class StateManager {
  constructor(private readonly logger: Logger) {}

  /**
   * 상태 저장 (atomic write)
   */
  async save(state: WorkflowState): Promise<void> {
    const stateDir = path.join(state.projectPath, WORKFLOW_DIRS.current);
    const statePath = path.join(stateDir, STATE_FILE);
    const tmpPath = statePath + ".tmp";

    try {
      await fs.mkdir(stateDir, { recursive: true });

      // 타임스탬프 갱신
      state.updatedAt = new Date().toISOString();

      const json = JSON.stringify(state, null, 2);

      // Atomic write: tmp 파일에 쓰기 → rename
      const fd = await fs.open(tmpPath, "w");
      try {
        await fd.write(json);
        await fd.datasync();
      } finally {
        await fd.close();
      }

      await fs.rename(tmpPath, statePath);
      this.logger.debug(`상태 저장 완료: ${statePath}`);
    } catch (error) {
      // tmp 파일 정리 시도
      try {
        await fs.unlink(tmpPath);
      } catch {
        // 정리 실패 무시
      }

      this.logger.warn(`상태 저장 실패: ${(error as Error).message}`);
      // 상태 저장 실패는 워크플로우를 중단하지 않음 (best effort)
    }
  }

  /**
   * 상태 복원 + 무결성 검증
   */
  async restore(projectPath: string): Promise<WorkflowState | null> {
    const statePath = path.join(projectPath, WORKFLOW_DIRS.current, STATE_FILE);

    try {
      const content = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(content) as WorkflowState;

      // 필수 필드 검증
      this.validateState(state, statePath);

      // 산출물 존재 여부 확인 + phase fallback
      const adjustedState = await this.adjustPhaseIfNeeded(state);

      return adjustedState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      if (error instanceof StateError) {
        throw error;
      }
      throw new StateError(
        `상태 파일 복원 실패: ${(error as Error).message}`,
        statePath,
        "recoverable",
        error as Error,
      );
    }
  }

  /**
   * 워크플로우 아카이브 (현재 상태를 archive로 이동)
   */
  async archive(projectPath: string, workflowId: string): Promise<void> {
    const currentDir = path.join(projectPath, WORKFLOW_DIRS.current);
    const archiveDir = path.join(
      projectPath,
      WORKFLOW_DIRS.archive,
      `${workflowId}-${Date.now()}`,
    );

    try {
      // archive 디렉토리 생성
      await fs.mkdir(archiveDir, { recursive: true });

      // current 내용을 archive로 복사
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(currentDir, entry.name);
        const destPath = path.join(archiveDir, entry.name);

        if (entry.isFile()) {
          await fs.copyFile(srcPath, destPath);
        } else if (entry.isDirectory()) {
          await this.copyDir(srcPath, destPath);
        }
      }

      // current 디렉토리 정리 (재생성)
      await fs.rm(currentDir, { recursive: true, force: true });
      await fs.mkdir(currentDir, { recursive: true });

      this.logger.info(`워크플로우 아카이브 완료: ${archiveDir}`);
    } catch (error) {
      this.logger.warn(`아카이브 실패: ${(error as Error).message}`);
    }
  }

  /**
   * 상태 업데이트 헬퍼 (phase 변경)
   */
  async updatePhase(state: WorkflowState, phase: WorkflowPhase): Promise<void> {
    state.currentPhase = phase;
    await this.save(state);
  }

  private validateState(state: WorkflowState, statePath: string): void {
    for (const field of REQUIRED_STATE_FIELDS) {
      if (state[field] === undefined || state[field] === null) {
        throw new StateError(
          `상태 파일에 필수 필드 누락: ${field}`,
          statePath,
          "recoverable",
        );
      }
    }
  }

  /**
   * 산출물 파일 존재 여부에 따라 phase를 조정 (fallback)
   */
  private async adjustPhaseIfNeeded(state: WorkflowState): Promise<WorkflowState> {
    if (state.currentPhase === "review" || state.currentPhase === "implementation") {
      // implementation/review 단계에서 복원 시, 이전 단계 산출물 확인
      const artifacts = state.artifacts;

      if (state.currentPhase === "review") {
        // review 단계인데 changedFiles가 없으면 implementation부터 재시작
        if (!artifacts.changedFiles || artifacts.changedFiles.length === 0) {
          this.logger.warn("리뷰 단계 복원: 변경 파일 정보 없음 → implementation 단계로 조정");
          state.currentPhase = "implementation";
        }
      }

      if (state.currentPhase === "implementation") {
        // implementation 단계인데 implementationSpec이 없으면 planning부터 재시작
        if (!artifacts.implementationSpecPath) {
          this.logger.warn("구현 단계 복원: 기획 산출물 없음 → planning 단계로 조정");
          state.currentPhase = "planning";
        } else {
          // 파일이 실제로 존재하는지 확인
          try {
            await fs.access(artifacts.implementationSpecPath);
          } catch {
            this.logger.warn("구현 단계 복원: 기획 파일 접근 불가 → planning 단계로 조정");
            state.currentPhase = "planning";
          }
        }
      }
    }

    return state;
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      } else if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      }
    }
  }
}
