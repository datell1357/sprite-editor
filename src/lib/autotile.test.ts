import { describe, expect, it } from "vitest";
import {
  emptyProject,
  remapProject,
  validatePortable,
  validateProject,
} from "./project";
import {
  resolveAutotiles,
  validAutotile,
  requireTileDimensions,
} from "./autotile";
import type { Project, Asset } from "../types";

function fixture(): Project {
  const p = emptyProject();
  p.layers[0].autotile = {
    defaultAssetId: "inside",
    rules: [
      {
        id: "top",
        assetId: "edge",
        pattern: [-1, 0, -1, -1, 1, -1, -1, -1, -1],
      },
    ],
  };
  p.placements = [
    { id: "a", layerId: "ground", assetId: "paint", x: 1, y: 0 },
    { id: "b", layerId: "ground", assetId: "paint", x: 1, y: 1 },
    { id: "c", layerId: "objects", assetId: "object", x: 0, y: 0 },
  ];
  return p;
}
describe("autotile resolution", () => {
  it("resolves top boundary and updates neighbors after erase without mutating source", () => {
    const p = fixture();
    expect(resolveAutotiles(p).map((t) => t.assetId)).toEqual([
      "edge",
      "inside",
      "object",
    ]);
    const erased = {
      ...p,
      placements: p.placements.filter((t) => t.id !== "a"),
    };
    expect(resolveAutotiles(erased).map((t) => t.assetId)).toEqual([
      "edge",
      "object",
    ]);
    expect(p.placements.map((t) => t.assetId)).toEqual([
      "paint",
      "paint",
      "object",
    ]);
  });
  it("uses first matching rule deterministically and restores manual assets when disabled", () => {
    const p = fixture();
    p.layers[0].autotile!.rules.push({
      id: "all",
      assetId: "last",
      pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1],
    });
    expect(resolveAutotiles(p).map((t) => t.assetId)).toEqual([
      "edge",
      "last",
      "object",
    ]);
    p.layers[0].autotile = undefined;
    expect(resolveAutotiles(p)[0].assetId).toBe("paint");
  });
  it("validates rule states, duplicate IDs and exact tile dimensions", () => {
    expect(
      validAutotile({
        defaultAssetId: "x",
        rules: [{ id: "bad", assetId: "x", pattern: Array(9).fill(2) }],
      }),
    ).toBe(false);
    const p = fixture(),
      rule = p.layers[0].autotile!.rules[0];
    p.layers[0].autotile!.rules.push(rule);
    expect(() => validateProject(p)).toThrow("규칙");
    expect(() =>
      requireTileDimensions(fixture(), [
        { id: "inside", width: 32, height: 32 },
        { id: "edge", width: 64, height: 64 },
      ] as Asset[]),
    ).toThrow("32×32");
  });
  it("includes rule dependencies in portable validation and remaps them on restore", () => {
    const p = fixture(),
      ids = new Map(
        ["paint", "inside", "edge", "object"].map((id) => [id, `new-${id}`]),
      );
    const restored = remapProject(p, ids);
    expect(restored.layers[0].autotile?.defaultAssetId).toBe("new-inside");
    expect(restored.layers[0].autotile?.rules[0].assetId).toBe("new-edge");
    const assets = ["paint", "inside", "object"].map((id) => ({
      id,
      name: id,
      width: 32,
      height: 32,
      png: "data:image/png;base64,AA==",
    }));
    expect(() =>
      validatePortable({ kind: "sprite-editor", project: p, assets }),
    ).toThrow("누락");
    expect(
      validatePortable({
        kind: "sprite-editor",
        project: p,
        assets: [
          ...assets,
          {
            id: "edge",
            name: "edge",
            width: 32,
            height: 32,
            png: "data:image/png;base64,AA==",
          },
        ],
      }).project.layers[0].autotile,
    ).toEqual(p.layers[0].autotile);
  });
});
