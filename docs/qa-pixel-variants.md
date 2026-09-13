# 픽셀 처리 버전 비교 검증

2026-09-13. 새 애니메이션 작업의 정규화 전 프레임은 sprite-gen extractor가 작성한
frames-manifest의 plain_files를 읽는다. 별도로 생성하거나 canonical 픽셀을 원본으로
대체하지 않는다. 현재 경로는 새 작업의 편집되지 않은 출력만 지원한다.

- Pixel Unfake와 plain 두 clip의 프레임 수·순서·시간 일치.
- 각 pixel 자산 parentId가 해당 plain 자산을 참조한다.
- 모든 쌍을 읽고 검증한 뒤 하나의 DB transaction으로 게시한다.
- 누락 원본, 범위 밖 원본 경로, QA/프레임 수 오류는 아무 자산도 게시하지 않는다.
- processing 및 clip.variant를 portable project에 유지하고 parent 순서로 복원한다.
- 실제 설치된 sprite-gen의 오프라인 결과 3쌍(6자산)에서 원본 파일 해시 불변 확인.
- 기존 실제 Pixel Snapper 결과로 브라우저 비교 dialog와 원본 선택 검증, 관련 콘솔 오류 없음.
- 미저장 픽셀 수정이 있으면 비교를 비활성화한다. 이미지 로드 실패 시 오류를 표시한다.

plain은 원시 고해상도 생성물이 아니라 셀 크기의 정규화 전 추출 프레임이다.
비교 화면은 각각 화면에 맞춰 표시하며 실제 픽셀 크기는 숫자로 별도 표시한다.
과거 atlas만 가져온 자산에는 원본 쌍이 없을 수 있으며 새 원본을 추정하지 않는다.
