import type { AnimationClip, Asset } from "../types";

export const DEFAULT_CLIP_PIVOT = { x: 0.5, y: 1 };
export const MAX_FRAME_OFFSET = 2048;

export function validPivot(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const p = value as { x: number; y: number };
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}

export function validFrameOffset(value: unknown) {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      Math.abs(value) <= MAX_FRAME_OFFSET)
  );
}

/** Retain legacy bottom-centre placement, adding padding instead of clipping translations. */
export function animationLayout(clip: AnimationClip, assets: Asset[]) {
  if (!clip.frames.length) throw new Error("프레임을 먼저 추가해 주세요.");
  const byId = new Map(assets.map((a) => [a.id, a]));
  const sources = clip.frames.map((f) => {
    const asset = byId.get(f.assetId);
    if (!asset) throw new Error("프레임 자산이 누락됐습니다.");
    if (
      ![asset.width, asset.height].every(
        (v) => Number.isInteger(v) && v >= 1 && v <= 2048,
      )
    )
      throw new Error("프레임 이미지 크기가 올바르지 않습니다.");
    if (!validFrameOffset(f.offsetX) || !validFrameOffset(f.offsetY))
      throw new Error("프레임 위치는 -2048~2048px 정수여야 합니다.");
    return asset;
  });
  const pivot = clip.pivot ?? DEFAULT_CLIP_PIVOT;
  if (!validPivot(pivot)) throw new Error("클립 피벗은 0~100%여야 합니다.");
  const baseWidth = Math.max(...sources.map((a) => a.width)),
    baseHeight = Math.max(...sources.map((a) => a.height));
  const raw = sources.map((asset, i) => ({
    asset,
    x:
      Math.floor((baseWidth - asset.width) / 2) + (clip.frames[i].offsetX ?? 0),
    y: baseHeight - asset.height + (clip.frames[i].offsetY ?? 0),
    width: asset.width,
    height: asset.height,
  }));
  const left = Math.min(0, ...raw.map((f) => f.x)),
    top = Math.min(0, ...raw.map((f) => f.y));
  const width = Math.max(baseWidth, ...raw.map((f) => f.x + f.width)) - left;
  const height = Math.max(baseHeight, ...raw.map((f) => f.y + f.height)) - top;
  if (width > 8192 || height > 8192 || width * height > 16_777_216)
    throw new Error(
      "정렬된 셀이 너무 큽니다. 프레임 위치나 크기를 줄여 주세요.",
    );
  return {
    baseWidth,
    baseHeight,
    width,
    height,
    pivotX: Math.round(baseWidth * pivot.x) - left,
    pivotY: Math.round(baseHeight * pivot.y) - top,
    frames: raw.map((f) => ({ ...f, x: f.x - left, y: f.y - top })),
  };
}

export type AnimationLayout = ReturnType<typeof animationLayout>;

export function atlasManifest(clip: AnimationClip, layout: AnimationLayout) {
  const { width, height } = layout;
  const columns = Math.min(
    clip.frames.length,
    Math.max(1, Math.floor(4096 / width)),
  );
  const rows = Math.ceil(clip.frames.length / columns);
  const sheetWidth = columns * width,
    sheetHeight = rows * height;
  if (
    sheetWidth > 8192 ||
    sheetHeight > 8192 ||
    sheetWidth * sheetHeight > 16_777_216
  )
    throw new Error(
      "아틀라스는 최대 8192px, 총 16메가픽셀이어야 합니다. 프레임 수나 위치를 줄여 주세요.",
    );
  return {
    version: 2,
    image: "sprite-atlas.png",
    name: clip.name,
    fps: clip.fps,
    loop: clip.loop,
    variant: clip.variant,
    sheetWidth,
    sheetHeight,
    pivot: { x: layout.pivotX / width, y: layout.pivotY / height },
    sourcePivot: { ...(clip.pivot ?? DEFAULT_CLIP_PIVOT) },
    frames: layout.frames.map((f, i) => {
      const x = (i % columns) * width,
        y = Math.floor(i / columns) * height;
      return {
        x,
        y,
        w: width,
        h: height,
        assetId: f.asset.id,
        duration: clip.frames[i].durationMs / 1000,
        offsetX: clip.frames[i].offsetX ?? 0,
        offsetY: clip.frames[i].offsetY ?? 0,
        sourceRect: { x: x + f.x, y: y + f.y, w: f.width, h: f.height },
      };
    }),
  };
}
