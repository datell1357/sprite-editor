import { describe, expect, it } from "vitest";
import { emptyProject } from "./project";
import { fillRegion, paintCell } from "./map";
import type { Placement, Project } from "../types";

const tile = (
  x: number,
  y: number,
  assetId = "wall",
  layerId = "ground",
): Placement => ({ id: `${layerId}:${x}:${y}`, x, y, assetId, layerId });
const map = (placements: Placement[] = []): Project => ({
  ...emptyProject(),
  // Two grid layers keep the original cross-layer fill regression meaningful.
  layers: emptyProject().layers.map((l) => ({ ...l, kind: "tile" })),
  mapWidth: 5,
  mapHeight: 3,
  placements,
});
describe("connected map fill", () => {
  it("fills only the connected empty region and preserves other layers", () => {
    const boundary = [tile(2, 0), tile(2, 1), tile(2, 2)],
      object = tile(0, 0, "chest", "objects");
    const p = map([...boundary, object]);
    const result = fillRegion(p, "ground", 0, 0, "grass");
    expect(result.filter((t) => t.assetId === "grass")).toHaveLength(6);
    expect(
      result.filter((t) => t.assetId === "grass").every((t) => t.x < 2),
    ).toBe(true);
    expect(result).toContain(object);
    expect(result.filter((t) => t.assetId === "wall")).toEqual(boundary);
    expect(p.placements).toHaveLength(4);
  });
  it("replaces four-connected matching cells, not diagonals or another color", () => {
    const p = map([
      tile(0, 0, "water"),
      tile(1, 0, "water"),
      tile(2, 1, "water"),
      tile(0, 1, "sand"),
    ]);
    const result = fillRegion(p, "ground", 0, 0, "ice");
    expect(result.filter((t) => t.assetId === "ice")).toHaveLength(2);
    expect(result.find((t) => t.x === 2 && t.y === 1)?.assetId).toBe("water");
    expect(result.find((t) => t.x === 0 && t.y === 1)?.assetId).toBe("sand");
  });
  it("returns the original snapshot for no-op, hidden layer or invalid coordinates", () => {
    const p = map([tile(0, 0)]);
    expect(fillRegion(p, "ground", 0, 0, "wall")).toBe(p.placements);
    expect(fillRegion(p, "absent", 0, 0, "grass")).toBe(p.placements);
    for (const [x, y] of [
      [-1, 0],
      [5, 0],
      [0, 3],
      [0.5, 0],
    ])
      expect(fillRegion(p, "ground", x, y, "grass")).toBe(p.placements);
    p.layers[0].visible = false;
    expect(fillRegion(p, "ground", 1, 1, "grass")).toBe(p.placements);
  });
  it("handles the largest grid iteratively without wrapping rows", () => {
    const p = { ...map(), mapWidth: 128, mapHeight: 128 };
    let id = 0;
    const result = fillRegion(p, "ground", 127, 127, "grass", () =>
      String(id++),
    );
    expect(result).toHaveLength(16384);
    expect(new Set(result.map((t) => `${t.x}:${t.y}`)).size).toBe(16384);
  });
  it("refuses an over-capacity fill without changing the project", () => {
    const p = {
      ...map(
        Array.from({ length: 4000 }, (_, i) =>
          tile(i % 128, Math.floor(i / 128), "object", "objects"),
        ),
      ),
      mapWidth: 128,
      mapHeight: 128,
    };
    expect(() => fillRegion(p, "ground", 0, 0, "grass")).toThrow("20,000");
    expect(p.placements).toHaveLength(4000);
  });
});
it("cell painting and erasing preserve no-op history and other layers", () => {
  const p = map([tile(0, 0), tile(0, 0, "chest", "objects")]);
  expect(paintCell(p, "ground", 0, 0, "wall")).toBe(p.placements);
  expect(paintCell(p, "ground", 4, 2)).toBe(p.placements);
  const erased = paintCell(p, "ground", 0, 0);
  expect(erased).toEqual([p.placements[1]]);
});
