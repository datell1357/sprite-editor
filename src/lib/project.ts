import type { AnimationClip, Asset, PortableProject, Project } from "../types";

export const emptyProject = (): Project => ({
  version: 2,
  name: "Untitled world",
  tileSize: 32,
  mapWidth: 24,
  mapHeight: 16,
  layers: [
    { id: "ground", name: "Ground", visible: true, collider: false },
    { id: "objects", name: "Objects", visible: true, collider: false },
  ],
  placements: [],
  clips: [{ id: "default", name: "Animation", frames: [], fps: 8, loop: true }],
  activeClipId: "default",
});

export function validateProject(value: unknown): Project {
  if (!value || typeof value !== "object")
    throw new Error("프로젝트 파일이 올바르지 않습니다.");
  let p = value as Project;
  // A v1 file is normalized in memory. Frame order and timing are preserved.
  if ((value as { version?: unknown }).version === 1) {
    const old = value as { sequence?: unknown; fps?: unknown };
    if (
      !Array.isArray(old.sequence) ||
      old.sequence.some((id) => typeof id !== "string") ||
      typeof old.fps !== "number" ||
      !Number.isFinite(old.fps) ||
      old.fps < 1 ||
      old.fps > 60
    )
      throw new Error("이전 프로젝트의 프레임 정보가 올바르지 않습니다.");
    const { sequence, fps, ...rest } = value as Record<string, unknown>;
    p = {
      ...rest,
      version: 2,
      activeClipId: "default",
      clips: [
        {
          id: "default",
          name: "Animation",
          frames: old.sequence.map((assetId) => ({
            assetId,
            durationMs: 1000 / (fps as number),
          })),
          fps,
          loop: true,
        },
      ],
    } as Project;
  }
  if (p.version !== 2 || typeof p.name !== "string" || p.name.length > 120)
    throw new Error("지원하지 않는 프로젝트입니다.");
  for (const [v, max] of [
    [p.tileSize, 128],
    [p.mapWidth, 128],
    [p.mapHeight, 128],
  ])
    if (!Number.isInteger(v) || v < 1 || v > max)
      throw new Error("프로젝트 크기 또는 재생 속도가 올바르지 않습니다.");
  if (p.mapWidth * p.tileSize > 8192 || p.mapHeight * p.tileSize > 8192)
    throw new Error("맵은 각 변 8192px 이하여야 합니다.");
  if (
    !Array.isArray(p.layers) ||
    p.layers.length < 1 ||
    p.layers.length > 32 ||
    p.layers.some(
      (l) =>
        !l ||
        typeof l.id !== "string" ||
        typeof l.name !== "string" ||
        typeof l.visible !== "boolean" ||
        typeof l.collider !== "boolean",
    )
  )
    throw new Error("레이어 정보가 올바르지 않습니다.");
  if (new Set(p.layers.map((l) => l.id)).size !== p.layers.length)
    throw new Error("레이어 ID가 중복됩니다.");
  if (
    !Array.isArray(p.placements) ||
    p.placements.length > 20000 ||
    p.placements.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        typeof t.assetId !== "string" ||
        !p.layers.some((l) => l.id === t.layerId) ||
        !Number.isInteger(t.x) ||
        !Number.isInteger(t.y) ||
        t.x < 0 ||
        t.y < 0 ||
        t.x >= p.mapWidth ||
        t.y >= p.mapHeight,
    )
  )
    throw new Error("맵 배치 정보가 올바르지 않습니다.");
  if (
    !Array.isArray(p.clips) ||
    p.clips.length < 1 ||
    p.clips.length > 64 ||
    p.clips.some(
      (c) =>
        !c ||
        typeof c.id !== "string" ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        c.name.length > 120 ||
        typeof c.loop !== "boolean" ||
        typeof c.fps !== "number" ||
        !Number.isFinite(c.fps) ||
        c.fps < 1 ||
        c.fps > 60 ||
        !Array.isArray(c.frames) ||
        c.frames.length > 256 ||
        c.frames.some(
          (f) =>
            !f ||
            typeof f.assetId !== "string" ||
            typeof f.durationMs !== "number" ||
            !Number.isFinite(f.durationMs) ||
            f.durationMs <= 0 ||
            f.durationMs > 60000,
        ),
    ) ||
    new Set(p.clips.map((c) => c.id)).size !== p.clips.length ||
    !p.clips.some((c) => c.id === p.activeClipId)
  )
    throw new Error("프레임 정보가 올바르지 않습니다.");
  return p;
}

export function validatePortable(value: unknown): PortableProject {
  const p = value as PortableProject;
  if (
    !p ||
    p.kind !== "sprite-editor" ||
    !Array.isArray(p.assets) ||
    p.assets.length > 256
  )
    throw new Error("Sprite Editor 프로젝트가 아닙니다.");
  const project = validateProject(p.project);
  if (
    p.assets.some(
      (a) =>
        !a ||
        typeof a.id !== "string" ||
        typeof a.name !== "string" ||
        typeof a.png !== "string" ||
        !a.png.startsWith("data:image/png;base64,"),
    )
  )
    throw new Error("프로젝트의 자산을 읽을 수 없습니다.");
  const ids = new Set(p.assets.map((a) => a.id));
  if (
    ids.size !== p.assets.length ||
    [
      ...project.clips.flatMap((c) => c.frames.map((f) => f.assetId)),
      ...project.placements.map((t) => t.assetId),
    ].some((id) => !ids.has(id))
  )
    throw new Error("프로젝트에서 참조한 자산이 누락됐습니다.");
  orderedAssets(p.assets);
  return { ...p, project };
}

export function orderedAssets<
  T extends { id: string; parentId?: string | null },
>(assets: T[]): T[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const visiting = new Set<string>(),
    done = new Set<string>(),
    result: T[] = [];
  function visit(id: string) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error("자산 버전 참조가 순환합니다.");
    const asset = byId.get(id);
    if (!asset) throw new Error("자산의 원본 버전이 누락됐습니다.");
    visiting.add(id);
    if (asset.parentId) visit(asset.parentId);
    visiting.delete(id);
    done.add(id);
    result.push(asset);
  }
  assets.forEach((a) => visit(a.id));
  return result;
}

export function remapProject(
  project: Project,
  ids: Map<string, string>,
): Project {
  return {
    ...project,
    clips: project.clips.map((c) => ({
      ...c,
      frames: c.frames.map((f) => ({ ...f, assetId: ids.get(f.assetId)! })),
    })),
    placements: project.placements.map((t) => ({
      ...t,
      assetId: ids.get(t.assetId)!,
    })),
  };
}

export function usedAssets(project: Project, assets: Asset[]) {
  const ids = new Set([
    ...project.clips.flatMap((c) => c.frames.map((f) => f.assetId)),
    ...project.placements.map((t) => t.assetId),
  ]);
  return assets.filter((a) => ids.has(a.id));
}

export function activeClip(project: Project): AnimationClip {
  const clip = project.clips.find((c) => c.id === project.activeClipId);
  if (!clip) throw new Error("현재 클립을 찾을 수 없습니다.");
  return clip;
}

export function updateClip(project: Project, clip: AnimationClip): Project {
  return {
    ...project,
    clips: project.clips.map((c) => (c.id === clip.id ? clip : c)),
  };
}

export function adoptClips(project: Project, clips: AnimationClip[]): Project {
  if (!clips.length) throw new Error("추가할 클립이 없습니다.");
  const existing = new Set(project.clips.map((c) => c.id));
  return validateProject({
    ...project,
    clips: [...project.clips, ...clips.filter((c) => !existing.has(c.id))],
    activeClipId: clips[0].id,
  });
}
