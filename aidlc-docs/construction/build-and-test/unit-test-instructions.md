# Unit Test Execution

## Test Framework
- **Runner**: Vitest 1.6+
- **Environment**: Node.js
- **Coverage**: v8 provider
- **Config**: `vitest.config.ts`
- **Test Pattern**: `tests/**/*.test.ts`

## Test Target Components

### 우선순위 1: 순수 도메인 로직 (의존성 없음)
| 컴포넌트 | 파일 | 핵심 테스트 |
|---|---|---|
| ReviewEngine | review-engine.test.ts | JSON 파싱, 텍스트 fallback, 보수적 판단, rework scope |

### 우선순위 2: 인프라 컴포넌트 (fs 모킹 필요)
| 컴포넌트 | 파일 | 핵심 테스트 |
|---|---|---|
| ConfigManager | config-manager.test.ts | 4-소스 병합, 검증, 환경변수 변환 |
| StateManager | state-manager.test.ts | atomic write, 복원/검증, 아카이브 |
| Logger | logger.test.ts | 레벨 필터링, 마스킹, truncate |

### 우선순위 3: 외부 프로세스 의존 (execFile 모킹)
| 컴포넌트 | 파일 | 핵심 테스트 |
|---|---|---|
| WorkspaceManager | workspace-manager.test.ts | 프로젝트 검증, 사전 조건 검사 |

## Run Unit Tests

### 1. Execute All Unit Tests
```bash
npm test
# 또는: npx vitest run
```

### 2. Execute Specific Test
```bash
npx vitest run tests/components/review-engine.test.ts
```

### 3. Watch Mode (개발 시)
```bash
npm run test:watch
```

### 4. With Coverage
```bash
npm run test:coverage
```

## Review Test Results
- **Expected**: 전체 테스트 통과, 0 failures
- **Test Coverage**: 핵심 도메인 로직 80%+ 목표
- **Test Report**: 터미널 출력 (vitest 기본)
- **Coverage Report**: `coverage/` 디렉토리 (v8 format)

## Fix Failing Tests
If tests fail:
1. vitest 출력에서 실패한 테스트 확인
2. Expected vs Received 비교 분석
3. 소스 코드 또는 테스트 코드 수정
4. `npm test` 재실행으로 통과 확인

## Mocking Strategy

### fs 모듈 모킹 (ConfigManager, StateManager)
```typescript
import { vi } from "vitest";
vi.mock("node:fs/promises");
```

### process.stdout/stderr 모킹 (Logger)
```typescript
vi.spyOn(process.stdout, "write").mockImplementation(() => true);
vi.spyOn(process.stderr, "write").mockImplementation(() => true);
```

### child_process 모킹 (WorkspaceManager, Agent)
```typescript
vi.mock("node:child_process");
```
