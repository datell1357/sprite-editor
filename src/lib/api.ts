import type { AnimationClip, Asset, Capabilities, Job } from "../types";

async function request<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(
    url,
    data === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "요청을 완료하지 못했습니다.");
  return payload as T;
}
export const api = {
  animate: (input: {
    prompt: string;
    size: number;
    referenceId: string;
    state: string;
    frames: number;
    fps: number;
    loop: boolean;
    accessConfirmed: boolean;
  }) =>
    request<Job>("/api/jobs", { kind: "animate", provider: "codex", ...input }),
  importAtlas: (manifest: unknown, png: string) =>
    request<{ assets: Asset[]; clips: AnimationClip[] }>("/api/import-atlas", {
      manifest,
      png,
    }),
  assets: () => request<Asset[]>("/api/assets"),
  jobs: () => request<Job[]>("/api/jobs"),
  status: () => request<Capabilities>("/api/status"),
  import: (name: string, png: string, parentId?: string) =>
    request<Asset>("/api/assets", { name, png, parentId }),
  generate: (
    prompt: string,
    provider: string,
    size: number,
    referenceId?: string,
  ) =>
    request<Job>("/api/jobs", {
      kind: "generate",
      prompt,
      provider,
      size,
      referenceId,
    }),
  snap: (assetId: string, colors: number, pixelSize: number | null) =>
    request<Job>("/api/jobs", { kind: "snap", assetId, colors, pixelSize }),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, {}),
};

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    image.src = url;
  });
}
export function download(filename: string, data: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = data;
  link.click();
}
export function downloadJSON(filename: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function pngData(asset: Asset) {
  const image = await loadImage(asset.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}
