import { expect, it } from "vitest";
import { emptyProject } from "./project";
import { PROJECT_FILE_MAX_BYTES, serializeProjectFile } from "./projectFile";
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
