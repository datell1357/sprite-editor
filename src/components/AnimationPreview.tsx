import { useEffect, useRef, useState } from "react";
import type { AnimationLayout } from "../lib/animationLayout";
import { loadImage } from "../lib/api";

export function AnimationPreview({
  layout,
  frame,
  guides = false,
  onion = false,
}: {
  layout: AnimationLayout;
  frame: number;
  guides?: boolean;
  onion?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    images = useRef(new Map<string, HTMLImageElement>());
  const [revision, bump] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    const assets = new Map(layout.frames.map((f) => [f.asset.id, f.asset]));
    Promise.all(
      [...assets.values()].map(async (a) => {
        if (!images.current.has(a.id))
          images.current.set(a.id, await loadImage(a.url));
      }),
    )
      .then(() => live && bump((v) => v + 1))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [layout]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, layout.width, layout.height);
    context.imageSmoothingEnabled = false;
    const draw = (index: number) => {
      const item = layout.frames[index],
        image = item && images.current.get(item.asset.id);
      if (image) context.drawImage(image, item.x, item.y);
    };
    if (onion && frame > 0) {
      context.globalAlpha = 0.25;
      draw(frame - 1);
    }
    context.globalAlpha = 1;
    draw(frame);
    if (guides) {
      const x = Math.min(layout.width - 0.5, layout.pivotX + 0.5),
        y = Math.min(layout.height - 0.5, layout.pivotY + 0.5);
      context.strokeStyle = "#b8e986";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, layout.height);
      context.moveTo(0, y);
      context.lineTo(layout.width, y);
      context.stroke();
      context.setLineDash([]);
    }
  }, [layout, frame, guides, onion, revision]);
  return (
    <>
      <canvas
        ref={canvas}
        role="img"
        aria-label={guides ? "프레임 정렬 미리보기" : "애니메이션 미리보기"}
        width={layout.width}
        height={layout.height}
      />
      {error && (
        <span role="alert" className="notice">
          {error}
        </span>
      )}
    </>
  );
}
