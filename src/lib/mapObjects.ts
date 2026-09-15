import type { Asset, MapObject, Project } from "../types";
import { resolveAutotiles } from "./autotile";

export interface MapDraw {
  id: string;
  kind: "tile" | "object";
  assetId: string;
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function objectBounds(
  object: MapObject,
  asset: Pick<Asset, "width" | "height">,
) {
  return {
    x: object.x - Math.round(asset.width * object.pivotX),
    y: object.y - Math.round(asset.height * object.pivotY),
    width: asset.width,
    height: asset.height,
  };
}

/** Shared order and geometry for canvas, hit testing and PNG export. */
export function mapScene(project: Project, assets: Asset[]) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const tiles = resolveAutotiles(project);
  const draws: MapDraw[] = [],
    missing = new Set<string>();
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const items =
      layer.kind === "object"
        ? project.objects
            .filter((o) => o.layerId === layer.id)
            .slice()
            .sort((a, b) => a.z - b.z)
        : tiles.filter((t) => t.layerId === layer.id);
    for (const item of items) {
      const asset = byId.get(item.assetId);
      if (!asset) {
        missing.add(item.assetId);
        continue;
      }
      const bounds =
        layer.kind === "object"
          ? objectBounds(item as MapObject, asset)
          : {
              x:
                item.x * project.tileSize +
                Math.floor((project.tileSize - asset.width) / 2),
              y: (item.y + 1) * project.tileSize - asset.height,
              width: asset.width,
              height: asset.height,
            };
      draws.push({
        id: item.id,
        kind: layer.kind,
        assetId: asset.id,
        layerId: layer.id,
        ...bounds,
      });
    }
  }
  return { draws, missing: [...missing] };
}

export function hitObject(
  draws: MapDraw[],
  layerId: string,
  x: number,
  y: number,
) {
  for (let i = draws.length - 1; i >= 0; i--) {
    const d = draws[i];
    if (
      d.kind === "object" &&
      d.layerId === layerId &&
      x >= d.x &&
      y >= d.y &&
      x < d.x + d.width &&
      y < d.y + d.height
    )
      return d;
  }
}

export function objectPosition(
  project: Project,
  x: number,
  y: number,
  snap: boolean,
) {
  const unit = snap ? project.tileSize : 1;
  return {
    x: Math.max(
      0,
      Math.min(
        project.mapWidth * project.tileSize,
        Math.round(x / unit) * unit,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        project.mapHeight * project.tileSize,
        Math.round(y / unit) * unit,
      ),
    ),
  };
}

export function placeObject(
  project: Project,
  layerId: string,
  assetId: string,
  x: number,
  y: number,
): Project {
  if (
    !project.layers.some(
      (l) => l.id === layerId && l.kind === "object" && l.visible,
    )
  )
    return project;
  if (project.placements.length + project.objects.length >= 20000)
    throw new Error("맵 배치는 최대 20,000개까지 저장할 수 있습니다.");
  return {
    ...project,
    objects: [
      ...project.objects,
      {
        id: crypto.randomUUID(),
        assetId,
        layerId,
        ...objectPosition(project, x, y, false),
        pivotX: 0.5,
        pivotY: 1,
        z: 0,
        collider: false,
      },
    ],
  };
}

export function updateObject(project: Project, object: MapObject): Project {
  const current = project.objects.find((o) => o.id === object.id);
  if (!current || JSON.stringify(current) === JSON.stringify(object))
    return project;
  return {
    ...project,
    objects: project.objects.map((o) => (o.id === object.id ? object : o)),
  };
}
