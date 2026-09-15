import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Undo2, Redo2, X } from "lucide-react";
import type { AnimationClip, Asset } from "../types";
import {
  animationLayout,
  DEFAULT_CLIP_PIVOT,
  MAX_FRAME_OFFSET,
} from "../lib/animationLayout";
import { AnimationPreview } from "./AnimationPreview";

export function AnimationAlignment({
  clip,
  assets,
  initialFrame,
  onApply,
  onClose,
}: {
  clip: AnimationClip;
  assets: Asset[];
  initialFrame: number;
  onApply: (clip: AnimationClip) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(clip),
    [frame, setFrame] = useState(initialFrame);
  const [onion, setOnion] = useState(false);
  const previous = useRef<AnimationClip[]>([]),
    next = useRef<AnimationClip[]>([]);
  const preview = useMemo(() => {
    try {
      return { layout: animationLayout(draft, assets), error: "" };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [draft, assets]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function change(updated: AnimationClip) {
    if (JSON.stringify(updated) === JSON.stringify(draft)) return;
    previous.current.push(draft);
    if (previous.current.length > 30) previous.current.shift();
    next.current = [];
    setDraft(updated);
  }
  function undo(redo = false) {
    const from = redo ? next.current : previous.current,
      to = redo ? previous.current : next.current;
    const value = from.pop();
    if (value) {
      to.push(draft);
      setDraft(value);
    }
  }
  const pivot = draft.pivot ?? DEFAULT_CLIP_PIVOT,
    selected = draft.frames[frame];
  return (
    <dialog
      ref={dialog}
      className="alignment-dialog panel"
      aria-labelledby="alignment-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="section-title">
        <h2 id="alignment-title">프레임 정렬 · 피벗</h2>
        <button aria-label="정렬 닫기" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="hint">
        {clip.name} · 원본을 보존하며 프레임 위치를 조절합니다. 밖으로 이동한
        부분에는 여백을 추가합니다.
      </p>
      <div className="alignment-body">
        <div>
          <div className="alignment-preview checker">
            {preview.layout && (
              <AnimationPreview
                layout={preview.layout}
                frame={frame}
                guides
                onion={onion}
              />
            )}
          </div>
          <div className="alignment-navigation">
            <button
              aria-label="정렬 이전 프레임"
              disabled={!frame}
              onClick={() => setFrame(frame - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              프레임 {frame + 1} / {draft.frames.length}
            </span>
            <button
              aria-label="정렬 다음 프레임"
              disabled={frame >= draft.frames.length - 1}
              onClick={() => setFrame(frame + 1)}
            >
              <ChevronRight size={18} />
            </button>
            <label>
              <input
                type="checkbox"
                checked={onion}
                onChange={(e) => setOnion(e.target.checked)}
              />
              이전 프레임 겹쳐 보기
            </label>
          </div>
        </div>
        <div className="alignment-properties">
          <h3>프레임 위치</h3>
          <div className="alignment-fields">
            {(["offsetX", "offsetY"] as const).map((axis) => (
              <label key={axis}>
                {axis === "offsetX" ? "X" : "Y"} (px)
                <input
                  aria-label={`프레임 위치 ${axis === "offsetX" ? "X" : "Y"}`}
                  type="number"
                  step={1}
                  min={-MAX_FRAME_OFFSET}
                  max={MAX_FRAME_OFFSET}
                  value={selected[axis] ?? 0}
                  onChange={(e) => {
                    const value = e.target.valueAsNumber;
                    if (
                      Number.isInteger(value) &&
                      Math.abs(value) <= MAX_FRAME_OFFSET
                    )
                      change({
                        ...draft,
                        frames: draft.frames.map((f, i) =>
                          i === frame ? { ...f, [axis]: value } : f,
                        ),
                      });
                  }}
                />
              </label>
            ))}
          </div>
          <button
            className="wide"
            onClick={() =>
              change({
                ...draft,
                frames: draft.frames.map((f, i) =>
                  i === frame ? { ...f, offsetX: 0, offsetY: 0 } : f,
                ),
              })
            }
          >
            이 프레임 위치 초기화
          </button>
          <h3>클립 공통 피벗</h3>
          <div className="alignment-fields">
            {(["x", "y"] as const).map((axis) => (
              <label key={axis}>
                {axis.toUpperCase()} (%)
                <input
                  aria-label={`클립 피벗 ${axis.toUpperCase()}`}
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={Number((pivot[axis] * 100).toFixed(6))}
                  onChange={(e) => {
                    const value = e.target.valueAsNumber;
                    if (Number.isFinite(value) && value >= 0 && value <= 100)
                      change({
                        ...draft,
                        pivot: { ...pivot, [axis]: value / 100 },
                      });
                  }}
                />
              </label>
            ))}
          </div>
          {preview.layout && (
            <p className="hint">
              기본 셀 {preview.layout.baseWidth}×{preview.layout.baseHeight}px
              <br />
              출력 셀 {preview.layout.width}×{preview.layout.height}px
              <br />
              출력 피벗 ({preview.layout.pivotX}, {preview.layout.pivotY})px
            </p>
          )}
          <p className="hint">
            피벗은 모든 프레임의 공통 기준점입니다. 녹색 가이드와 겹쳐 보기는
            PNG에 포함되지 않습니다.
          </p>
        </div>
      </div>
      {preview.error && (
        <p role="alert" className="notice">
          {preview.error}
        </p>
      )}
      <div className="alignment-actions">
        <button
          aria-label="정렬 실행 취소"
          disabled={!previous.current.length}
          onClick={() => undo()}
        >
          <Undo2 size={16} />
        </button>
        <button
          aria-label="정렬 다시 실행"
          disabled={!next.current.length}
          onClick={() => undo(true)}
        >
          <Redo2 size={16} />
        </button>
        <button onClick={onClose}>취소</button>
        <button
          className="primary"
          disabled={!preview.layout}
          onClick={() => onApply(draft)}
        >
          정렬 적용
        </button>
      </div>
    </dialog>
  );
}
