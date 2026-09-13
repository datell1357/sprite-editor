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
import type { AnimationClip, Asset } from "../types";
import { download, downloadJSON, loadImage } from "../lib/api";
import { frameAtElapsed } from "../lib/animation";

export function Timeline({
  assets,
  clip,
  selected,
  onClip,
  onSelect,
  onError,
}: {
  assets: Asset[];
  clip: AnimationClip;
  selected?: string;
  onClip: (clip: AnimationClip) => void;
  onSelect: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [playing, setPlaying] = useState(false),
    [frame, setFrame] = useState(0);
  const { fps, frames: clipFrames, loop } = clip;
  const sequence = clipFrames.map((f) => f.assetId);
  useEffect(() => {
    if (!playing || !clipFrames.length) return;
    const offset = clipFrames
      .slice(0, frame)
      .reduce((sum, f) => sum + f.durationMs, 0);
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const position = frameAtElapsed(
        clipFrames,
        performance.now() - start + offset,
        loop,
      );
      setFrame(position.index);
      if (position.ended) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clipFrames, loop]);
  useEffect(() => {
    setFrame((f) => Math.min(f, Math.max(0, clipFrames.length - 1)));
    setPlaying(false);
  }, [clipFrames]);
  const current = assets.find((a) => a.id === sequence[frame]);
  function move(index: number, delta: number) {
    const next = [...clipFrames],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onClip({ ...clip, frames: next });
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
          duration: clipFrames[i].durationMs / 1000,
          assetId: sequence[i],
        };
      });
      download("sprite-atlas.png", c.toDataURL());
      downloadJSON("sprite-atlas.json", {
        version: 1,
        image: "sprite-atlas.png",
        fps,
        loop,
        name: clip.name,
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
          <label className="loop-toggle">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => onClip({ ...clip, loop: e.target.checked })}
            />
            반복
          </label>
          <label className="fps">
            <input
              aria-label="애니메이션 FPS"
              type="number"
              min={1}
              max={60}
              step="any"
              title="FPS 변경은 모든 프레임 시간을 균등하게 설정합니다"
              value={fps}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1 && v <= 60)
                  onClip({
                    ...clip,
                    fps: v,
                    frames: clipFrames.map((f) => ({
                      ...f,
                      durationMs: 1000 / v,
                    })),
                  });
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
          onClick={() => {
            if (!playing && frame === clipFrames.length - 1) setFrame(0);
            setPlaying(!playing);
          }}
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
                  onSelect(id);
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
                  onClick={() =>
                    onClip({
                      ...clip,
                      frames: clipFrames.filter((_, n) => n !== i),
                    })
                  }
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
            onClick={() =>
              selected &&
              onClip({
                ...clip,
                frames: [
                  ...clipFrames,
                  { assetId: selected, durationMs: 1000 / fps },
                ],
              })
            }
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
      {clipFrames[frame] && (
        <label className="frame-duration">
          프레임 {frame + 1} 시간{" "}
          <input
            aria-label="프레임 시간 ms"
            type="number"
            step="any"
            min={1}
            max={60000}
            value={clipFrames[frame].durationMs}
            onChange={(e) => {
              const durationMs = Number(e.target.value);
              if (
                Number.isFinite(durationMs) &&
                durationMs > 0 &&
                durationMs <= 60000
              )
                onClip({
                  ...clip,
                  frames: clipFrames.map((f, i) =>
                    i === frame ? { ...f, durationMs } : f,
                  ),
                });
            }}
          />{" "}
          ms
        </label>
      )}
    </section>
  );
}
