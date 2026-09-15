import { expect, it, vi } from "vitest";
import { emptyProject, MAX_PROJECT_ASSETS } from "./project";
import {
  PROJECT_FILE_MAX_BYTES,
  serializeProjectFile,
  serializeProjectAssets,
} from "./projectFile";
import type { PortableProject } from "../types";

function fixture(): PortableProject {
  return {
    kind: "sprite-editor",
    project: emptyProject(),
    assets: [
      {
        id: "a",
        name: "한글 자산",
        width: 1,
        height: 1,
        url: "/a",
        parentId: null,
        createdAt: "",
        png: "data:image/png;base64,AA==",
      },
    ],
  };
}

it("serializes a validated project without changing its names or frame timing", () => {
  const file = fixture();
  file.project.clips[0].frames = [{ assetId: "a", durationMs: 375 }];
  expect(JSON.parse(serializeProjectFile(file))).toEqual(file);
});

it("refuses an export that its importer would reject for dangling assets", () => {
  const file = fixture();
  file.project.clips[0].frames = [{ assetId: "missing", durationMs: 375 }];
  expect(() => serializeProjectFile(file)).toThrow("누락");
});

it("applies the import byte limit to UTF-8 serialized JSON including metadata", () => {
  const file = fixture();
  // String length is below 64 MiB, but its UTF-8 representation is above it.
  file.assets[0].name = "가".repeat(Math.ceil(PROJECT_FILE_MAX_BYTES / 3));
  expect(() => serializeProjectFile(file)).toThrow("64MB");
});

it("stops encoding further assets when accumulated PNGs already exceed the backup budget", async () => {
  const file = fixture();
  const assets = Array.from({ length: 20 }, (_, i) => ({
    ...file.assets[0],
    id: `asset-${i}`,
  }));
  const encode = vi.fn(
    async () => "data:image/png;base64," + "A".repeat(10 * 1024 * 1024),
  );
  await expect(
    serializeProjectAssets(file.project, assets, encode),
  ).rejects.toThrow("64MB");
  expect(encode).toHaveBeenCalledTimes(7);
  expect(assets).toHaveLength(20);
});

it("validates asset capacity before decoding and preserves the full portable contract", async () => {
  const file = fixture(),
    encode = vi.fn(async () => file.assets[0].png);
  const excess = Array.from({ length: MAX_PROJECT_ASSETS + 1 }, (_, i) => ({
    ...file.assets[0],
    id: `asset-${i}`,
  }));
  await expect(
    serializeProjectAssets(file.project, excess, encode),
  ).rejects.toThrow("2048");
  expect(encode).not.toHaveBeenCalled();
  const text = await serializeProjectAssets(file.project, file.assets, encode);
  expect(JSON.parse(text)).toEqual(file);
});
