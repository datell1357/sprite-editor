import type { ClipFrame } from "../types";

export function frameAtElapsed(
  frames: ClipFrame[],
  elapsedMs: number,
  loop: boolean,
) {
  if (!frames.length) return { index: 0, ended: true };
  const duration = frames.reduce((sum, f) => sum + f.durationMs, 0);
  if (!loop && elapsedMs >= duration)
    return { index: frames.length - 1, ended: true };
  let time = Math.max(0, elapsedMs) % duration;
  for (let i = 0; i < frames.length; i++) {
    if (time < frames[i].durationMs) return { index: i, ended: false };
    time -= frames[i].durationMs;
  }
  return { index: frames.length - 1, ended: false };
}
