import { describe, expect, it } from "vitest";
import {
  orderedAssets,
  emptyProject,
  remapProject,
  validatePortable,
  validateProject,
} from "./project";

describe("project import", () => {
  it("restores parent revisions before children and rejects cyclic lineage", () => {
    const assets = [
      { id: "edit", parentId: "source" },
      { id: "source", parentId: null },
    ];
    expect(orderedAssets(assets).map((a) => a.id)).toEqual(["source", "edit"]);
    expect(() =>
      orderedAssets([
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" },
      ]),
    ).toThrow("순환");
    expect(() => orderedAssets([{ id: "a", parentId: "absent" }])).toThrow(
      "누락",
    );
  });
  it("rejects dangling references before importing assets", () => {
    expect(() =>
      validatePortable({
        kind: "sprite-editor",
        project: { ...emptyProject(), sequence: ["missing"] },
        assets: [],
      }),
    ).toThrow("누락");
  });
  it("rejects impossible canvas allocations and placement coordinates", () => {
    expect(() =>
      validateProject({ ...emptyProject(), tileSize: 128, mapWidth: 128 }),
    ).toThrow();
    expect(() =>
      validateProject({
        ...emptyProject(),
        placements: [{ id: "a", assetId: "a", x: -1, y: 0, layerId: "ground" }],
      }),
    ).toThrow();
  });
  it("remaps frame and map references consistently", () => {
    const p = {
      ...emptyProject(),
      sequence: ["old"],
      placements: [{ id: "p", assetId: "old", layerId: "ground", x: 0, y: 0 }],
    };
    const mapped = remapProject(p, new Map([["old", "new"]]));
    expect(mapped.sequence).toEqual(["new"]);
    expect(mapped.placements[0].assetId).toBe("new");
    expect(p.sequence).toEqual(["old"]);
  });
});
