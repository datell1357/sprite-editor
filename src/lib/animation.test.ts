import { expect, it } from "vitest";
import {
  frameAtElapsed,
  keepCandidate,
  excludeFrame,
  restoreCandidate,
} from "./animation";
import {
  emptyProject,
  remapProject,
  validatePortable,
  validateProject,
  usedAssets,
} from "./project";
import type { Asset } from "../types";
const frames = [
  { assetId: "a", durationMs: 125 },
  { assetId: "b", durationMs: 375 },
];
it("preserves unequal holds and loops exactly at the total duration", () => {
  expect(frameAtElapsed(frames, 124, true)).toEqual({ index: 0, ended: false });
  expect(frameAtElapsed(frames, 125, true)).toEqual({ index: 1, ended: false });
  expect(frameAtElapsed(frames, 499, true)).toEqual({ index: 1, ended: false });
  expect(frameAtElapsed(frames, 1000, true)).toEqual({
    index: 0,
    ended: false,
  });
});
it("holds the last frame when a one-shot ends, including a throttled tab", () => {
  expect(frameAtElapsed(frames, 500, false)).toEqual({ index: 1, ended: true });
  expect(frameAtElapsed(frames, 60000, false)).toEqual({
    index: 1,
    ended: true,
  });
  expect(frameAtElapsed([], 10, false)).toEqual({ index: 0, ended: true });
});
it("moves an occurrence to candidates and restores its duration without altering originals", () => {
  const clip = {
    ...emptyProject().clips[0],
    frames: [frames[0], { assetId: "a", durationMs: 375 }],
  };
  const excluded = excludeFrame(clip, 1);
  expect(excluded.frames).toEqual([frames[0]]);
  expect(excluded.candidates).toEqual([{ assetId: "a", durationMs: 375 }]);
  const restored = restoreCandidate(excluded, 0);
  expect(restored.frames).toEqual(clip.frames);
  expect(restored.candidates).toEqual([]);
  expect(clip.candidates).toBeUndefined();
});
it("retains a candidate-only asset in project validation and ID remapping", () => {
  const p = emptyProject();
  p.clips[0] = keepCandidate(p.clips[0], {
    assetId: "candidate",
    durationMs: 250,
  });
  expect(() =>
    validatePortable({ kind: "sprite-editor", project: p, assets: [] }),
  ).toThrow("누락");
  const metadata = {
    id: "candidate",
    name: "candidate",
    png: "data:image/png;base64,AA==",
  };
  expect(
    validatePortable({ kind: "sprite-editor", project: p, assets: [metadata] })
      .project.clips[0].candidates,
  ).toHaveLength(1);
  expect(
    remapProject(p, new Map([["candidate", "new"]])).clips[0].candidates?.[0],
  ).toEqual({ assetId: "new", durationMs: 250 });
  expect(usedAssets(p, [metadata as unknown as Asset])).toHaveLength(1);
});
it("rejects full pools, full sequences and invalid candidates without losing frames", () => {
  const clip = {
    ...emptyProject().clips[0],
    frames: [frames[0]],
    candidates: Array.from({ length: 256 }, () => frames[1]),
  };
  expect(() => excludeFrame(clip, 0)).toThrow("256");
  expect(clip.frames).toHaveLength(1);
  expect(() =>
    restoreCandidate(
      { ...clip, frames: Array.from({ length: 256 }, () => frames[0]) },
      0,
    ),
  ).toThrow("256");
  expect(() => restoreCandidate(clip, -1)).toThrow();
  for (const candidates of [
    "invalid",
    [{ assetId: "a", durationMs: 0 }],
    Array.from({ length: 257 }, () => frames[0]),
  ]) {
    const p = emptyProject();
    expect(() =>
      validateProject({ ...p, clips: [{ ...p.clips[0], candidates }] }),
    ).toThrow();
  }
});
