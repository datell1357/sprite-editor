import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Pencil,
  PaintBucket,
  Eraser,
  MousePointer2,
  Eye,
  EyeOff,
  Plus,
  Download,
  Undo2,
  Redo2,
  Shield,
} from "lucide-react";
import type { Asset, Project } from "../types";
import { download, loadImage } from "../lib/api";
import { fillRegion, paintCell } from "../lib/map";

export function MapEditor({
  project,
  assets,
  selected,
  onChange,
  onError,
  onSelect,
}: {
  project: Project;
  assets: Asset[];
  selected?: string;
  onChange: (p: Project) => void;
  onError: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    images = useRef(new Map<string, HTMLImageElement>());
  const [layerId, setLayer] = useState(project.layers[0].id),
    [tool, setTool] = useState<"place" | "erase" | "select" | "fill">("place"),
    [revision, bump] = useState(0);
  const [scale, setScale] = useState(1),
    drawing = useRef(false),
    visited = useRef(new Set<string>());
  const previous = useRef<Pick<Project, "placements" | "layers">[]>([]),
    next = useRef<Pick<Project, "placements" | "layers">[]>([]);
  const working = useRef(project),
    lastPublished = useRef(project),
    strokeRecorded = useRef(false);
  useLayoutEffect(() => {
    const last = lastPublished.current;
    if (
      project.placements !== last.placements ||
      project.layers !== last.layers ||
      project.mapWidth !== last.mapWidth ||
      project.mapHeight !== last.mapHeight ||
      project.tileSize !== last.tileSize
    ) {
      previous.current = [];
      next.current = [];
      drawing.current = false;
      bump((v) => v + 1);
    }
    working.current = project;
    lastPublished.current = project;
  }, [project]);
  function publish(updated: Project) {
    working.current = updated;
    lastPublished.current = updated;
    onChange(updated);
  }
  useEffect(() => {
    let live = true;
    Promise.all(
      assets.map(async (a) => {
        if (!images.current.has(a.id))
          images.current.set(a.id, await loadImage(a.url));
      }),
    )
      .then(() => live && bump((v) => v + 1))
      .catch((e) => live && onError(e.message));
    return () => {
      live = false;
    };
  }, [assets]);
  useEffect(() => {
    if (!project.layers.some((l) => l.id === layerId))
      setLayer(project.layers[0].id);
  }, [project.layers, layerId]);
  function render(context: CanvasRenderingContext2D, grid: boolean) {
    const w = project.mapWidth * project.tileSize,
      h = project.mapHeight * project.tileSize;
    context.clearRect(0, 0, w, h);
    context.imageSmoothingEnabled = false;
    for (const layer of project.layers) {
      if (!layer.visible) continue;
      for (const p of project.placements.filter(
        (p) => p.layerId === layer.id,
      )) {
        const image = images.current.get(p.assetId);
        if (!image) continue;
        // Objects keep their native dimensions; tile coordinates anchor at bottom centre.
        context.drawImage(
          image,
          p.x * project.tileSize +
            Math.floor((project.tileSize - image.width) / 2),
          (p.y + 1) * project.tileSize - image.height,
        );
      }
    }
    if (grid) {
      context.strokeStyle = "#ffffff12";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= w; x += project.tileSize) {
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, h);
      }
      for (let y = 0; y <= h; y += project.tileSize) {
        context.moveTo(0, y + 0.5);
        context.lineTo(w, y + 0.5);
      }
      context.stroke();
    }
  }
  useEffect(() => {
    if (canvas.current) render(canvas.current.getContext("2d")!, true);
  }, [project, revision]);
  function record() {
    previous.current.push({
      placements: working.current.placements,
      layers: working.current.layers,
    });
    if (previous.current.length > 30) previous.current.shift();
    next.current = [];
  }
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (
      !drawing.current ||
      (!selected && (tool === "place" || tool === "fill"))
    )
      return;
    const current = working.current;
    const rect = e.currentTarget.getBoundingClientRect(),
      x = Math.floor(((e.clientX - rect.left) / rect.width) * project.mapWidth),
      y = Math.floor(
        ((e.clientY - rect.top) / rect.height) * project.mapHeight,
      );
    if (
      x < 0 ||
      y < 0 ||
      x >= project.mapWidth ||
      y >= project.mapHeight ||
      visited.current.has(`${x}:${y}`)
    )
      return;
    visited.current.add(`${x}:${y}`);
    if (tool === "select") {
      const item = [...project.placements]
        .reverse()
        .find((p) => p.x === x && p.y === y && p.layerId === layerId);
      if (item) onSelect(item.assetId);
      return;
    }
    try {
      const placements =
        tool === "fill"
          ? fillRegion(current, layerId, x, y, selected!)
          : paintCell(
              current,
              layerId,
              x,
              y,
              tool === "erase" ? undefined : selected,
            );
      if (placements === current.placements) return;
      if (!strokeRecorded.current) {
        record();
        strokeRecorded.current = true;
      }
      publish({ ...current, placements });
    } catch (error) {
      onError((error as Error).message);
    }
  }

  function undo(redo = false) {
    const from = redo ? next.current : previous.current,
      to = redo ? previous.current : next.current;
    const p = from.pop();
    if (p) {
      to.push({
        placements: working.current.placements,
        layers: working.current.layers,
      });
      publish({
        ...working.current,
        placements: p.placements,
        layers: p.layers,
      });
    }
  }
  function exportMap() {
    const c = document.createElement("canvas");
    c.width = project.mapWidth * project.tileSize;
    c.height = project.mapHeight * project.tileSize;
    render(c.getContext("2d")!, false);
    download(`${project.name}-map.png`, c.toDataURL());
  }
  return (
    <section className="map-editor panel">
      <div className="canvas-heading">
        <div>
          <h2>{project.name}</h2>
          <span>
            {project.mapWidth} × {project.mapHeight} tiles · {project.tileSize}
            px · {project.placements.length} placements
          </span>
        </div>
        <div className="inline">
          <button
            title="맵 실행 취소"
            aria-label="맵 실행 취소"
            disabled={!previous.current.length}
            onClick={() => undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            title="맵 다시 실행"
            aria-label="맵 다시 실행"
            disabled={!next.current.length}
            onClick={() => undo(true)}
          >
            <Redo2 size={16} />
          </button>
          <button onClick={exportMap}>
            <Download size={16} />
            PNG
          </button>
        </div>
      </div>
      <div className="map-toolbar">
        <button
          className={tool === "fill" ? "active" : ""}
          disabled={!selected}
          onClick={() => setTool("fill")}
          title="선택한 레이어에서 연결된 같은 자산 또는 빈 영역 채우기"
        >
          <PaintBucket size={16} />
          채우기
        </button>
        <button
          className={tool === "place" ? "active" : ""}
          onClick={() => setTool("place")}
        >
          <Pencil size={16} />
          배치
        </button>
        <button
          className={tool === "erase" ? "active" : ""}
          onClick={() => setTool("erase")}
        >
          <Eraser size={16} />
          지우기
        </button>
        <button
          className={tool === "select" ? "active" : ""}
          onClick={() => setTool("select")}
        >
          <MousePointer2 size={16} />
          선택
        </button>
        <label>
          Zoom
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            {[0.5, 1, 2].map((s) => (
              <option key={s} value={s}>
                {s * 100}%
              </option>
            ))}
          </select>
        </label>
        <span className="hint">선택 도구로 배치된 자산을 고르세요.</span>
      </div>
      <div className="map-viewport checker">
        <canvas
          aria-label="타일맵 캔버스"
          ref={canvas}
          width={project.mapWidth * project.tileSize}
          height={project.mapHeight * project.tileSize}
          style={{
            width: project.mapWidth * project.tileSize * scale,
            height: project.mapHeight * project.tileSize * scale,
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            if (!project.layers.find((l) => l.id === layerId)?.visible) return;
            strokeRecorded.current = false;
            visited.current.clear();
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            paint(e);
            if (tool === "fill") drawing.current = false;
          }}
          onPointerMove={paint}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
      </div>
      <div className="layers">
        <div className="section-title">
          <h2>Layers</h2>
          <button
            disabled={project.layers.length >= 32}
            onClick={() => {
              record();
              const id = crypto.randomUUID();
              publish({
                ...project,
                layers: [
                  ...project.layers,
                  {
                    id,
                    name: `Layer ${project.layers.length + 1}`,
                    visible: true,
                    collider: false,
                  },
                ],
              });
              setLayer(id);
            }}
          >
            <Plus size={16} />
            레이어
          </button>
        </div>
        {project.layers.map((l) => (
          <div
            className={`layer ${l.id === layerId ? "active" : ""}`}
            key={l.id}
          >
            <button
              aria-label={`${l.name} 표시 전환`}
              onClick={() => {
                record();
                publish({
                  ...project,
                  layers: project.layers.map((a) =>
                    a.id === l.id ? { ...a, visible: !a.visible } : a,
                  ),
                });
              }}
            >
              {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button className="layer-name" onClick={() => setLayer(l.id)}>
              {l.name}
            </button>
            <button
              className={l.collider ? "active" : ""}
              aria-label={`${l.name} 충돌 전환`}
              title="충돌 레이어"
              onClick={() => {
                record();
                publish({
                  ...project,
                  layers: project.layers.map((a) =>
                    a.id === l.id ? { ...a, collider: !a.collider } : a,
                  ),
                });
              }}
            >
              <Shield size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
