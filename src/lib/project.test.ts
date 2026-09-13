import { describe, expect, it } from "vitest";
import {
  orderedAssets,
  adoptClips,
  emptyProject,
  remapProject,
  validatePortable,
  validateProject,
} from "./project";

describe("project import", () => {
  it("adopts generated clips without overwriting existing clips or duplicating results", () => {
    const p = emptyProject(),
      generated = { ...p.clips[0], id: "generated", name: "walk" };
    const next = adoptClips(p, [generated]);
    expect(next.clips).toHaveLength(2);
    expect(next.activeClipId).toBe("generated");
    expect(adoptClips(next, [generated]).clips).toHaveLength(2);
    expect(p.clips).toHaveLength(1);
    expect(next.placements).toBe(p.placements);
    expect(() => adoptClips(p, [])).toThrow();
  });
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
        project: {
          ...emptyProject(),
          clips: [
            {
              id: "default",
              name: "idle",
              fps: 8,
              loop: true,
              frames: [{ assetId: "missing", durationMs: 125 }],
            },
          ],
        },
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
      clips: [
        {
          id: "default",
          name: "idle",
          fps: 8,
          loop: false,
          frames: [{ assetId: "old", durationMs: 375 }],
        },
      ],
      placements: [{ id: "p", assetId: "old", layerId: "ground", x: 0, y: 0 }],
    };
    const mapped = remapProject(p, new Map([["old", "new"]]));
    expect(mapped.clips[0].frames).toEqual([
      { assetId: "new", durationMs: 375 },
    ]);
    expect(mapped.clips[0].loop).toBe(false);
    expect(mapped.placements[0].assetId).toBe("new");
    expect(p.clips[0].frames[0].assetId).toBe("old");
  });
  it("migrates v1 without changing frame order, timing or original input", () => {
    const old = {
      ...emptyProject(),
      version: 1,
      sequence: ["one", "one", "two"],
      fps: 4,
    };
    const migrated = validateProject(old);
    expect(migrated.version).toBe(2);
    expect(migrated.clips[0].frames).toEqual(
      ["one", "one", "two"].map((assetId) => ({ assetId, durationMs: 250 })),
    );
    expect(old.version).toBe(1);
    expect(
      validatePortable({
        kind: "sprite-editor",
        project: { ...old, sequence: [] },
        assets: [],
      }).project.version,
    ).toBe(2);
  });
  it("rejects invalid durations and missing active clips", () => {
    const p = emptyProject();
    expect(() => validateProject({ ...p, activeClipId: "absent" })).toThrow();
    for (const durationMs of [0, -1, Infinity, NaN, 60001]) {
      expect(() =>
        validateProject({
          ...p,
          clips: [{ ...p.clips[0], frames: [{ assetId: "a", durationMs }] }],
        }),
      ).toThrow();
    }
  });
});
