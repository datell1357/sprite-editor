# Sprite Editor

Sprite Fusion의 캔버스 중심 흐름을 참고한 로컬 픽셀 편집기입니다.
sprite-gen 생성, Pixel Snapper 정규화, 비파괴 자산 버전, 프레임 타임라인,
맵 배치와 프로젝트 export를 하나의 작업 공간으로 연결합니다.

## 실행

Node.js 22+, Python 3.10+, macOS/Linux가 필요합니다.

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# 터미널 1
npm run api
# 터미널 2
npm run dev
```

브라우저에서 http://127.0.0.1:5186 을 엽니다. API는 127.0.0.1:8796에만 바인딩됩니다.
다른 프로세스가 포트를 사용하면 오류를 확인하고 중복 서비스를 종료하거나 설정을 조정합니다.
외부 네트워크에 서버를 노출하지 마세요. 공개 다중 사용자 서비스가 아닌 로컬 앱입니다.

## 생성 연결

[sprite-gen](https://github.com/aldegad/sprite-gen)을 별도로 설치합니다.
PATH의 `sprite-gen` 또는 기본 Codex 스킬 설치 위치의 CLI를 찾습니다.
다른 위치라면 API 실행 전에 절대 경로를 지정합니다.

```sh
export SPRITE_GEN_BIN=/absolute/path/to/sprite-gen/.venv/bin/sprite-gen
npm run api
```

원하는 provider를 선택하고 Generate를 누르면 그 계정의 한도·과금 정책으로
실제 생성이 실행됩니다. 선택한 자산을 참조해 편집·변형할 수 있습니다.
목표 크기는 생성 요청이며, 실제 출력 크기를 강제로 찌그러뜨리지 않습니다.
권한·크레딧 확인을 CLI 존재 여부로 대신하지 않습니다. 실패 시 자동 재결제/재시도하지 않습니다.

## Pixel Snapper

Rust를 설치한 뒤 고정된 upstream 소스를 빌드합니다.

```sh
cargo build --locked --release --manifest-path vendor/pixel-snapper/Cargo.toml
```

기존 설치를 쓰려면 `PIXEL_SNAPPER_BIN=/absolute/path/to/spritefusion-pixel-snapper`를
설정합니다. 한글 경로에서 Rust 빌드가 실패하면 ASCII 이름의 디렉터리에서 빌드하거나
ASCII 경로 별칭을 사용하세요. Python 서비스는 완성된 바이너리를 자동으로 찾습니다.
정규화는 입력을 보존하고 새 자산으로 저장합니다. 자동 스냅은 고정 32×32 resize가 아닙니다.

## 편집과 저장

- `+`: 32×32 빈 스프라이트. PNG Import: 최대 12MB, 각 변 2048px.
- Sprite: 브러시·지우개·스포이트·격자·줌·undo/redo. **수정본 저장**은 새 revision입니다.
- Timeline: 이름별 클립, 프레임 추가·순서 이동·제거, 프레임별 시간(ms), 반복/한 번 재생,
  atlas PNG+JSON export. FPS를 바꾸면 해당 클립의 시간을 균등하게 설정합니다.
- Map: 선택 자산을 격자 기준 배치, 지우기, 레이어 표시·충돌, undo/redo, PNG export.
- Export project: 자산 PNG를 포함하는 `.sprite.json`. 프로젝트 열기로 다른 설치에도 복원.
- 프로젝트 구성은 브라우저에 자동 저장됩니다. 픽셀 수정은 **수정본 저장**을 눌러 반영합니다.
- `.data/`는 자산, SQLite, 작업 기록을 보관합니다. Git에 포함되지 않습니다.
  브라우저 저장소와 `.data/`는 별개이므로 이동/백업에는 Export project를 사용하세요.

## sprite-gen 아틀라스 가져오기

Sprite 화면의 **sprite-gen 가져오기**에서 완성된 작업의 `manifest.json`과
`sprite-sheet-alpha.png`를 선택합니다. `frame_layout.rows`의 실제 사각형으로 프레임을
추출하고 `animation.rows`의 상태 이름·`durations_ms`·FPS·loop를 보존합니다.
시간 배열이 없는 이전 manifest만 FPS로 균등 시간을 계산합니다.

PNG 최대 12MB/16메가픽셀, manifest 최대 2MB, 한 번에 최대 256프레임입니다.
범위 밖 좌표·프레임 수 불일치·잘못된 시간은 가져오기 전에 거부합니다.
새 자산을 만들므로 원본 run을 변경하지 않으며 유료 생성을 호출하지 않습니다.

프로젝트 형식은 버전 2입니다. `clips[].frames[]`가 자산 참조와 `durationMs`를 소유합니다.
기존 버전 1 파일도 열 수 있으며 단일 sequence의 순서와 FPS를 첫 클립으로 변환합니다.
버전 2 파일을 이전 앱 버전에서 여는 것은 지원하지 않습니다.

현재 제한: 기본 맵 배치가 중심이며 autotile 규칙, 여러 애니메이션 상태/방향의 일괄 생성,
raw·후보 pool까지 포함한 전체 sprite-gen 큐레이션 run import, 선택 영역 AI 편집,
엔진별 native export는 후속 작업입니다.
실제 계정으로 유료 생성 테스트는 자동으로 실행하지 않습니다.

## 검증

```sh
npm run build
npm test
npm run test:api
cargo test --locked --manifest-path vendor/pixel-snapper/Cargo.toml
```

UI는 빈 상태와 가져온 실제 PNG 모두에서 확인합니다. 샘플 생성 이미지는 저장소에
자동으로 게시하지 않습니다. 라이선스와 고정 버전은 THIRD_PARTY_NOTICES.md를 참고하세요.
