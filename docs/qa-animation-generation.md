# 애니메이션 생성 연결 검증 — 2026-09-13

## 이번 연결
선택된 저장 자산의 방향을 유지하는 한 상태의 GPT 이미지 행 생성이다.
이용 권한 확인 checkbox가 있어야 요청할 수 있고, workflow가 준비 상태로 종료돼야
후속 작업을 실행한다. provider는 명시적으로 codex, gen-set concurrency는 1이다.
기존 원본·클립은 변경하지 않는다. 결과는 작업 내역에서 명시적으로 채택한다.

## 실행 검증
- 로컬 stand-in으로 workflow/prepare/gen-set/extract/compose-atlas/inspect 순서 실행.
- 6개 단계가 동일한 deadline을 공유함을 확인.
- 결과 4프레임·32×32·125ms·loop와 알파 채널 확인.
- 생성 단계 실패, 준비 직후 취소, 잘못된 출력 수, false QA report는 클립/프레임 미게시.
- reference/권한 확인/state/frames/fps/loop/provider 검증 실패는 실행 전 거부.
- 생성 결과 채택 시 기존 클립과 맵을 유지하고 중복 채택을 방지하는 테스트.
- 실제 sprite-gen prepare가 생성한 상태·크기·pixel_unfake 설정 확인.
- 실제 설치된 sprite-gen의 유료 생성만 알려진 4px 격자 fixture로 대체하고
  prepare→extract→compose→inspect 및 최종 출력 gate 통과: 3프레임.
- 기존 단순 도형 fixture는 sparse-frame 기준에 미달해 extract에서 거부됨.
  실패를 숨기거나 검증 기준을 낮추지 않았다.

## UI와 제한
브라우저에서 애니메이션 모드, GPT 고정 provider, 상태/프레임/FPS/loop 설정을 확인했다.
프롬프트와 8프레임을 입력해도 이용 권한 미확인 상태에서는 Animate가 비활성이다.
실제 계정의 권한을 임의로 확인했다고 표시하거나 유료 호출을 실행하지 않았다.

자연스러운 동작·캐릭터 일관성은 아직 실제 provider 결과로 검증하지 않았다.
새 방향 앵커, 다방향 일괄 생성 및 Grok 영상 방식은 이번 연결에 포함하지 않는다.
