import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Download,
} from "lucide-react";
import type { Asset } from "../types";
import { download, downloadJSON, loadImage } from "../lib/api";

export function Timeline({
  assets,
  sequence,
  fps,
  selected,
  onSequence,
  onFps,
  onError,
}: {
  assets: Asset[];
  sequence: string[];
  fps: number;
  selected?: string;
  onSequence: (ids: string[]) => void;
  onFps: (v: number) => void;
  onError: (s: string) => void;
}) {
  const [playing, setPlaying] = useState(false),
    [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!playing || !sequence.length) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % sequence.length),
      1000 / fps,
    );
    return () => clearInterval(timer);
  }, [playing, fps, sequence.length]);
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [sequence]);
  const current = assets.find((a) => a.id === sequence[frame]);
  function move(index: number, delta: number) {
    const next = [...sequence],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onSequence(next);
  }
  async function exportAtlas() {
    try {
      const frames = await Promise.all(
        sequence.map((id) => {
          const a = assets.find((a) => a.id === id);
          if (!a) throw new Error("프레임 자산이 누락됐습니다.");
          return loadImage(a.url);
        }),
      );
      const w = Math.max(...frames.map((f) => f.width)),
        h = Math.max(...frames.map((f) => f.height));
      const cols = Math.min(frames.length, Math.max(1, Math.floor(4096 / w))),
        rows = Math.ceil(frames.length / cols);
      if (rows * h > 8192)
        throw new Error(
          "아틀라스가 너무 큽니다. 프레임 수나 이미지 크기를 줄여 주세요.",
        );
      const c = document.createElement("canvas");
      c.width = cols * w;
      c.height = rows * h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const layout = frames.map((f, i) => {
        const x = (i % cols) * w,
          y = Math.floor(i / cols) * h,
          offsetX = Math.floor((w - f.width) / 2),
          offsetY = h - f.height;
        ctx.drawImage(f, x + offsetX, y + offsetY);
        return {
          x,
          y,
          w,
          h,
          offsetX,
          offsetY,
          duration: 1 / fps,
          assetId: sequence[i],
        };
      });
      download("sprite-atlas.png", c.toDataURL());
      downloadJSON("sprite-atlas.json", {
        version: 1,
        image: "sprite-atlas.png",
        fps,
        loop: true,
        frames: layout,
      });
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <section className="timeline panel">
      <div className="section-title">
        <h2>
          Timeline <span>{sequence.length} frames</span>
        </h2>
        <div className="inline">
          <label className="fps">
            <input
              aria-label="애니메이션 FPS"
              type="number"
              min={1}
              max={60}
              value={fps}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 1 && v <= 60) onFps(v);
              }}
            />{" "}
            fps
          </label>
          <button
            title="아틀라스 PNG와 JSON 내보내기"
            disabled={!sequence.length}
            onClick={exportAtlas}
          >
            <Download size={16} />
          </button>
        </div>
      </div>
      <div className="timeline-content">
        <button
          className="play"
          disabled={!sequence.length}
          aria-label={playing ? "일시정지" : "재생"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        {current && (
          <div className="play-preview checker">
            <img alt="애니메이션 미리보기" src={current.url} />
          </div>
        )}
        <div className="frame-list">
          {sequence.map((id, i) => (
            <div
              className={`frame ${frame === i ? "selected" : ""}`}
              key={`${i}-${id}`}
            >
              <button
                className="frame-image"
                onClick={() => {
                  setPlaying(false);
                  setFrame(i);
                }}
              >
                <img
                  src={assets.find((a) => a.id === id)?.url}
                  alt={`프레임 ${i + 1}`}
                />
                <span>{i + 1}</span>
              </button>
              <div className="frame-actions">
                <button
                  aria-label={`프레임 ${i + 1} 앞으로`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  aria-label={`프레임 ${i + 1} 제거`}
                  onClick={() => onSequence(sequence.filter((_, n) => n !== i))}
                >
                  <X size={13} />
                </button>
                <button
                  aria-label={`프레임 ${i + 1} 뒤로`}
                  disabled={i === sequence.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          ))}
          <button
            className="add-frame"
            disabled={!selected || sequence.length >= 256}
            onClick={() => selected && onSequence([...sequence, selected])}
            title="선택한 자산을 프레임으로 추가"
            aria-label="선택한 자산을 프레임으로 추가"
          >
            <Plus />
          </button>
          {!sequence.length && (
            <p className="hint">
              자산을 골라 프레임에 추가하세요.
              <br />
              순서를 바꾸고 바로 재생할 수 있어요.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
