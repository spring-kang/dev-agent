/**
 * StallDetector - 무진척(정체) 사이클 조기 감지
 *
 * 배경: Codex가 변경을 만들지 못한 채(changedFiles=[]) 리뷰가 계속 CHANGES_REQUESTED 를
 * 반환하면, 동일 입력 → 동일 리뷰가 반복되어 maxIterations 까지 사이클이 의미 없이 소모된다.
 * 이를 조기에 감지해 사용자에게 결정을 위임(PR/계속/중단)하기 위한 순수 로직.
 *
 * "무진척(no-progress)" 판정 기준 (둘 중 하나라도 해당):
 *  - (a) Codex가 변경한 파일이 없음 (changedFileCount === 0)
 *  - (b) 직전 사이클과 리뷰 피드백이 완전히 동일 (코드가 바뀌어도 리뷰가 진전 없음)
 * 무진척이 threshold 회 연속되면 정체(stall)로 판정한다.
 */

import type { ReviewResult } from "../types/review.js";

/** 기본 정체 판정 임계치: 무진척 사이클이 N회 연속되면 조기 중단 제안 */
export const NO_PROGRESS_STALL_THRESHOLD = 2;

/**
 * 리뷰 피드백의 안정적인 지문(fingerprint) 생성.
 * - summary(자연어, 표현 변동 가능)는 제외하고 실패 체크 + finding 핵심 필드만 사용.
 * - 정렬하여 순서 변동에 영향받지 않도록 함.
 */
export function feedbackFingerprint(review: ReviewResult): string {
  const failedChecks = review.checks
    .filter((c) => !c.passed)
    .map((c) => c.name)
    .sort();
  const findings = review.findings
    .map((f) => `${f.severity}|${f.location}|${f.description}`)
    .sort();
  return JSON.stringify({ status: review.status, failedChecks, findings });
}

export class StallDetector {
  private consecutive = 0;
  private lastFingerprint: string | null = null;

  constructor(private readonly threshold: number = NO_PROGRESS_STALL_THRESHOLD) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new Error("StallDetector threshold는 1 이상의 정수여야 합니다");
    }
  }

  /**
   * 한 사이클 결과를 기록하고 정체(stall) 여부를 반환.
   * @param changedFileCount 이번 사이클에서 Codex가 변경한 파일 수
   * @param review 이번 사이클 리뷰 결과
   * @returns 무진척이 threshold회 연속되면 true
   */
  record(changedFileCount: number, review: ReviewResult): boolean {
    const fingerprint = feedbackFingerprint(review);
    const noChange = changedFileCount === 0;
    const sameFeedback = this.lastFingerprint !== null && this.lastFingerprint === fingerprint;

    if (noChange || sameFeedback) {
      this.consecutive++;
    } else {
      this.consecutive = 0;
    }

    this.lastFingerprint = fingerprint;
    return this.consecutive >= this.threshold;
  }

  /** 현재까지 연속된 무진척 사이클 수 */
  get count(): number {
    return this.consecutive;
  }

  /** 카운터 리셋 (사용자가 정체 무시하고 계속 진행을 선택한 경우 등) */
  reset(): void {
    this.consecutive = 0;
  }
}
