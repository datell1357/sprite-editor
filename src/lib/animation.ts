import type { AnimationClip, ClipFrame } from "../types";

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

export function keepCandidate(
  clip: AnimationClip,
  frame: ClipFrame,
): AnimationClip {
  if ((clip.candidates?.length || 0) >= 256)
    throw new Error("후보는 클립당 최대 256개입니다.");
  return { ...clip, candidates: [...(clip.candidates || []), { ...frame }] };
}
export function excludeFrame(
  clip: AnimationClip,
  index: number,
): AnimationClip {
  if (!Number.isInteger(index) || !clip.frames[index])
    throw new Error("프레임을 찾을 수 없습니다.");
  const next = keepCandidate(clip, clip.frames[index]);
  return { ...next, frames: clip.frames.filter((_, i) => i !== index) };
}
export function restoreCandidate(
  clip: AnimationClip,
  index: number,
): AnimationClip {
  if (!Number.isInteger(index) || !clip.candidates?.[index])
    throw new Error("후보를 찾을 수 없습니다.");
  if (clip.frames.length >= 256)
    throw new Error("재생 프레임은 클립당 최대 256개입니다.");
  return {
    ...clip,
    frames: [...clip.frames, { ...clip.candidates[index] }],
    candidates: clip.candidates.filter((_, i) => i !== index),
  };
}
