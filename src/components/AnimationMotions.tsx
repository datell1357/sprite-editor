import { useRef } from "react";
import {
  motionStates,
  type AnimationMotion,
  type MotionState,
} from "../lib/animationBatch";

export function AnimationMotions({
  motions,
  onChange,
}: {
  motions: AnimationMotion[];
  onChange: (motions: AnimationMotion[]) => void;
}) {
  const saved = useRef(new Map<MotionState, AnimationMotion>());
  function change(state: MotionState, values: Partial<AnimationMotion>) {
    onChange(motions.map((m) => (m.state === state ? { ...m, ...values } : m)));
  }
  return (
    <div className="animation-motions">
      <h3>생성할 동작</h3>
      <div className="motion-choices">
        {motionStates.map((state) => (
          <label className="check-field" key={state}>
            <input
              type="checkbox"
              checked={motions.some((m) => m.state === state)}
              onChange={(e) => {
                const current = motions.find((m) => m.state === state);
                if (current) saved.current.set(state, current);
                onChange(
                  e.target.checked
                    ? [
                        ...motions,
                        saved.current.get(state) ?? {
                          state,
                          prompt: "",
                          frames: 4,
                          fps: 8,
                          loop: state !== "jump" && state !== "attack",
                        },
                      ]
                    : motions.filter((m) => m.state !== state),
                );
              }}
            />
            {state}
          </label>
        ))}
      </div>
      {motions.map((m) => (
        <fieldset className="motion-card" key={m.state}>
          <legend>{m.state}</legend>
          <label className="field">
            동작 설명
            <textarea
              aria-label={`${m.state} 동작 설명`}
              required
              maxLength={4000}
              placeholder={`${m.state} 동작의 움직임, 속도, 유지할 특징을 설명하세요.`}
              value={m.prompt}
              onChange={(e) => change(m.state, { prompt: e.target.value })}
            />
          </label>
          <div className="batch-settings">
            <label className="field">
              프레임 수
              <input
                aria-label={`${m.state} 프레임 수`}
                type="number"
                required
                min={2}
                max={16}
                value={m.frames}
                onChange={(e) =>
                  change(m.state, { frames: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              FPS
              <input
                aria-label={`${m.state} FPS`}
                type="number"
                required
                min={1}
                max={60}
                value={m.fps}
                onChange={(e) =>
                  change(m.state, { fps: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label={`${m.state} 반복`}
              checked={m.loop}
              onChange={(e) => change(m.state, { loop: e.target.checked })}
            />
            반복 애니메이션
          </label>
        </fieldset>
      ))}
    </div>
  );
}
