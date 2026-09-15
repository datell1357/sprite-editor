import type { Asset, MapObject, Project } from "../types";
import { objectPosition } from "../lib/mapObjects";

export function MapObjectProperties({
  object,
  assets,
  project,
  onChange,
  onEdit,
}: {
  object: MapObject;
  assets: Asset[];
  project: Project;
  onChange: (object: MapObject) => void;
  onEdit: (assetId: string) => void;
}) {
  const asset = assets.find((a) => a.id === object.assetId);
  return (
    <section className="object-properties" aria-label="선택 객체 속성">
      <div className="section-title">
        <h2>선택 객체</h2>
        <button onClick={() => onEdit(object.assetId)}>스프라이트 편집</button>
      </div>
      <label className="field">
        자산 버전
        <select
          aria-label="객체 자산 버전"
          value={object.assetId}
          onChange={(e) => onChange({ ...object, assetId: e.target.value })}
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.width}×{a.height}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {asset?.width}×{asset?.height}px 원본 크기 · 자산을 바꿔도 피벗의 맵
        좌표는 유지됩니다.
      </p>
      <div className="object-fields">
        {(["x", "y"] as const).map((axis) => (
          <label key={axis}>
            {axis.toUpperCase()} (px)
            <input
              aria-label={`객체 ${axis.toUpperCase()} 좌표`}
              type="number"
              min={0}
              step={1}
              max={
                (axis === "x" ? project.mapWidth : project.mapHeight) *
                project.tileSize
              }
              value={object[axis]}
              onChange={(e) => {
                if (
                  e.target.value === "" ||
                  !Number.isFinite(e.target.valueAsNumber)
                )
                  return;
                onChange({
                  ...object,
                  ...objectPosition(
                    project,
                    axis === "x" ? e.target.valueAsNumber : object.x,
                    axis === "y" ? e.target.valueAsNumber : object.y,
                    false,
                  ),
                });
              }}
            />
          </label>
        ))}
        {(["pivotX", "pivotY"] as const).map((axis) => (
          <label key={axis}>
            피벗 {axis === "pivotX" ? "X" : "Y"} (%)
            <input
              aria-label={`객체 피벗 ${axis === "pivotX" ? "X" : "Y"}`}
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Number((object[axis] * 100).toFixed(6))}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (Number.isFinite(value) && value >= 0 && value <= 100)
                  onChange({ ...object, [axis]: value / 100 });
              }}
            />
          </label>
        ))}
        <label>
          겹침 순서
          <input
            aria-label="객체 겹침 순서"
            type="number"
            min={-10000}
            max={10000}
            step={1}
            value={object.z}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isInteger(value) && Math.abs(value) <= 10000)
                onChange({ ...object, z: value });
            }}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={object.collider}
            onChange={(e) =>
              onChange({ ...object, collider: e.target.checked })
            }
          />
          객체 충돌
        </label>
      </div>
    </section>
  );
}
