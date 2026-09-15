import { directionLabels } from "./directions";

export const motionStates = ["idle", "walk", "run", "attack", "jump"] as const;
export type MotionState = (typeof motionStates)[number];
export interface AnimationMotion {
  state: MotionState;
  prompt: string;
  frames: number;
  fps: number;
  loop: boolean;
}
export type AnimationTarget =
  | { referenceId: string; anchors?: never }
  | { anchors: { direction: string; assetId: string }[]; referenceId?: never };
export type AnimationBatchRequest = AnimationTarget & {
  size: number;
  accessConfirmed: boolean;
  motions: AnimationMotion[];
};

export function animationBatch(
  input: AnimationBatchRequest,
): AnimationBatchRequest {
  if (input.accessConfirmed !== true)
    throw new Error("GPT 이미지 생성 이용 권한을 확인해 주세요.");
  if (![16, 32, 64, 128].includes(input.size))
    throw new Error("목표 크기가 올바르지 않습니다.");
  if (
    !Array.isArray(input.motions) ||
    input.motions.length < 1 ||
    input.motions.length > 5
  )
    throw new Error("동작은 1~5개를 선택해 주세요.");
  const motions = input.motions.map((m) => {
    if (
      !motionStates.includes(m.state) ||
      !m.prompt.trim() ||
      m.prompt.trim().length > 4000 ||
      !Number.isInteger(m.frames) ||
      m.frames < 2 ||
      m.frames > 16 ||
      !Number.isInteger(m.fps) ||
      m.fps < 1 ||
      m.fps > 60 ||
      typeof m.loop !== "boolean"
    )
      throw new Error(
        "각 동작의 설명·프레임 수·FPS·반복 설정을 확인해 주세요.",
      );
    return {
      state: m.state,
      prompt: m.prompt.trim(),
      frames: m.frames,
      fps: m.fps,
      loop: m.loop,
    };
  });
  if (new Set(motions.map((m) => m.state)).size !== motions.length)
    throw new Error("동작 상태가 중복됩니다.");
  const common = { size: input.size, accessConfirmed: true, motions };
  if (input.anchors !== undefined) {
    if (
      input.referenceId !== undefined ||
      input.anchors.length < 1 ||
      input.anchors.length > 8 ||
      input.anchors.some(
        (a) => !Object.hasOwn(directionLabels, a.direction) || !a.assetId,
      ) ||
      new Set(input.anchors.map((a) => a.direction)).size !==
        input.anchors.length
    )
      throw new Error("확인한 방향별 기준을 1~8개 지정해 주세요.");
    return {
      ...common,
      anchors: input.anchors.map((a) => ({
        direction: a.direction,
        assetId: a.assetId,
      })),
    };
  }
  if (!input.referenceId) throw new Error("기준 자산을 선택해 주세요.");
  return { ...common, referenceId: input.referenceId };
}
