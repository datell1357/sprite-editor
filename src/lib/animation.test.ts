import { expect, it } from "vitest";
import { frameAtElapsed } from "./animation";
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
