# Sprite Editor 작업 기록

## 목표
Sprite Fusion의 캔버스 중심 UX를 참고해 sprite-gen 생성, Pixel Snapper 정규화,
픽셀 편집, 애니메이션 후보 선택, 맵 배치, 프로젝트 저장/export를 연결한다.
사용자는 30분 heartbeat와 작업 단위별 main 커밋/푸시를 승인했다.
배포·병합·유료 생성 실험은 승인 범위에 포함하지 않는다.

## 상태 (2026-09-13)
- 완료/push: `f901f84` 자산 저장·revision·생성/정규화 job adapter와 pinned Rust 소스.
- 구현/검증: React 편집기, 브러시/지우개/스포이트/undo/redo, 타임라인 재생,
  기본 맵 배치/선택/레이어/충돌, PNG 및 프로젝트 export/import.
- 실제 Pixel Snapper 처리 성공: 1254px 샘플→92×91px 수정본, 원본 유지.
- 브라우저 검증: 픽셀 수정/undo/redo/수정본, 프레임 추가/재생,
  맵 객체 2개 배치, embedded PNG export 검사, 프로젝트 fixture import 및 reload 유지.
- 다음: sprite-gen run/manifest 가져오기, 상태·방향 애니메이션 연결,
  Pixel Unfake 비교 variant, map fill/autotile, 실행/취소/장애 경로 확대 검증.
- 최종 완료 조건: 주요 기능의 실제 왕복 검증, 오류·취소·복구 처리, 문서와 테스트,
  모든 작업 단위 push. 실제 provider 생성 검증이 없으면 그 제한을 명시한다.
- 사용자 확인으로 저장소 로컬 작성자 설정 완료. origin main에 push 권한 확인.

## 로컬 실행
- `npm run api`: 127.0.0.1:8796. `npm run dev`: 127.0.0.1:5186.
- 서버가 실행 중인지 먼저 확인하고 중복 실행하지 않는다. 다른 앱의 5173/8787 프로세스는 건드리지 않는다.
- `.data/toolchain`에 Rust 최소 설치(시스템 PATH 변경 없음).
  한글 경로에서 libm build script가 실패해 `/tmp/sprite-editor-work-20260912` ASCII symlink 사용.
  `CARGO_HOME=/tmp/sprite-editor-work-20260912/.data/toolchain/cargo`
  `RUSTUP_HOME=/tmp/sprite-editor-work-20260912/.data/toolchain/rustup`으로 cargo 실행.
- `.data` 샘플/생성물, `artifacts` 디자인/QA, `analysis` 원문은 Git 제외.
- 웹 파일 선택 검증은 `/tmp` ASCII fixture로 성공. Downloads 파일은 검사 후 사라져
  최초 import가 실패했으므로 그 실패를 제품 import 실패로 단정하지 않는다.

## 재개 규칙
먼저 git status, 이 파일과 최근 커밋을 확인한다. 기존 변경을 보존한다.
같은 run에는 한 작업만 쓴다. 완료 단위마다 관련 검증 및 staged diff 확인 후
Conventional Commits 한국어 제목으로 커밋하고 origin main에 push한다.
전체 완료 전에 heartbeat를 중단하거나 완료라고 보고하지 않는다.
