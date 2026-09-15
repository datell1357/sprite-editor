import { describe, expect, it } from "vitest";
import fixture from "../../test-fixtures/animation-batch.json";
import {
  animationBatch,
  motionStates,
  type AnimationBatchRequest,
} from "./animationBatch";
import { directionLabels } from "./directions";
import {
  adoptClips,
  emptyProject,
  MAX_PROJECT_CLIPS,
  MAX_PROJECT_ASSETS,
  validatePortable,
} from "./project";
import { serializeProjectFile } from "./projectFile";

const request = fixture as Extract<AnimationBatchRequest, { anchors: unknown }>;

describe("multi-motion request contract", () => {
  it("emits the request consumed by the API without flattening distinct motion settings", () => {
    const before = JSON.stringify(request);
    expect(animationBatch(request)).toEqual(fixture);
    expect(JSON.stringify(request)).toBe(before);
    const normalized = animationBatch({
      ...request,
      motions: request.motions.map((m) => ({
        ...m,
        prompt: `  ${m.prompt}  `,
      })),
    });
    expect(normalized.motions).toEqual(request.motions);
    const single = animationBatch({
      referenceId: "original-facing",
      size: 32,
      accessConfirmed: true,
      motions: request.motions,
    });
    expect(single).not.toHaveProperty("anchors");
    expect(single.referenceId).toBe("original-facing");
  });

  it("rejects incomplete, duplicate and unconfirmed multi-motion requests", () => {
    for (const motions of [
      [],
      [request.motions[0], request.motions[0]],
      [{ ...request.motions[0], prompt: " " }],
      [{ ...request.motions[0], frames: 1.5 }],
      [{ ...request.motions[0], fps: 0 }],
    ])
      expect(() => animationBatch({ ...request, motions })).toThrow();
    expect(() =>
      animationBatch({ ...request, accessConfirmed: false }),
    ).toThrow("이용 권한");
    expect(() => animationBatch({ ...request, anchors: [] })).toThrow("기준");
    expect(() =>
      animationBatch({
        ...request,
        anchors: [fixture.anchors[0], fixture.anchors[0]],
      }),
    ).toThrow("기준");
    expect(() =>
      animationBatch({
        ...request,
        anchors: [{ direction: "side", assetId: "a" }],
      }),
    ).toThrow("기준");
  });

  it("supports all five motions and eight directions with both variants in one portable project", () => {
    const full = animationBatch({
      size: 32,
      accessConfirmed: true,
      anchors: Object.keys(directionLabels).map((direction) => ({
        direction,
        assetId: direction,
      })),
      motions: motionStates.map((state) => ({
        ...request.motions[0],
        state,
        frames: 16,
      })),
    });
    const clips = full.anchors!.flatMap((a) =>
      full.motions.flatMap((m) =>
        (["plain", "pixel-unfake"] as const).map((variant) => ({
          id: `${a.direction}-${m.state}-${variant}`,
          name: `${a.direction}_${m.state}`,
          variant,
          fps: m.fps,
          loop: m.loop,
          frames: Array.from({ length: m.frames }, (_, i) => ({
            assetId: `${a.direction}-${m.state}-${variant}-${i}`,
            durationMs: 1000 / m.fps,
          })),
        })),
      ),
    );
    expect(clips).toHaveLength(80);
    const p = emptyProject(),
      adopted = adoptClips(p, clips);
    const file = {
      kind: "sprite-editor" as const,
      project: adopted,
      assets: clips.flatMap((clip) =>
        clip.frames.map((frame) => ({
          id: frame.assetId,
          name: frame.assetId,
          width: 32,
          height: 32,
          url: "/a.png",
          parentId:
            clip.variant === "plain"
              ? null
              : frame.assetId.replace("-pixel-unfake-", "-plain-"),
          createdAt: "",
          png: "data:image/png;base64,AA==",
        })),
      ),
    };
    expect(file.assets).toHaveLength(1280);
    expect(
      validatePortable(JSON.parse(serializeProjectFile(file))).project.clips,
    ).toEqual(adopted.clips);
    const maxAssets = {
      ...file,
      assets: [
        ...file.assets,
        ...Array.from(
          { length: MAX_PROJECT_ASSETS - file.assets.length },
          (_, i) => ({ ...file.assets[0], id: `extra-${i}` }),
        ),
      ],
    };
    expect(validatePortable(maxAssets).assets).toHaveLength(MAX_PROJECT_ASSETS);
    expect(() =>
      validatePortable({
        ...maxAssets,
        assets: [...maxAssets.assets, { ...file.assets[0], id: "too-many" }],
      }),
    ).toThrow();
    expect(adoptClips(adopted, clips).clips).toHaveLength(81);
    const fullProject = adoptClips(
      p,
      Array.from({ length: MAX_PROJECT_CLIPS - 1 }, (_, i) => ({
        ...clips[0],
        id: `clip-${i}`,
      })),
    );
    expect(fullProject.clips).toHaveLength(MAX_PROJECT_CLIPS);
    expect(() => adoptClips(fullProject, [clips[0]])).toThrow();
  });
});
