import type { Asset, AutotileConfig, Placement, Project } from "../types";

export function validAutotile(value: unknown): value is AutotileConfig {
  const c = value as AutotileConfig;
  return (
    !!c &&
    typeof c === "object" &&
    typeof c.defaultAssetId === "string" &&
    !!c.defaultAssetId &&
    Array.isArray(c.rules) &&
    c.rules.length <= 32 &&
    new Set(c.rules.map((r) => r?.id)).size === c.rules.length &&
    c.rules.every(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.assetId === "string" &&
        !!r.assetId &&
        Array.isArray(r.pattern) &&
        r.pattern.length === 9 &&
        r.pattern[4] === 1 &&
        r.pattern.every((v) => v === -1 || v === 0 || v === 1),
    )
  );
}
export function autotileAssets(project: Project) {
  return project.layers.flatMap((l) =>
    l.autotile
      ? [l.autotile.defaultAssetId, ...l.autotile.rules.map((r) => r.assetId)]
      : [],
  );
}
export function requireTileDimensions(project: Project, assets: Asset[]) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const id of autotileAssets(project)) {
    const a = byId.get(id);
    if (!a || a.width !== project.tileSize || a.height !== project.tileSize)
      throw new Error(
        `오토타일 자산은 ${project.tileSize}×${project.tileSize}px여야 합니다.`,
      );
  }
}
export function resolveAutotiles(project: Project): Placement[] {
  const occupied = new Map(
    project.layers.map((l) => [
      l.id,
      new Set(
        project.placements
          .filter((p) => p.layerId === l.id)
          .map((p) => `${p.x}:${p.y}`),
      ),
    ]),
  );
  const configs = new Map(project.layers.map((l) => [l.id, l.autotile]));
  return project.placements.map((p) => {
    const config = configs.get(p.layerId);
    if (!config) return p;
    const cells = occupied.get(p.layerId)!;
    const rule = config.rules.find((rule) =>
      rule.pattern.every(
        (v, i) =>
          v === -1 ||
          cells.has(`${p.x + (i % 3) - 1}:${p.y + Math.floor(i / 3) - 1}`) ===
            (v === 1),
      ),
    );
    return { ...p, assetId: rule?.assetId || config.defaultAssetId };
  });
}
