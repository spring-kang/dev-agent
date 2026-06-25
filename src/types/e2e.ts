/**
 * E2E(Playwright) 검증 관련 타입 정의
 *
 * build 파이프라인에서 리뷰가 APPROVED 된 직후, PR 생성 직전에
 * 실제 동작하는 애플리케이션을 대상으로 e2e 테스트를 실행해 게이트한다.
 */

export interface E2eVerifyRequest {
  /** 테스트 명령을 실행할 작업 디렉터리(프로젝트 경로) */
  projectPath: string;
  /** 검증 대상 base URL (예: http://localhost:3000). 비어 있으면 env 주입 생략 */
  url: string;
  /** 실행할 e2e 명령 (예: "npx playwright test"). shell 없이 argv 로 분해 실행 */
  command: string;
  /** 타임아웃(ms) */
  timeout: number;
}

export interface E2eResult {
  /** 종료 코드 0 → 통과 */
  passed: boolean;
  /** 프로세스 종료 코드 (타임아웃 시 null) */
  exitCode: number | null;
  /** 타임아웃으로 강제 종료되었는지 여부 */
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** 실행 시간(ms) */
  duration: number;
}

/** 파싱된 실행 명령 (file + args, shell:false 안전 실행용) */
export interface ParsedCommand {
  file: string;
  args: string[];
}
