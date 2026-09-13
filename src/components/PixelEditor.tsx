import { useEffect, useRef, useState } from "react";
import {
  Pencil,
  Eraser,
  Pipette,
  Grid2X2,
  Minus,
  Plus,
  Undo2,
  Redo2,
  Save,
  Download,
  Columns2,
} from "lucide-react";
import type { Asset, Tool } from "../types";
import { download, loadImage } from "../lib/api";

export function PixelEditor({
  asset,
  color,
  onColor,
  onSave,
  onError,
  onDirty,
  canCompare,
  onCompare,
}: {
  asset?: Asset;
  color: string;
  onColor: (color: string) => void;
  onSave: (png: string) => Promise<void>;
  onError: (s: string) => void;
  onDirty: (dirty: boolean) => void;
  canCompare: boolean;
  onCompare: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<ImageData[]>([]),
    future = useRef<ImageData[]>([]);
  const drawing = useRef(false),
    last = useRef<[number, number] | null>(null);
  const [tool, setTool] = useState<Tool>("brush"),
    [grid, setGrid] = useState(false),
    [zoom, setZoom] = useState(8);
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [ready, setReady] = useState(false);
  const [, refresh] = useState(0);
  const dirtyChange = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  useEffect(() => {
    let active = true;
    setReady(false);
    history.current = [];
    future.current = [];
    setDirty(false);
    onDirty(false);
    if (asset)
      loadImage(asset.url)
        .then((image) => {
          if (!active || !canvas.current) return;
          canvas.current.width = image.width;
          canvas.current.height = image.height;
          canvas.current.getContext("2d")!.drawImage(image, 0, 0);
          const area = canvas.current.parentElement?.parentElement;
          const fit =
            Math.max(
              64,
              Math.min(area?.clientWidth || 400, area?.clientHeight || 400) -
                48,
            ) / Math.max(image.width, image.height);
          setZoom(
            fit >= 1 ? Math.min(20, Math.floor(fit)) : Math.max(0.125, fit),
          );
          setReady(true);
        })
        .catch((e) => active && onError(e.message));
    return () => {
      active = false;
    };
  }, [asset?.id]);
  const snapshot = () => {
    const c = canvas.current!;
    return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  };
  function undo(redo = false) {
    const from = redo ? future.current : history.current,
      to = redo ? history.current : future.current;
    const previous = from.pop();
    if (!previous) return;
    to.push(snapshot());
    canvas.current!.getContext("2d")!.putImageData(previous, 0, 0);
    dirtyChange(true);
    refresh((v) => v + 1);
  }
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || !canvas.current) return;
    const c = canvas.current,
      rect = c.getBoundingClientRect(),
      context = c.getContext("2d")!;
    const x = Math.floor(((e.clientX - rect.left) * c.width) / rect.width),
      y = Math.floor(((e.clientY - rect.top) * c.height) / rect.height);
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    if (tool === "picker") {
      const p = context.getImageData(x, y, 1, 1).data;
      onColor(
        "#" +
          Array.from(p.slice(0, 3))
            .map((v) => v.toString(16).padStart(2, "0"))
            .join(""),
      );
      return;
    }
    if (!drawing.current) return;
    const start = last.current || [x, y],
      dx = x - start[0],
      dy = y - start[1],
      steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    context.fillStyle = color;
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(start[0] + (dx * i) / steps),
        py = Math.round(start[1] + (dy * i) / steps);
      if (tool === "eraser") context.clearRect(px, py, 1, 1);
      else context.fillRect(px, py, 1, 1);
    }
    last.current = [x, y];
    dirtyChange(true);
  }
  async function save() {
    setSaving(true);
    try {
      await onSave(canvas.current!.toDataURL("image/png"));
      dirtyChange(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="pixel-editor panel">
      <div className="canvas-heading">
        <div>
          <h2>{asset?.name || "Sprite canvas"}</h2>
          <span>
            {asset
              ? `${asset.width} × ${asset.height}`
              : "자산을 선택해 시작하세요"}
            {dirty ? " · 수정 중" : ""}
          </span>
        </div>
        <div className="inline">
          <button
            disabled={!canCompare || dirty || saving}
            onClick={onCompare}
            title="저장된 원본과 비교 (수정 중이면 먼저 저장하세요)"
          >
            <Columns2 size={16} />
            비교
          </button>
          <button
            className="icon-button"
            aria-label="픽셀 실행 취소"
            disabled={!history.current.length || saving}
            onClick={() => undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="픽셀 다시 실행"
            disabled={!future.current.length || saving}
            onClick={() => undo(true)}
          >
            <Redo2 size={17} />
          </button>
        </div>
      </div>
      <div className="canvas-body">
        <div className="tool-rail">
          {(
            [
              ["brush", Pencil, "브러시"],
              ["eraser", Eraser, "지우개"],
              ["picker", Pipette, "스포이트"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              className={tool === id ? "active" : ""}
              onClick={() => setTool(id)}
            >
              <Icon size={21} />
            </button>
          ))}
          <button
            aria-label="픽셀 격자"
            className={grid ? "active" : ""}
            onClick={() => setGrid(!grid)}
          >
            <Grid2X2 size={21} />
          </button>
          <input
            aria-label="브러시 색상"
            type="color"
            value={color}
            onChange={(e) => onColor(e.target.value)}
          />
        </div>
        <div className="canvas-viewport">
          {asset ? (
            <div
              className="pixel-sheet checker"
              style={{ width: asset.width * zoom, height: asset.height * zoom }}
            >
              <canvas
                aria-label="스프라이트 픽셀 캔버스"
                ref={canvas}
                style={{
                  width: "100%",
                  height: "100%",
                  touchAction: "none",
                  cursor: tool === "picker" ? "crosshair" : "cell",
                }}
                onPointerDown={(e) => {
                  if (!ready || saving) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  if (tool !== "picker") {
                    history.current.push(snapshot());
                    if (history.current.length > 30) history.current.shift();
                    future.current = [];
                    drawing.current = true;
                  }
                  paint(e);
                }}
                onPointerMove={(e) => drawing.current && paint(e)}
                onPointerUp={() => {
                  drawing.current = false;
                  last.current = null;
                  refresh((v) => v + 1);
                }}
                onPointerCancel={() => {
                  drawing.current = false;
                  last.current = null;
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
              {grid && zoom >= 4 && (
                <div
                  className="pixel-grid"
                  style={{ backgroundSize: `${zoom}px ${zoom}px` }}
                />
              )}
            </div>
          ) : (
            <div className="canvas-empty">
              <Grid2X2 size={38} />
              <h3>작은 픽셀로 시작하는 세계</h3>
              <p>PNG를 가져오거나 오른쪽에서 새 자산을 생성하세요.</p>
            </div>
          )}
        </div>
      </div>
      <div className="canvas-footer">
        <div className="zoom">
          <button
            aria-label="축소"
            onClick={() =>
              setZoom(
                zoom > 1 ? Math.max(1, zoom - 1) : Math.max(0.125, zoom / 2),
              )
            }
          >
            <Minus size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="확대"
            onClick={() =>
              setZoom(zoom < 1 ? Math.min(1, zoom * 2) : Math.min(20, zoom + 1))
            }
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          disabled={!asset || !ready}
          onClick={() =>
            download(`${asset!.name}.png`, canvas.current!.toDataURL())
          }
        >
          <Download size={15} />
          PNG
        </button>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          <Save size={15} />
          {saving ? "저장 중" : "수정본 저장"}
        </button>
      </div>
    </section>
  );
}
