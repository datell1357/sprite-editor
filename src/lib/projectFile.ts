import type { Asset, PortableProject, Project } from "../types";
import { MAX_PROJECT_ASSETS, validatePortable } from "./project";
import { pngData } from "./api";

export const PROJECT_FILE_MAX_BYTES = 64 * 1024 * 1024;

export async function serializeProjectAssets(
  project: Project,
  assets: Asset[],
  encode: (asset: Asset) => Promise<string> = pngData,
): Promise<string> {
  if (assets.length > MAX_PROJECT_ASSETS)
    throw new Error(
      `한 프로젝트에 최대 ${MAX_PROJECT_ASSETS}개 자산을 내보낼 수 있습니다.`,
    );
  const embedded = [];
  let pngBytes = 0;
  for (const asset of assets) {
    const png = await encode(asset);
    // Data URLs are ASCII; stop before retaining further images once these
    // alone exceed the file limit. Final JSON gets the exact UTF-8 check below.
    pngBytes += png.length;
    if (pngBytes > PROJECT_FILE_MAX_BYTES)
      throw new Error(
        "프로젝트는 64MB 이하여야 합니다. 큰 이미지는 별도 PNG로 내보내 주세요.",
      );
    embedded.push({ ...asset, png });
  }
  return serializeProjectFile({
    kind: "sprite-editor",
    project,
    assets: embedded,
  });
}

export function serializeProjectFile(value: PortableProject): string {
  const portable = validatePortable(value);
  const text = JSON.stringify(portable, null, 2);
  if (new TextEncoder().encode(text).byteLength > PROJECT_FILE_MAX_BYTES)
    throw new Error(
      "프로젝트는 64MB 이하여야 합니다. 큰 이미지는 별도 PNG로 내보내 주세요.",
    );
  return text;
}
