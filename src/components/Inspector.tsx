import { useState } from "react";
import {
  Sparkles,
  WandSparkles,
  CircleCheck,
  X,
  LoaderCircle,
} from "lucide-react";
import type { AnimationClip, Asset, Capabilities, Job } from "../types";
import { api } from "../lib/api";
import { directionLabels } from "../lib/directions";
import { BatchAnimation } from "./BatchAnimation";
import type { AnimationTarget } from "../lib/animationBatch";

const palette = [
  "#202126",
  "#603b29",
  "#a56a3b",
  "#db994d",
  "#f4cc68",
  "#f6e6b4",
  "#557849",
  "#91b966",
  "#66b8c9",
  "#f5f5f3",
  "#bd6481",
  "#8b78ac",
];
export function Inspector({
  assets,
  selected,
  capabilities,
  jobs,
  color,
  onColor,
  onJob,
  onError,
  onUseClips,
  onChooseAnchor,
}: {
  assets: Asset[];
  selected?: Asset;
  capabilities: Capabilities | null;
  jobs: Job[];
  color: string;
  onColor: (s: string) => void;
  onJob: () => void;
  onError: (s: string) => void;
  onUseClips: (clips: AnimationClip[]) => Promise<void>;
  onChooseAnchor: (id: string) => boolean;
}) {
  const [prompt, setPrompt] = useState(""),
    [provider, setProvider] = useState("codex"),
    [size, setSize] = useState(32),
    [reference, setReference] = useState(false);
  const [mode, setMode] = useState<"generate" | "animate" | "directions">(
      "generate",
    ),
    [state, setState] = useState("walk"),
    [frames, setFrames] = useState(4),
    [fps, setFps] = useState(8),
    [loop, setLoop] = useState(true),
    [accessConfirmed, setAccessConfirmed] = useState(false);
  const [directions, setDirections] = useState(["down", "right", "up", "left"]);
  const [batchTarget, setBatchTarget] = useState<AnimationTarget | null>(null);
  const [historyCount, setHistoryCount] = useState(8);
  const [colors, setColors] = useState(16),
    [pitch, setPitch] = useState(""),
    [busy, setBusy] = useState(false);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onJob();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const finishedJobs = jobs.filter(
    (j) => j.status !== "queued" && j.status !== "running",
  );
  const visibleJobs = [...activeJobs, ...finishedJobs.slice(0, historyCount)];
  return (
    <aside className="inspector panel">
      <section>
        <h2>
          <Sparkles size={20} /> Create
        </h2>
        <div className="segmented" aria-label="생성 종류">
          <button
            className={mode === "generate" ? "active" : ""}
            onClick={() => setMode("generate")}
          >
            이미지
          </button>
          <button
            className={mode === "animate" ? "active" : ""}
            onClick={() => setMode("animate")}
          >
            애니메이션
          </button>
          <button
            className={mode === "directions" ? "active" : ""}
            onClick={() => setMode("directions")}
          >
            방향 기준
          </button>
        </div>
        <textarea
          aria-label="생성 프롬프트"
          placeholder="어떤 자산을 만들까요? 예: 황동 장식이 달린 나무 보물상자"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={4000}
        />
        <label className="field">
          Provider
          <select
            aria-label="생성 제공자"
            disabled={mode !== "generate"}
            value={mode !== "generate" ? "codex" : provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="codex">GPT · Codex</option>
            <option value="grok">Grok</option>
          </select>
        </label>
        <label className="field">
          목표 크기
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[16, 32, 64, 128].map((s) => (
              <option key={s} value={s}>
                {s} × {s}
              </option>
            ))}
          </select>
        </label>
        {mode !== "generate" ? (
          <>
            <p className="hint">
              저장된 기준 자산: {selected?.name || "라이브러리에서 선택하세요"}.
              {mode === "animate"
                ? "방향은 기준 이미지를 유지합니다."
                : "방향별 기준 이미지를 만든 뒤 직접 확인하고 선택하세요."}
            </p>
            {mode === "directions" ? (
              <>
                <div className="direction-options">
                  {Object.entries(directionLabels).map(([id, label]) => (
                    <label className="check-field" key={id}>
                      <input
                        type="checkbox"
                        checked={directions.includes(id)}
                        onChange={(e) =>
                          setDirections(
                            e.target.checked
                              ? [...directions, id]
                              : directions.filter((d) => d !== id),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="hint">
                  {directions.length}개 방향을 각각 생성합니다. 선택한 방향마다
                  생성 요청과 계정 사용량이 발생합니다.
                </p>
              </>
            ) : (
              <>
                <label className="field">
                  동작 상태
                  <select
                    aria-label="동작 상태"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    {["idle", "walk", "run", "attack", "jump"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  프레임 수
                  <input
                    aria-label="생성 프레임 수"
                    type="number"
                    min={2}
                    max={16}
                    value={frames}
                    onChange={(e) => setFrames(Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  FPS
                  <input
                    aria-label="생성 FPS"
                    type="number"
                    min={1}
                    max={60}
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  반복 애니메이션 생성
                </label>
              </>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={accessConfirmed}
                onChange={(e) => setAccessConfirmed(e.target.checked)}
              />
              GPT 이미지 생성 이용 권한을 확인했습니다
            </label>
          </>
        ) : (
          <label className="check-field">
            <input
              type="checkbox"
              disabled={!selected}
              checked={reference && !!selected}
              onChange={(e) => setReference(e.target.checked)}
            />
            선택 자산을 참조해 생성
          </label>
        )}
        <button
          className="primary wide"
          disabled={
            busy ||
            !prompt.trim() ||
            !capabilities?.spriteGen ||
            (mode === "directions" &&
              (!selected || !accessConfirmed || !directions.length)) ||
            (mode === "animate" &&
              (!selected ||
                !accessConfirmed ||
                !Number.isInteger(frames) ||
                frames < 2 ||
                frames > 16 ||
                !Number.isInteger(fps) ||
                fps < 1 ||
                fps > 60))
          }
          onClick={() =>
            perform(() =>
              mode === "directions"
                ? api.directions({
                    prompt,
                    size,
                    referenceId: selected!.id,
                    directions,
                    accessConfirmed,
                  })
                : mode === "animate"
                  ? api.animate({
                      prompt,
                      size,
                      referenceId: selected!.id,
                      state,
                      frames,
                      fps,
                      loop,
                      accessConfirmed,
                    })
                  : api.generate(
                      prompt,
                      provider,
                      size,
                      reference ? selected?.id : undefined,
                    ),
            )
          }
        >
          <Sparkles size={17} />
          {mode === "directions"
            ? "방향 기준 생성"
            : mode === "animate"
              ? "Animate"
              : "Generate"}
        </button>
        {mode === "animate" && (
          <>
            <button
              className="wide"
              disabled={busy || !selected || !capabilities?.spriteGen}
              onClick={() =>
                selected && setBatchTarget({ referenceId: selected.id })
              }
            >
              이 자산으로 여러 동작 생성
            </button>
            <button
              className="wide"
              disabled={busy || !assets.length || !capabilities?.spriteGen}
              onClick={() => setBatchTarget({ anchors: [] })}
            >
              여러 방향·동작 생성
            </button>
          </>
        )}
        <p className="hint">
          연결된 계정으로 실행합니다. 제공자의 이용 한도·요금이 적용되며, 실제
          크기는 결과에서 확인하세요.
        </p>
        {!capabilities?.spriteGen && (
          <p className="notice">
            sprite-gen 연결이 필요합니다. README의 실행 설정을 확인해 주세요.
          </p>
        )}
      </section>
      <section>
        <h2>
          <WandSparkles size={20} /> Pixel cleanup
        </h2>
        <p className="hint">원본을 보존하고 정리된 수정본을 만듭니다.</p>
        <label className="field">
          Colors
          <input
            aria-label="팔레트 색 수"
            type="number"
            min={2}
            max={256}
            value={colors}
            onChange={(e) => setColors(Number(e.target.value))}
          />
        </label>
        <label className="field">
          Pixel size
          <input
            aria-label="픽셀 간격"
            type="number"
            min={1}
            max={1024}
            placeholder="Auto"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
          />
        </label>
        <button
          className="wide"
          disabled={!selected || busy || !capabilities?.pixelSnapper}
          onClick={() =>
            perform(() =>
              api.snap(selected!.id, colors, pitch ? Number(pitch) : null),
            )
          }
        >
          <WandSparkles size={16} />
          Apply Pixel Snapper
        </button>
        {!capabilities?.pixelSnapper && (
          <p className="notice">Pixel Snapper 빌드가 필요합니다.</p>
        )}
        <label className="palette-heading">
          Palette{" "}
          <input
            aria-label="선택 색상"
            type="color"
            value={color}
            onChange={(e) => onColor(e.target.value)}
          />
        </label>
        <div className="palette">
          {palette.map((c) => (
            <button
              key={c}
              title={c}
              aria-label={`색상 ${c}`}
              className={color === c ? "chosen" : ""}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
        </div>
      </section>
      <section>
        <h2>Selected asset</h2>
        {selected ? (
          <div className="selected-info">
            <div className="checker">
              <img src={selected.url} alt="선택된 자산" />
            </div>
            <div>
              <strong>{selected.name}</strong>
              <p>
                {selected.width} × {selected.height}
              </p>
              <small>
                {selected.parentId ? "수정본 · 원본 보존됨" : "원본 자산"}
              </small>
            </div>
          </div>
        ) : (
          <p className="hint">선택한 자산의 정보가 표시됩니다.</p>
        )}
      </section>
      <section className="job-list">
        <h2>작업 내역</h2>
        {!jobs.length && (
          <p className="hint">생성·정규화 작업이 여기에 표시됩니다.</p>
        )}
        {!!activeJobs.length && (
          <p className="hint">
            진행·대기 {activeJobs.length}개 · 아래에서 개별 취소할 수 있습니다.
          </p>
        )}
        {visibleJobs.map((job) => (
          <div className="job" key={job.id}>
            <div className="inline">
              {job.status === "completed" ? (
                <CircleCheck size={15} />
              ) : ["queued", "running"].includes(job.status) ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <X size={15} />
              )}
              <span>
                {job.direction &&
                  `${directionLabels[job.direction] || job.direction} · `}
                {job.request.state && `${job.request.state} · `}
                {job.request.kind === "snap"
                  ? "픽셀 정리"
                  : job.request.prompt?.slice(0, 24)}
              </span>
              {["queued", "running"].includes(job.status) && (
                <button
                  aria-label="작업 취소"
                  onClick={() => perform(() => api.cancel(job.id))}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {job.batchSize !== undefined && job.batchIndex !== undefined && (
              <small>
                일괄 요청 {job.batchIndex + 1} / {job.batchSize}
              </small>
            )}
            <small>
              {
                {
                  queued: "대기 중",
                  running: "처리 중",
                  completed: "완료 · 라이브러리에서 선택",
                  failed: "실패",
                  cancelled: "취소됨",
                }[job.status]
              }
            </small>
            {job.status === "running" && job.stage && (
              <small>
                {(
                  {
                    access: "이용 권한 확인",
                    prepare: "기준·가이드 준비",
                    generate: "이미지 생성",
                    extract: "프레임 추출",
                    compose: "아틀라스 합성",
                    inspect: "결과 검사",
                    snap: "픽셀 정리",
                  } as Record<string, string>
                )[job.stage] || job.stage}
              </small>
            )}
            {job.status === "completed" && job.clips?.length && (
              <>
                <button
                  className="wide"
                  disabled={busy}
                  onClick={() => perform(() => onUseClips(job.clips!))}
                >
                  {job.request.kind === "import-run"
                    ? "가져온 클립 추가 / 열기"
                    : "생성 클립 추가 / 열기"}
                </button>
                {job.reviewRequired && (
                  <p className="hint">
                    추가한 뒤 움직임과 캐릭터 일관성을 확인하세요.
                  </p>
                )}
              </>
            )}
            {job.error && <p className="notice">{job.error}</p>}
            {job.archiveUrl && (
              <a href={job.archiveUrl} download>
                가져온 원본 ZIP 받기
              </a>
            )}
            {job.status === "completed" && job.directionAnchors && (
              <div className="anchor-results">
                <p className="hint">
                  방향과 비대칭 장식을 확인한 뒤 기준을 선택하세요.
                </p>
                {job.directionAnchors.map((anchor) => (
                  <button
                    key={anchor.direction}
                    onClick={() => {
                      if (onChooseAnchor(anchor.assetId)) {
                        setMode("animate");
                      }
                    }}
                  >
                    <img src={`/api/assets/${anchor.assetId}/image`} alt="" />
                    {directionLabels[anchor.direction] || anchor.direction} 기준
                    선택
                  </button>
                ))}
                <button
                  disabled={busy || !capabilities?.spriteGen}
                  onClick={() =>
                    setBatchTarget({ anchors: job.directionAnchors! })
                  }
                >
                  이 기준들로 여러 방향·동작 생성
                </button>
              </div>
            )}
          </div>
        ))}
        {finishedJobs.length > historyCount && (
          <button
            className="wide"
            onClick={() => setHistoryCount((n) => n + 8)}
          >
            이전 작업 더 보기 ({finishedJobs.length - historyCount}개 남음)
          </button>
        )}
      </section>
      {batchTarget && (
        <BatchAnimation
          assets={assets}
          target={batchTarget}
          defaults={{ prompt, size, state, frames, fps, loop, accessConfirmed }}
          onClose={() => setBatchTarget(null)}
          onSubmit={(confirmed) => {
            setAccessConfirmed(confirmed);
            setBatchTarget(null);
            onJob();
          }}
        />
      )}
    </aside>
  );
}
