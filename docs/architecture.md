# 구현 경계

React/Vite는 편집 화면, Python/Pillow 로컬 서비스는 영속 자산 및 작업 실행을 소유한다.
localhost로만 실행하며 Vite가 /api를 프록시한다. 서비스에 클라이언트가 임의 명령이나
파일 경로를 전달하지 않는다. PNG는 검증 후 새 UUID로 저장하며 원본을 덮지 않는다.

- Asset: UUID, PNG, 이름, 크기, parentId, 생성 시각. 편집/정규화는 새 revision.
- Project: 버전 있는 JSON, 자산 참조, 맵 레이어, 애니메이션 순서.
- Job: queued/running/completed/failed/cancelled. 단일 worker, 프로세스 그룹 취소.
- sprite-gen: 별도 설치 CLI를 명시적 provider, isolated workdir로 호출.
- Pixel Snapper: MIT upstream을 pinned vendor로 보관하고 native CLI로 호출.

초기 UI는 graphite canvas, mint accent, 왼쪽 자산, 중앙 캔버스/타임라인,
오른쪽 생성/정규화 inspector. Sprite와 Map은 같은 자산 라이브러리를 사용한다.
픽셀 canvas는 nearest 및 정수 배율. 원본 이미지는 별도 보존한다.

Sprite Fusion 웹 에디터 소스는 이 저장소에 포함하지 않는다. 공개 UX를 참고해
자체 구현한다. Pixel Snapper MIT와 sprite-gen Apache-2.0은 각각 고지한다.
