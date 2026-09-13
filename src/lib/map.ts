import type { Placement, Project } from "../types";

export function inMap(project: Project, x: number, y: number) {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < project.mapWidth &&
    y < project.mapHeight
  );
}

export function fillRegion(
  project: Project,
  layerId: string,
  x: number,
  y: number,
  assetId: string,
  createId: () => string = () => crypto.randomUUID(),
): Placement[] {
  if (
    !inMap(project, x, y) ||
    !project.layers.some((l) => l.id === layerId && l.visible)
  )
    return project.placements;
  const cells = new Map(
    project.placements
      .filter((p) => p.layerId === layerId)
      .map((p) => [p.y * project.mapWidth + p.x, p.assetId]),
  );
  const start = y * project.mapWidth + x,
    target = cells.get(start);
  if (target === assetId) return project.placements;
  const queue = [start],
    region = new Set<number>([start]);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i],
      cx = cell % project.mapWidth,
      cy = Math.floor(cell / project.mapWidth);
    for (const [nx, ny] of [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ]) {
      if (!inMap(project, nx, ny)) continue;
      const key = ny * project.mapWidth + nx;
      if (!region.has(key) && cells.get(key) === target) {
        region.add(key);
        queue.push(key);
      }
    }
  }
  const retained = project.placements.filter(
    (p) => p.layerId !== layerId || !region.has(p.y * project.mapWidth + p.x),
  );
  if (retained.length + region.size > 20000)
    throw new Error("맵 배치는 최대 20,000개까지 저장할 수 있습니다.");
  return [
    ...retained,
    ...queue.map((cell) => ({
      id: createId(),
      assetId,
      layerId,
      x: cell % project.mapWidth,
      y: Math.floor(cell / project.mapWidth),
    })),
  ];
}

export function paintCell(
  project: Project,
  layerId: string,
  x: number,
  y: number,
  assetId?: string,
): Placement[] {
  if (
    !inMap(project, x, y) ||
    !project.layers.some((l) => l.id === layerId && l.visible)
  )
    return project.placements;
  const existing = project.placements.filter(
    (p) => p.layerId === layerId && p.x === x && p.y === y,
  );
  if (
    (!assetId && !existing.length) ||
    (existing.length === 1 && existing[0].assetId === assetId)
  )
    return project.placements;
  const rest = project.placements.filter(
    (p) => !(p.layerId === layerId && p.x === x && p.y === y),
  );
  if (!assetId) return rest;
  if (rest.length >= 20000)
    throw new Error("맵 배치는 최대 20,000개까지 저장할 수 있습니다.");
  return [...rest, { id: crypto.randomUUID(), assetId, layerId, x, y }];
}
