import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Pause,
  Plus,
  ChevronLeft,
  ChevronRight,
  Archive,
  ArrowUp,
  Download,
  Crosshair,
} from "lucide-react";
import type { AnimationClip, Asset } from "../types";
import { download, downloadJSON, loadImage } from "../lib/api";
import { animationLayout, atlasManifest } from "../lib/animationLayout";
import { AnimationPreview } from "./AnimationPreview";
import { AnimationAlignment } from "./AnimationAlignment";
import {
  frameAtElapsed,
  keepCandidate,
  excludeFrame,
  restoreCandidate,
} from "../lib/animation";

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
  const [aligning, setAligning] = useState(false),
    [exporting, setExporting] = useState(false);
  const { fps, frames: clipFrames, loop } = clip;
  const sequence = clipFrames.map((f) => f.assetId);
  const candidates = clip.candidates || [];
  const preview = useMemo(() => {
    if (!clip.frames.length) return { error: "" };
    try {
      return { layout: animationLayout(clip, assets), error: "" };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [clip, assets]);
  function curate(action: () => AnimationClip) {
    try {
      onClip(action());
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  }
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
  function move(index: number, delta: number) {
    const next = [...clipFrames],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onClip({ ...clip, frames: next });
  }
  async function exportAtlas() {
    setExporting(true);
    try {
      const layout = animationLayout(clip, assets),
        manifest = atlasManifest(clip, layout);
      const sources = new Map(layout.frames.map((f) => [f.asset.id, f.asset]));
      const images = new Map(
        await Promise.all(
          [...sources.values()].map(async (a) => {
            const image = await loadImage(a.url);
            if (image.width !== a.width || image.height !== a.height)
              throw new Error("프레임의 실제 크기가 자산 정보와 다릅니다.");
            return [a.id, image] as const;
          }),
        ),
      );
      const c = document.createElement("canvas");
      c.width = manifest.sheetWidth;
      c.height = manifest.sheetHeight;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      manifest.frames.forEach((f) =>
        ctx.drawImage(images.get(f.assetId)!, f.sourceRect.x, f.sourceRect.y),
      );
      const png = await new Promise<Blob>((resolve, reject) =>
        c.toBlob((blob) =>
          blob ? resolve(blob) : reject(new Error("PNG를 만들 수 없습니다.")),
        ),
      );
      if (png.size > 12 * 1024 * 1024)
        throw new Error(
          "PNG 아틀라스는 12MB 이하여야 다시 가져올 수 있습니다. 프레임 수나 크기를 줄여 주세요.",
        );
      const url = URL.createObjectURL(png);
      try {
        download("sprite-atlas.png", url);
        downloadJSON("sprite-atlas.json", manifest);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <section
      className={`timeline panel ${candidates.length ? "has-candidates" : ""}`}
    >
      <div className="section-title">
        <h2>
          Timeline <span>{sequence.length} frames</span>
        </h2>
        <div className="inline">
          <button
            aria-label="프레임 정렬과 피벗"
            title="프레임 정렬과 피벗"
            disabled={!sequence.length}
            onClick={() => {
              setPlaying(false);
              setAligning(true);
            }}
          >
            <Crosshair size={16} />
          </button>
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
            disabled={!sequence.length || exporting}
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
        {preview.layout && (
          <div className="play-preview checker">
            <AnimationPreview layout={preview.layout} frame={frame} />
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
                  aria-label={`프레임 ${i + 1} 후보로 이동`}
                  title="재생에서 제외하고 후보로 보관"
                  disabled={candidates.length >= 256}
                  onClick={() => curate(() => excludeFrame(clip, i))}
                >
                  <Archive size={13} />
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
      {preview.error && (
        <p role="alert" className="notice">
          {preview.error}
        </p>
      )}
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
      <div className="candidate-heading">
        <span>후보 {candidates.length}개 · 재생에서 제외됨</span>
        <button
          disabled={!selected || candidates.length >= 256}
          onClick={() =>
            selected &&
            curate(() =>
              keepCandidate(clip, {
                assetId: selected,
                durationMs: 1000 / fps,
              }),
            )
          }
        >
          <Archive size={13} />
          선택 자산 보관
        </button>
      </div>
      {!!candidates.length && (
        <div className="candidate-list">
          {candidates.map((f, i) => (
            <div className="candidate" key={`${i}-${f.assetId}`}>
              <button
                aria-label={`후보 ${i + 1} 선택`}
                onClick={() => onSelect(f.assetId)}
              >
                <img src={assets.find((a) => a.id === f.assetId)?.url} alt="" />
                <span>{Math.round(f.durationMs * 100) / 100}ms</span>
              </button>
              <button
                aria-label={`후보 ${i + 1} 재생에 추가`}
                title="기존 시간으로 재생 목록 끝에 복원"
                disabled={clip.frames.length >= 256}
                onClick={() => {
                  if (curate(() => restoreCandidate(clip, i)))
                    setFrame(clip.frames.length);
                }}
              >
                <ArrowUp size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {aligning && (
        <AnimationAlignment
          clip={clip}
          assets={assets}
          initialFrame={frame}
          onClose={() => setAligning(false)}
          onApply={(updated) => {
            if (curate(() => updated)) setAligning(false);
          }}
        />
      )}
    </section>
  );
}
