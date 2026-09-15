import { describe, expect, it } from "vitest";
import type { Asset, MapObject } from "../types";
import {
  emptyProject,
  remapProject,
  usedAssets,
  validatePortable,
  validateProject,
} from "./project";
import { serializeProjectFile } from "./projectFile";
import { fillRegion, paintCell } from "./map";
import {
  hitObject,
  mapScene,
  objectBounds,
  objectPosition,
  placeObject,
  updateObject,
} from "./mapObjects";

const asset: Asset = {
  id: "character",
  name: "Character",
  width: 48,
  height: 80,
  parentId: null,
  createdAt: "",
  url: "/character.png",
};
const object = (changes: Partial<MapObject> = {}): MapObject => ({
  id: "one",
  assetId: asset.id,
  layerId: "objects",
  x: 100,
  y: 100,
  pivotX: 0.5,
  pivotY: 1,
  z: 0,
  collider: false,
  ...changes,
});

describe("map object geometry", () => {
  it("uses native dimensions and the same pixel pivot after replacing a revision", () => {
    const o = object();
    expect(objectBounds(o, asset)).toEqual({
      x: 76,
      y: 20,
      width: 48,
      height: 80,
    });
    expect(objectBounds(o, { width: 96, height: 160 })).toEqual({
      x: 52,
      y: -60,
      width: 96,
      height: 160,
    });
    expect(
      objectBounds(object({ pivotX: 0.25, pivotY: 0.5 }), {
        width: 45,
        height: 81,
      }),
    ).toEqual({ x: 89, y: 59, width: 45, height: 81 });
  });

  it("shares stable z order, layer visibility and bounds between drawing and picking", () => {
    const p = emptyProject();
    p.objects = [
      object({ id: "front", z: 5 }),
      object({ id: "back", z: -1 }),
      object({ id: "front-last", z: 5 }),
    ];
    p.placements = [
      { id: "tile", assetId: asset.id, layerId: "ground", x: 2, y: 2 },
    ];
    const scene = mapScene(p, [asset]);
    expect(scene.draws.map((d) => d.id)).toEqual([
      "tile",
      "back",
      "front",
      "front-last",
    ]);
    expect(scene.draws[0]).toMatchObject({
      x: 56,
      y: 16,
      width: 48,
      height: 80,
    });
    expect(hitObject(scene.draws, "objects", 80, 40)?.id).toBe("front-last");
    expect(hitObject(scene.draws, "ground", 80, 40)).toBeUndefined();
    expect(hitObject(scene.draws, "objects", 124, 100)).toBeUndefined();
    expect(p.objects[0].id).toBe("front");
    p.layers[1].visible = false;
    expect(mapScene(p, [asset]).draws.map((d) => d.id)).toEqual(["tile"]);
    expect(
      hitObject(mapScene(p, [asset]).draws, "objects", 80, 40),
    ).toBeUndefined();
    expect(mapScene(p, []).missing).toEqual([asset.id]);
  });

  it("allows overlapping objects and limits rounded or snapped pivots to map bounds", () => {
    const p = emptyProject();
    expect(objectPosition(p, 109.4, 111.6, false)).toEqual({ x: 109, y: 112 });
    expect(objectPosition(p, 109, 113, true)).toEqual({ x: 96, y: 128 });
    expect(objectPosition(p, -90, 2000, true)).toEqual({ x: 0, y: 512 });
    const one = placeObject(p, "objects", asset.id, 100, 100);
    const two = placeObject(one, "objects", asset.id, 100, 100);
    expect(two.objects).toHaveLength(2);
    expect(two.objects[0].id).not.toBe(two.objects[1].id);
    expect(p.objects).toEqual([]);
    expect(updateObject(two, { ...two.objects[0] })).toBe(two);
    expect(updateObject(two, object({ id: "missing" }))).toBe(two);
    const moved = updateObject(two, { ...two.objects[0], x: 150 });
    expect(moved.objects[0].x).toBe(150);
    expect(two.objects[0].x).toBe(100);
    expect(moved.objects[1]).toBe(two.objects[1]);
  });

  it("keeps tile tools and object placement within their own visible layer kinds", () => {
    const p = emptyProject();
    p.objects = [object()];
    expect(fillRegion(p, "objects", 0, 0, asset.id)).toBe(p.placements);
    expect(paintCell(p, "objects", 0, 0, asset.id)).toBe(p.placements);
    expect(placeObject(p, "ground", asset.id, 10, 10)).toBe(p);
    const filled = {
      ...p,
      placements: fillRegion(p, "ground", 0, 0, asset.id),
    };
    expect(filled.placements).toHaveLength(384);
    expect(filled.objects).toBe(p.objects);
    p.layers[1].visible = false;
    expect(placeObject(p, "objects", asset.id, 10, 10)).toBe(p);
  });

  it("shares the 20,000 limit across tile and object edits without partial changes", () => {
    const p = emptyProject();
    p.objects = Array.from({ length: 20000 }, (_, i) =>
      object({ id: String(i) }),
    );
    expect(() => placeObject(p, "objects", asset.id, 10, 10)).toThrow("20,000");
    expect(() => paintCell(p, "ground", 0, 0, asset.id)).toThrow("20,000");
    expect(() => fillRegion(p, "ground", 0, 0, asset.id)).toThrow("20,000");
    expect(p.objects).toHaveLength(20000);
    expect(p.placements).toEqual([]);
    expect(() =>
      validateProject({
        ...p,
        placements: [
          { id: "t", assetId: asset.id, layerId: "ground", x: 0, y: 0 },
        ],
      }),
    ).toThrow("객체");
  });
});

describe("object project persistence", () => {
  it("migrates all v2 layers as tiles, preserving original coordinates and native rendering", () => {
    const legacy = {
      ...emptyProject(),
      version: 2,
      layers: [
        { id: "ground", name: "Ground", visible: true, collider: false },
        { id: "objects", name: "Objects", visible: true, collider: true },
      ],
      placements: [
        { id: "old", assetId: asset.id, layerId: "objects", x: 2, y: 2 },
      ],
    };
    const before = JSON.stringify(legacy),
      migrated = validateProject(legacy);
    expect(migrated.version).toBe(3);
    expect(migrated.layers.map((l) => l.kind)).toEqual(["tile", "tile"]);
    expect(migrated.layers[1].collider).toBe(true);
    expect(migrated.objects).toEqual([]);
    expect(migrated.placements).toEqual(legacy.placements);
    expect(mapScene(migrated, [asset]).draws[0]).toMatchObject({
      kind: "tile",
      x: 56,
      y: 16,
      width: 48,
      height: 80,
    });
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it("roundtrips object-only assets, pivots and collision metadata and remaps their IDs", () => {
    const p = emptyProject();
    p.objects = [object({ pivotX: 0.25, pivotY: 0.75, z: 2, collider: true })];
    const portable = {
      kind: "sprite-editor" as const,
      project: p,
      assets: [{ ...asset, png: "data:image/png;base64,AA==" }],
    };
    const restored = validatePortable(
      JSON.parse(serializeProjectFile(portable)),
    );
    expect(restored.project).toEqual(p);
    expect(usedAssets(p, [asset])).toEqual([asset]);
    expect(
      remapProject(restored.project, new Map([[asset.id, "restored"]])).objects,
    ).toEqual([
      object({
        assetId: "restored",
        pivotX: 0.25,
        pivotY: 0.75,
        z: 2,
        collider: true,
      }),
    ]);
    expect(() => validatePortable({ ...portable, assets: [] })).toThrow("누락");
  });

  it("rejects mixed layer kinds, nonfinite pivots, invalid coordinates and duplicate objects", () => {
    const p = emptyProject();
    for (const changes of [
      { layerId: "ground" },
      { layerId: "absent" },
      { x: -1 },
      { y: 513 },
      { x: 1.5 },
      { pivotX: NaN },
      { pivotY: Infinity },
      { pivotX: -0.1 },
      { pivotY: 1.01 },
      { z: 0.5 },
      { z: 10001 },
      { id: "" },
    ])
      expect(() =>
        validateProject({ ...p, objects: [object(changes)] }),
      ).toThrow("객체");
    expect(() => validateProject({ ...p, objects: undefined })).toThrow("객체");
    expect(() =>
      validateProject({ ...p, objects: [object(), object()] }),
    ).toThrow("객체");
    expect(() =>
      validateProject({
        ...p,
        placements: [
          { id: "bad", assetId: asset.id, layerId: "objects", x: 0, y: 0 },
        ],
      }),
    ).toThrow("맵 배치");
    expect(() =>
      validateProject({ ...p, layers: [{ ...p.layers[0], kind: "bad" }] }),
    ).toThrow("레이어");
    expect(() =>
      validateProject({
        ...p,
        layers: p.layers.map((l) =>
          l.kind === "object"
            ? { ...l, autotile: { defaultAssetId: asset.id, rules: [] } }
            : l,
        ),
      }),
    ).toThrow("오토타일");
    expect(
      validateProject({
        ...p,
        objects: [object({ x: 768, y: 512, pivotX: 1, pivotY: 1 })],
      }).objects[0].x,
    ).toBe(768);
  });
});
