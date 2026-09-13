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
- Pixel Unfake 비교 완료: 새 animation job에서 canonical/plain 쌍을 같은 timing의 두 클립으로 게시.
  plain 파일 누락·크기 불일치·frames 밖 경로는 실패하며 정규화 결과로 대체하지 않는다.
  Pixel Snapper/일반 수정본도 parent 비교 dialog로 선택 가능. processing/variant는 프로젝트 export/import 유지.
  실제 sprite-gen 3쌍(6자산)에서 parent·timing 일치, 원본 해시 불변 확인. 브라우저 원본 비교/선택 통과.
- 오토타일 완료: 레이어별 기본 타일/3×3 있음·없음·무관 규칙, 순서 변경, 최대 32개 규칙.
  raw 배치 보존, 이웃 편집 시 재계산, 화면/PNG 공용 resolver, 규칙/참조 자산 프로젝트 복원.
  브라우저 규칙 생성·이웃 삭제·새 탭 복원 통과. PNG 768×512에서 삭제 칸/이웃/상단/내부 픽셀 일치.
  프런트엔드 20개와 빌드 통과, 비교 작업의 Python 24개 통과. 편집 중 HMR 오류는 수정 후 새 탭에서 해소.
- 후보 목록 완료: 재생 프레임 제외→후보 보관→원래 duration으로 끝에 복원.
  선택 자산을 바로 후보로 보관 가능. 후보-only 자산도 portable project에서 검증/ID remap.
  브라우저 375ms 프레임 후보 이동→새로고침 유지→재생 복원 375ms 확인. 프런트엔드 23개 통과.
- 외부 run ZIP 가져오기 완료: baked atlas는 재생, 추출 files는 후보로 분리.
  원본 ZIP은 그대로 보존하고 완료 작업에서 다시 다운로드. curation 코드는 실행/재해석하지 않음.
  경로/중복/링크/압축/파일수/메모리/후보 누락 검증 후 자산+완료 작업을 DB transaction으로 게시.
  실제 run ZIP API 검사: 재생3/후보3/총6자산, 다운로드 ZIP 바이트 동일.
  브라우저 완료 작업 채택과 중복 방지, 후보 표시 통과. 파일 선택 자동화는 반복하지 않았다.
- 방향 기준 생성 연결 완료: 정면/후면/좌/우/대각선 1~8개, 방향별 idle 1프레임, 미러 대체 없음.
  공용 deadline의 workflow/prepare/gen-set/extract/compose/inspect 후 요청 방향/셀/수/QA/빈 이미지 검사.
  결과를 원본 parent에 연결하고 작업 내역에서 기준 선택→애니메이션 모드로 이동.
  실제 prepare에서 8방향 모두 base-source 참조 확인. Python35/프런트23 및 빌드 통과.
  방향의 시각적 정확도는 실제 provider 호출 없이 검증할 수 없으며 미실행 상태를 유지.
- 다음: 확인된 방향 기준의 애니메이션 일괄 실행, 실제 provider 품질 검증.
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
