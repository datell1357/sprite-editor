import type { PortableProject } from "../types";
import { validatePortable } from "./project";

export const PROJECT_FILE_MAX_BYTES = 64 * 1024 * 1024;

export function serializeProjectFile(value: PortableProject): string {
  const portable = validatePortable(value);
  const text = JSON.stringify(portable, null, 2);
  if (new TextEncoder().encode(text).byteLength > PROJECT_FILE_MAX_BYTES)
    throw new Error(
      "프로젝트는 64MB 이하여야 합니다. 큰 이미지는 별도 PNG로 내보내 주세요.",
    );
  return text;
}
