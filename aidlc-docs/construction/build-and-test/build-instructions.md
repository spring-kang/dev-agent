# Build Instructions

## Prerequisites
- **Build Tool**: TypeScript Compiler (tsc) 5.6+
- **Runtime**: Node.js >= 18.0.0 (권장 20 LTS)
- **Package Manager**: npm (Node.js 내장)
- **Dependencies**: chalk ^5.4.1, commander ^12.1.0
- **Environment Variables**: 없음 (빌드 시 불필요)
- **System Requirements**: macOS / Linux / Windows, 디스크 50MB+

## Build Steps

### 1. Install Dependencies
```bash
npm install
# 161 packages 설치
# 0 vulnerabilities 확인
```

### 2. Configure Environment
```bash
# 빌드 시 별도 환경변수 불필요
# TypeScript 설정은 tsconfig.json에 포함
```

### 3. Build All Units
```bash
npm run build
# 또는 직접 실행: npx tsc
```

### 4. Verify Build Success
- **Expected Output**: 에러 메시지 없이 종료 (exit code 0)
- **Build Artifacts**:
  - `dist/` 디렉토리에 25개 JS 파일 생성
  - `dist/` 디렉토리에 25개 d.ts 타입 정의 파일 생성
  - `dist/` 디렉토리에 25개 source map 파일 생성
- **Common Warnings**: 없음 (strict 모드에서 경고 0)

### 5. Type Check Only (빌드 없이 검증)
```bash
npm run typecheck
# 또는 직접 실행: npx tsc --noEmit
```

## Build Configuration

### tsconfig.json 주요 설정
| 옵션 | 값 | 설명 |
|---|---|---|
| target | ES2022 | 최신 JS 기능 사용 |
| module | NodeNext | ESM 모듈 시스템 |
| strict | true | 엄격한 타입 체크 |
| noUncheckedIndexedAccess | true | 인덱스 접근 안전성 |
| outDir | ./dist | 빌드 출력 경로 |
| rootDir | ./src | 소스 루트 |

### 디렉토리 구조
```
src/                    → TypeScript 소스 (rootDir)
├── types/              → 타입 정의 (7 files)
├── components/         → 인프라 컴포넌트 (8 files)
├── services/           → 비즈니스 서비스 (4 files)
├── orchestrator/       → 오케스트레이터 (1 file)
├── cli/                → CLI + 포매터 (3 files)
├── container.ts        → DI 조합 루트
└── index.ts            → 진입점

dist/                   → JavaScript 빌드 출력 (outDir)
tests/                  → 테스트 파일 (tsconfig exclude)
```

## Troubleshooting

### Build Fails with Dependency Errors
- **Cause**: node_modules가 없거나 손상
- **Solution**:
  ```bash
  rm -rf node_modules package-lock.json
  npm install
  npm run build
  ```

### Build Fails with Compilation Errors
- **Cause**: TypeScript strict 모드 위반
- **Solution**:
  1. `npx tsc --noEmit` 으로 에러 확인
  2. 에러 메시지의 파일:라인 위치 확인
  3. 타입 불일치/누락 수정
  4. 재빌드

### Module Resolution Errors
- **Cause**: ESM import에서 `.js` 확장자 누락
- **Solution**: 모든 상대 import에 `.js` 확장자 포함 (NodeNext 모듈 요구사항)
