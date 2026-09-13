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
- 이번 회차 완료: sprite-gen runtime manifest+PNG 가져오기 API/UI, 이름별 클립,
  프레임별 ms·반복/one-shot 재생, duration/loop export, 프로젝트 v1→v2 호환 변환.
- 실물 fixture API 검증: idle 4프레임@4fps, walk 3프레임@8fps. 추출 RGBA·duration 전부 원본과 동일.
- 관련 자동 검사: 프런트엔드 8개, Python 10개 및 빌드 통과.
- 브라우저: 가져온 프레임 목록, 클립 생성, 프레임 추가/선택, 375ms 편집, one-shot 종료 확인.
  네이티브 파일 선택 자동화가 장시간 응답하지 않아 파일 선택부터 완료까지 UI 전체 왕복은 미검증.
- 맵 채우기 완료: 4방향 연결 영역, 빈 영역, 레이어 격리, 경계 및 20,000 배치 상한.
  무변경 칠하기/지우기는 기록하지 않고 스트로크·채우기를 한 번에 undo/redo한다.
  맵 undo는 클립·프로젝트 이름을 덮지 않으며 외부 프로젝트 교체 시 이전 맵 기록을 비운다.
- 관련 검사: 프런트엔드 14개와 빌드 통과. 최대 128×128 그리드 및 용량 초과 검사.
  브라우저 24×16 빈 맵→384 배치→무변경 재클릭→undo 0→redo 384 확인.
  undo 후 수정한 프로젝트 이름 유지, 브라우저 오류 미관찰.
- 애니메이션 생성 연결 완료: 저장된 기준 자산+GPT 이미지 행으로 한 상태를 생성한다.
  workflow/prepare/gen-set/extract/compose/inspect를 공용 deadline·취소 관리자로 실행한다.
  상태/프레임/FPS/loop/셀 크기/QA 검사 후 클립 후보를 반환하고 명시적 버튼으로 채택한다.
  기준 방향은 유지하며 새 방향 앵커 생성은 아직 연결하지 않았다.
- 검사: 로컬 provider stand-in의 전 단계·중간 실패·단계 사이 취소·잘못된 프레임 수·QA 실패.
  실제 설치된 sprite-gen에서도 생성 단계만 격자 fixture로 대체해 prepare/extract/compose/inspect 통과.
  이전 단순 도형 fixture는 너무 적은 픽셀로 추출되어 기존 sparse 기준에서 거부됐으며 기준은 그대로 유지.
  실제 provider 호출 및 계정 이용 권한 검증은 미실행. UI에서 권한 미확인 시 Animate 비활성 확인.
- 다음: 방향 앵커/다방향 생성 연결, Pixel Unfake 비교 variant,
  autotile, raw/후보 pool import.
- 작업 수명 보강 완료: 취소 시 bounded process-group 종료, queued 취소의 실행 방지,
  정상 서버 종료 시 정리, 중복 포트 실행의 기존 job 상태 보존, 요청 형식/프롬프트 정규화.
- 이전 HEAD 재현: SIGTERM 무시 provider 취소 후 다음 작업은 queued에 남았다.
  수정 후 실제 로컬 stand-in 및 자식 heartbeat 종료, 다음 job 완료, 취소 PNG 게시 차단 확인.
  실패 exit/잘못된 PNG/spawn 오류/timeout/종료/대기 취소를 포함한 Python 18개 통과.
  실제 유료 provider 호출은 하지 않았다.
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
- UI 검증은 별도 `localhost:5186` origin으로 실행해 사용자의 `127.0.0.1` 프로젝트 저장값을 보존했다.
- 파일 선택 CUA 자동화가 여러 차례 오래 지연됐다. 같은 filechooser 호출을 반복하지 말고
  API/fixture 검사와 브라우저의 파일 선택 외 상호작용으로 나누어 확인한다.
- 웹 파일 선택 검증은 `/tmp` ASCII fixture로 성공. Downloads 파일은 검사 후 사라져
  최초 import가 실패했으므로 그 실패를 제품 import 실패로 단정하지 않는다.

## 재개 규칙
먼저 git status, 이 파일과 최근 커밋을 확인한다. 기존 변경을 보존한다.
같은 run에는 한 작업만 쓴다. 완료 단위마다 관련 검증 및 staged diff 확인 후
Conventional Commits 한국어 제목으로 커밋하고 origin main에 push한다.
전체 완료 전에 heartbeat를 중단하거나 완료라고 보고하지 않는다.
