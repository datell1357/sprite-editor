import { useState } from "react";
import {
  Sparkles,
  WandSparkles,
  CircleCheck,
  X,
  LoaderCircle,
} from "lucide-react";
import type { Asset, Capabilities, Job } from "../types";
import { api } from "../lib/api";

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
  selected,
  capabilities,
  jobs,
  color,
  onColor,
  onJob,
  onError,
}: {
  selected?: Asset;
  capabilities: Capabilities | null;
  jobs: Job[];
  color: string;
  onColor: (s: string) => void;
  onJob: () => void;
  onError: (s: string) => void;
}) {
  const [prompt, setPrompt] = useState(""),
    [provider, setProvider] = useState("codex"),
    [size, setSize] = useState(32),
    [reference, setReference] = useState(false);
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
  return (
    <aside className="inspector panel">
      <section>
        <h2>
          <Sparkles size={20} /> Create
        </h2>
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
            value={provider}
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
        <label className="check-field">
          <input
            type="checkbox"
            disabled={!selected}
            checked={reference && !!selected}
            onChange={(e) => setReference(e.target.checked)}
          />
          선택 자산을 참조해 생성
        </label>
        <button
          className="primary wide"
          disabled={busy || !prompt.trim() || !capabilities?.spriteGen}
          onClick={() =>
            perform(() =>
              api.generate(
                prompt,
                provider,
                size,
                reference ? selected?.id : undefined,
              ),
            )
          }
        >
          <Sparkles size={17} />
          Generate
        </button>
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
        {jobs.slice(0, 8).map((job) => (
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
            {job.error && <p className="notice">{job.error}</p>}
          </div>
        ))}
      </section>
    </aside>
  );
}
