import fixtureData from "../../test-fixtures/animation-alignment.json";
import { describe, expect, it } from "vitest";
import type { AnimationClip, Asset } from "../types";
import { animationLayout, atlasManifest } from "./animationLayout";
import {
  emptyProject,
  remapProject,
  validatePortable,
  validateProject,
} from "./project";
import { excludeFrame, restoreCandidate } from "./animation";
import { serializeProjectFile } from "./projectFile";

const fixture = fixtureData as {
  assets: Asset[];
  clip: AnimationClip;
  manifest: unknown;
};

describe("shared animation layout", () => {
  it("keeps the legacy bottom-centre padding for mixed odd and even dimensions", () => {
    const assets = [
      { ...fixture.assets[0], width: 49, height: 80 },
      { ...fixture.assets[1], width: 32, height: 41 },
    ];
    const clip = {
      ...fixture.clip,
      pivot: undefined,
      frames: fixture.clip.frames
        .slice(0, 2)
        .map(({ assetId, durationMs }) => ({ assetId, durationMs })),
    };
    const layout = animationLayout(clip, assets);
    expect([layout.width, layout.height, layout.pivotX, layout.pivotY]).toEqual(
      [49, 80, 25, 80],
    );
    expect(layout.frames.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 39 },
    ]);
  });

  it("pads translated frames and emits the shared producer/consumer atlas fixture", () => {
    const before = JSON.stringify(fixture),
      layout = animationLayout(fixture.clip, fixture.assets);
    expect([
      layout.baseWidth,
      layout.baseHeight,
      layout.width,
      layout.height,
      layout.pivotX,
      layout.pivotY,
    ]).toEqual([9, 7, 13, 12, 4, 8]);
    expect(
      layout.frames.map(({ x, y, width, height }) => ({ x, y, width, height })),
    ).toEqual([
      { x: 0, y: 5, width: 5, height: 7 },
      { x: 10, y: 0, width: 3, height: 4 },
      { x: 1, y: 5, width: 9, height: 5 },
    ]);
    expect(atlasManifest(fixture.clip, layout)).toEqual(fixture.manifest);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("moves the common pivot without rescaling or shifting frame pixels", () => {
    const first = animationLayout(fixture.clip, fixture.assets);
    const second = animationLayout(
      { ...fixture.clip, pivot: { x: 1, y: 0 } },
      fixture.assets,
    );
    expect(second.frames).toEqual(first.frames);
    expect([second.pivotX, second.pivotY]).toEqual([11, 3]);
  });

  it("rejects missing sources, invalid offsets and unsafe cell or sheet allocations", () => {
    expect(() => animationLayout(fixture.clip, [])).toThrow("누락");
    for (const offsetX of [NaN, Infinity, -2049, 2049, 1.5])
      expect(() =>
        animationLayout(
          { ...fixture.clip, frames: [{ ...fixture.clip.frames[0], offsetX }] },
          fixture.assets,
        ),
      ).toThrow("위치");
    expect(() =>
      animationLayout(
        { ...fixture.clip, pivot: { x: 2, y: 0 } },
        fixture.assets,
      ),
    ).toThrow("피벗");
    const large = fixture.assets
      .slice(0, 2)
      .map((a) => ({ ...a, width: 2048, height: 2048 }));
    expect(() =>
      animationLayout(
        {
          ...fixture.clip,
          frames: large.map((a, i) => ({
            assetId: a.id,
            durationMs: 100,
            offsetX: i ? 2048 : -2048,
            offsetY: i ? 2048 : -2048,
          })),
        },
        large,
      ),
    ).toThrow("셀");
    const asset = { ...fixture.assets[0], width: 1024, height: 1024 };
    const clip = {
      ...fixture.clip,
      frames: Array.from({ length: 16 }, () => ({
        assetId: asset.id,
        durationMs: 100,
      })),
    };
    expect(
      atlasManifest(clip, animationLayout(clip, [asset])).sheetHeight,
    ).toBe(4096);
    clip.frames.push({ assetId: asset.id, durationMs: 100 });
    expect(() => atlasManifest(clip, animationLayout(clip, [asset]))).toThrow(
      "16메가픽셀",
    );
  });
});

describe("alignment persistence", () => {
  it("keeps per-occurrence offsets through candidates, project export and ID remapping", () => {
    const p = emptyProject();
    p.clips = [fixture.clip];
    p.activeClipId = fixture.clip.id;
    const candidate = excludeFrame(fixture.clip, 1),
      restored = restoreCandidate(candidate, 0);
    expect(candidate.candidates?.[0]).toEqual(fixture.clip.frames[1]);
    expect(restored.frames[2]).toEqual(fixture.clip.frames[1]);
    expect(restored.pivot).toEqual(fixture.clip.pivot);
    const file = {
      kind: "sprite-editor" as const,
      project: p,
      assets: fixture.assets.map((a) => ({
        ...a,
        png: "data:image/png;base64,AA==",
      })),
    };
    const parsed = validatePortable(JSON.parse(serializeProjectFile(file)));
    expect(parsed.project).toEqual(p);
    const ids = new Map(fixture.assets.map((a) => [a.id, `new-${a.id}`]));
    const mapped = remapProject(parsed.project, ids);
    expect(mapped.clips[0].pivot).toEqual(fixture.clip.pivot);
    expect(mapped.clips[0].frames).toEqual(
      fixture.clip.frames.map((f) => ({ ...f, assetId: ids.get(f.assetId) })),
    );
  });

  it("validates candidate translations and pivot metadata before adopting a project", () => {
    const p = emptyProject(),
      clip = p.clips[0];
    for (const pivot of [
      null,
      {},
      { x: NaN, y: 0 },
      { x: 0, y: 1.1 },
      { x: "0.5", y: 1 },
    ])
      expect(() =>
        validateProject({ ...p, clips: [{ ...clip, pivot }] }),
      ).toThrow("프레임");
    for (const offsetX of ["1", false, Infinity, 0.5, 2049])
      expect(() =>
        validateProject({
          ...p,
          clips: [
            {
              ...clip,
              candidates: [{ assetId: "a", durationMs: 100, offsetX }],
            },
          ],
        }),
      ).toThrow("프레임");
  });
});
