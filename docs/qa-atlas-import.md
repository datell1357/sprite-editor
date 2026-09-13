# 아틀라스 및 클립 검증 — 2026-09-13

## 데이터와 호환성
- 실제 sprite-gen compose 결과의 manifest/PNG를 API로 가져옴.
- idle: 4프레임, 4fps, loop. walk: 3프레임, 8fps, loop.
- 원본 frame_layout rect로 자른 RGBA와 저장된 프레임 바이트 전부 일치.
- 각 frame durationMs가 원본 durations_ms와 전부 일치.
- 순환 버전 참조·누락 자산·잘못된 프레임 시간·누락 active clip 거부.
- 기존 프로젝트 v1의 sequence/FPS를 v2 첫 clip으로 변환하는 회귀 검사.
- manifest 후반의 잘못된 rect도 전체 검증 전에는 자산으로 게시하지 않음.
- 파일 쓰기 실패 시 DB 자산 목록에 일부 프레임만 노출하지 않음.
  실패 시 새로 쓴 미참조 PNG가 로컬 디렉터리에 남을 수 있으며 기존 자산은 보존됨.

## 재생
- 단위 검사: 125/375ms 불균등 프레임 유지, 총 duration 경계에서 반복,
  one-shot 마지막 프레임 유지, 지연된 탭에서 elapsed time에 맞는 위치 선택.
- 브라우저: 라이브러리에 가져온 프레임 표시, 새 clip 생성, 2프레임 추가,
  프레임 선택→편집 캔버스 연결, 375ms 입력, 반복 해제→재생 후 정지 확인.
- 오류/경고 로그에서 관련 앱 오류 미관찰.

## 화면 및 제한
- 기존 graphite/mint UI를 유지하며 clip 선택·가져오기·ms/loop 컨트롤을 추가했다.
- 브라우저 스크린샷을 직접 확인했다. 검증용 geometric fixture는 제작 아트가 아니다.
- 실제 사용자 프로젝트를 덮지 않도록 localhost origin에서 확인했다.
- 네이티브 filechooser 자동화가 장시간 반환되지 않았다. UI 파일 선택→import 완료의
  전체 경로를 통과했다고 주장하지 않는다. API 실물 검사와 나머지 UI 검사는 통과했다.
- 유료 생성·배포·병합은 실행하지 않았다.
