# Security Test Instructions

## Purpose
민감 정보 보호, 프로세스 실행 안전성, 입력 검증 등 보안 요구사항을 검증합니다.

## Security Requirements
- **민감 정보 마스킹**: 로그에 secret, token, password 등 노출 금지
- **쉘 인젝션 방지**: child_process.spawn에 shell: false 강제
- **경로 탐색 방지**: 프로젝트 경로 외부 접근 차단
- **입력 검증**: CLI 인수, 설정 값의 유효성 검사

## Test Scenarios

### 1. 민감 정보 마스킹 (logger-masking.test.ts)
- **파일**: `tests/components/logger-masking.test.ts`
- **검증 항목**:
  - `secret`, `token`, `key`, `password`, `api_key`, `credential` 키 마스킹
  - 대소문자 구분 없이 마스킹 (SECRET, Token, apiKey 등)
  - 중첩 객체에서도 재귀적 마스킹
  - 마스킹 후 값은 `****`으로 대체
- **Status**: ✅ 구현 완료 (5개 테스트)

### 2. 프로세스 실행 안전성
- **검증 항목**:
  - `child_process.spawn`에 `shell: false` 옵션 강제 (코드 리뷰)
  - 사용자 입력이 명령줄 인수에 직접 삽입되지 않음
  - `execFile` 사용 (쉘 해석 없음)
- **검증 방법**: 코드 리뷰 + 정적 분석
  ```bash
  # spawn에 shell: true가 사용되지 않는지 확인
  grep -rn "shell.*true" src/
  # execFile 대신 exec가 사용되지 않는지 확인
  grep -rn "\.exec(" src/ | grep -v execFile
  ```

### 3. 설정 값 검증 (config-manager.test.ts)
- **파일**: `tests/components/config-manager.test.ts`
- **검증 항목**:
  - maxIterations: 1~20 범위 제한
  - branchPrefix: 소문자 영문 시작, 20자 이내, 특수문자 제한
  - logLevel: enum 값만 허용 (debug/info/warn/error)
  - timeout: 최소/최대 범위 제한
  - 잘못된 값 → ConfigValidationError 발생
- **Status**: ✅ 구현 완료 (5개 검증 테스트)

### 4. 상태 파일 무결성 (state-manager.test.ts)
- **파일**: `tests/components/state-manager.test.ts`
- **검증 항목**:
  - Atomic write (tmp → rename) 패턴으로 파일 손상 방지
  - 필수 필드 검증 (workflowId, projectPath, status, currentPhase)
  - 잘못된 JSON → StateError
  - 필수 필드 누락 → StateError
- **Status**: ✅ 구현 완료 (15개 테스트)

### 5. 의존성 취약점 검사
```bash
npm audit
# 0 vulnerabilities 확인
```

## Run Security Tests
```bash
# 마스킹 테스트
npx vitest run tests/components/logger-masking.test.ts

# 설정 검증 테스트
npx vitest run tests/components/config-manager.test.ts

# 상태 무결성 테스트
npx vitest run tests/components/state-manager.test.ts

# 의존성 취약점 검사
npm audit
```

## Static Analysis Checklist
- [ ] `spawn({ shell: true })` 사용 없음
- [ ] `exec()` 사용 없음 (`execFile` 만 사용)
- [ ] 사용자 입력이 쉘 명령에 직접 삽입되지 않음
- [ ] `.env` 파일이 `.gitignore`에 포함됨
- [ ] 민감 키 패턴이 SENSITIVE_PATTERNS에 포함됨
- [ ] npm audit 0 vulnerabilities
