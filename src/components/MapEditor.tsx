import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Settings2,
} from "lucide-react";
import type { Asset, Project } from "../types";
import { download, loadImage } from "../lib/api";
import { fillRegion, paintCell } from "../lib/map";
import { resolveAutotiles, requireTileDimensions } from "../lib/autotile";
import { AutotileEditor } from "./AutotileEditor";
import { MapObjectProperties } from "./MapObjectProperties";
import {
  hitObject,
  mapScene,
  objectPosition,
  placeObject,
  updateObject,
} from "../lib/mapObjects";

export function MapEditor({
  project,
  assets,
  selected,
  onChange,
  onError,
  onSelect,
  onEdit,
}: {
  project: Project;
  assets: Asset[];
  selected?: string;
  onChange: (p: Project) => void;
  onError: (s: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    images = useRef(new Map<string, HTMLImageElement>());
  const [layerId, setLayer] = useState(project.layers[0].id),
    [tool, setTool] = useState<"place" | "erase" | "select" | "fill">("place"),
    [revision, bump] = useState(0);
  const [scale, setScale] = useState(1),
    drawing = useRef(false),
    visited = useRef(new Set<string>());
  const previous = useRef<Pick<Project, "placements" | "objects" | "layers">[]>(
      [],
    ),
    next = useRef<Pick<Project, "placements" | "objects" | "layers">[]>([]);
  const working = useRef(project),
    lastPublished = useRef(project),
    strokeRecorded = useRef(false);
  const [ruleLayer, setRuleLayer] = useState<string>();
  const [selectedObjectId, setSelectedObject] = useState<string>();
  const [snap, setSnap] = useState(false),
    [exporting, setExporting] = useState(false);
  const drag = useRef<{ id: string; offsetX: number; offsetY: number } | null>(
    null,
  );
  const activeLayer =
    project.layers.find((l) => l.id === layerId) || project.layers[0];
  const selectedObject = project.objects.find(
    (o) =>
      o.id === selectedObjectId && o.layerId === layerId && activeLayer.visible,
  );
  const scene = useMemo(
    () => mapScene(project, assets),
    [
      project.placements,
      project.objects,
      project.layers,
      project.tileSize,
      assets,
    ],
  );
  const resolved = useMemo(
    () => resolveAutotiles(project),
    [project.placements, project.layers],
  );
  useLayoutEffect(() => {
    const last = lastPublished.current;
    if (
      project.placements !== last.placements ||
      project.objects !== last.objects ||
      project.layers !== last.layers ||
      project.mapWidth !== last.mapWidth ||
      project.mapHeight !== last.mapHeight ||
      project.tileSize !== last.tileSize
    ) {
      previous.current = [];
      next.current = [];
      drawing.current = false;
      drag.current = null;
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
  function render(
    context: CanvasRenderingContext2D,
    grid: boolean,
    snapshot = project,
    items = scene.draws,
  ) {
    const w = snapshot.mapWidth * snapshot.tileSize,
      h = snapshot.mapHeight * snapshot.tileSize;
    context.clearRect(0, 0, w, h);
    context.imageSmoothingEnabled = false;
    for (const item of items) {
      const image = images.current.get(item.assetId);
      if (image) context.drawImage(image, item.x, item.y);
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
      const bounds = items.find(
        (d) => d.kind === "object" && d.id === selectedObjectId,
      );
      if (bounds && selectedObject) {
        context.strokeStyle = "#b8e986";
        context.strokeRect(
          bounds.x + 0.5,
          bounds.y + 0.5,
          bounds.width - 1,
          bounds.height - 1,
        );
        context.beginPath();
        context.moveTo(selectedObject.x - 5, selectedObject.y + 0.5);
        context.lineTo(selectedObject.x + 5, selectedObject.y + 0.5);
        context.moveTo(selectedObject.x + 0.5, selectedObject.y - 5);
        context.lineTo(selectedObject.x + 0.5, selectedObject.y + 5);
        context.stroke();
      }
    }
  }
  useEffect(() => {
    if (canvas.current) render(canvas.current.getContext("2d")!, true);
  }, [project, scene, revision, selectedObjectId]);
  function record() {
    previous.current.push({
      placements: working.current.placements,
      objects: working.current.objects,
      layers: working.current.layers,
    });
    if (previous.current.length > 30) previous.current.shift();
    next.current = [];
  }
  function commit(updated: Project) {
    if (updated === working.current) return;
    record();
    publish(updated);
  }
  function point(
    e:
      | React.PointerEvent<HTMLCanvasElement>
      | React.MouseEvent<HTMLCanvasElement>,
  ) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x:
        ((e.clientX - rect.left) / rect.width) *
        project.mapWidth *
        project.tileSize,
      y:
        ((e.clientY - rect.top) / rect.height) *
        project.mapHeight *
        project.tileSize,
    };
  }
  function objectDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = point(e),
      current = working.current;
    const hit = hitObject(mapScene(current, assets).draws, layerId, p.x, p.y);
    try {
      if (tool === "place" && selected) {
        const position = objectPosition(current, p.x, p.y, snap);
        const updated = placeObject(
          current,
          layerId,
          selected,
          position.x,
          position.y,
        );
        commit(updated);
        setSelectedObject(updated.objects.at(-1)?.id);
      } else if (tool === "erase" && hit) {
        commit({
          ...current,
          objects: current.objects.filter((o) => o.id !== hit.id),
        });
        setSelectedObject(undefined);
      } else if (tool === "select") {
        setSelectedObject(hit?.id);
        if (hit) {
          const object = current.objects.find((o) => o.id === hit.id)!;
          onSelect(object.assetId);
          drag.current = {
            id: object.id,
            offsetX: p.x - object.x,
            offsetY: p.y - object.y,
          };
        }
      }
    } catch (error) {
      onError((error as Error).message);
    }
  }
  function objectMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !drawing.current) return;
    const current = working.current,
      object = current.objects.find((o) => o.id === drag.current!.id);
    if (!object) return;
    const p = point(e),
      updated = updateObject(current, {
        ...object,
        ...objectPosition(
          current,
          p.x - drag.current.offsetX,
          p.y - drag.current.offsetY,
          snap,
        ),
      });
    if (updated === current) return;
    if (!strokeRecorded.current) {
      record();
      strokeRecorded.current = true;
    }
    publish(updated);
  }
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (
      !drawing.current ||
      (!selected && (tool === "place" || tool === "fill"))
    )
      return;
    const current = working.current;
    if (
      !current.layers.some(
        (l) => l.id === layerId && l.kind === "tile" && l.visible,
      )
    )
      return;
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
      const item = [...resolved]
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
        objects: working.current.objects,
        layers: working.current.layers,
      });
      publish({
        ...working.current,
        placements: p.placements,
        objects: p.objects,
        layers: p.layers,
      });
    }
  }
  async function exportMap() {
    setExporting(true);
    try {
      const snapshot = working.current,
        output = mapScene(snapshot, assets);
      if (output.missing.length)
        throw new Error("맵에서 참조한 자산이 누락됐습니다.");
      for (const id of new Set(output.draws.map((d) => d.assetId))) {
        if (!images.current.has(id))
          images.current.set(
            id,
            await loadImage(assets.find((a) => a.id === id)!.url),
          );
      }
      const c = document.createElement("canvas");
      c.width = snapshot.mapWidth * snapshot.tileSize;
      c.height = snapshot.mapHeight * snapshot.tileSize;
      render(c.getContext("2d")!, false, snapshot, output.draws);
      download(`${snapshot.name}-map.png`, c.toDataURL());
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="map-editor panel">
      <div className="canvas-heading">
        <div>
          <h2>{project.name}</h2>
          <span>
            {project.mapWidth} × {project.mapHeight} tiles · {project.tileSize}
            px · {project.placements.length} tiles · {project.objects.length}{" "}
            objects
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
          <button onClick={exportMap} disabled={exporting}>
            <Download size={16} />
            PNG
          </button>
        </div>
      </div>
      <div className="map-toolbar">
        <button
          className={tool === "fill" ? "active" : ""}
          disabled={!selected || activeLayer.kind === "object"}
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
        {activeLayer.kind === "object" && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            격자 스냅
          </label>
        )}
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
        <span className="hint">
          {activeLayer.kind === "object"
            ? "선택 후 드래그로 이동 · 더블클릭으로 스프라이트 편집"
            : "선택 도구로 배치된 자산을 고르세요."}
        </span>
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
            drag.current = null;
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            if (activeLayer.kind === "object") objectDown(e);
            else paint(e);
            if (tool === "fill") drawing.current = false;
          }}
          onPointerMove={(e) =>
            activeLayer.kind === "object" ? objectMove(e) : paint(e)
          }
          onPointerUp={() => {
            drawing.current = false;
            drag.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = false;
            drag.current = null;
          }}
          onDoubleClick={(e) => {
            if (tool !== "select" || activeLayer.kind !== "object") return;
            const p = point(e),
              hit = hitObject(scene.draws, layerId, p.x, p.y);
            if (hit) onEdit(hit.assetId);
          }}
        />
      </div>
      <div className="map-details">
        <div className="layers">
          <div className="section-title">
            <h2>Layers</h2>
            {(["tile", "object"] as const).map((kind) => (
              <button
                key={kind}
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
                        name: `${kind === "object" ? "Objects" : "Tiles"} ${project.layers.length + 1}`,
                        kind,
                        visible: true,
                        collider: false,
                      },
                    ],
                  });
                  setLayer(id);
                  setTool("place");
                  setSelectedObject(undefined);
                }}
              >
                <Plus size={16} />
                {kind === "object" ? "객체" : "타일"} 레이어
              </button>
            ))}
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
              <button
                className="layer-name"
                onClick={() => {
                  setLayer(l.id);
                  setSelectedObject(undefined);
                  if (l.kind === "object" && tool === "fill") setTool("place");
                }}
              >
                {l.name}
                {l.kind === "object"
                  ? " · 객체"
                  : l.autotile
                    ? " · Auto"
                    : " · 타일"}
              </button>
              {l.kind === "tile" && (
                <button
                  aria-label={`${l.name} 오토타일 설정`}
                  title="오토타일 설정"
                  onClick={() => setRuleLayer(l.id)}
                >
                  <Settings2 size={16} />
                </button>
              )}
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
        {selectedObject && (
          <MapObjectProperties
            object={selectedObject}
            assets={assets}
            project={project}
            onEdit={onEdit}
            onChange={(object) => {
              commit(updateObject(working.current, object));
              if (object.assetId !== selectedObject.assetId)
                onSelect(object.assetId);
            }}
          />
        )}
      </div>
      {ruleLayer && project.layers.some((l) => l.id === ruleLayer) && (
        <AutotileEditor
          layer={project.layers.find((l) => l.id === ruleLayer)!}
          assets={assets}
          tileSize={project.tileSize}
          onClose={() => setRuleLayer(undefined)}
          onApply={(config) => {
            try {
              if (
                JSON.stringify(
                  project.layers.find((l) => l.id === ruleLayer)?.autotile,
                ) === JSON.stringify(config)
              ) {
                setRuleLayer(undefined);
                return;
              }
              const updated = {
                ...project,
                layers: project.layers.map((l) =>
                  l.id === ruleLayer ? { ...l, autotile: config } : l,
                ),
              };
              requireTileDimensions(updated, assets);
              record();
              publish(updated);
              setRuleLayer(undefined);
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        />
      )}
    </section>
  );
}
