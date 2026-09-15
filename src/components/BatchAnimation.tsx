import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";
import { api } from "../lib/api";
import { directionLabels } from "../lib/directions";
import {
  animationBatch,
  motionStates,
  type AnimationMotion,
  type AnimationTarget,
  type AnimationBatchRequest,
} from "../lib/animationBatch";
import { AnimationMotions } from "./AnimationMotions";

export function BatchAnimation({
  assets,
  target,
  defaults,
  onSubmit,
  onClose,
}: {
  assets: Asset[];
  target: AnimationTarget;
  defaults: {
    prompt: string;
    size: number;
    state: string;
    frames: number;
    fps: number;
    loop: boolean;
    accessConfirmed: boolean;
  };
  onSubmit: (accessConfirmed: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(defaults);
  const [motions, setMotions] = useState<AnimationMotion[]>(() => [
    {
      state: motionStates.find((s) => s === defaults.state) ?? "walk",
      prompt: defaults.prompt,
      frames: defaults.frames,
      fps: defaults.fps,
      loop: defaults.loop,
    },
  ]);
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (target.anchors ?? []).map((a) => [a.direction, a.assetId]),
    ),
  );
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const selected = reviewed.map((direction) => ({
    direction,
    assetId: mapping[direction],
  }));
  const directional = target.anchors !== undefined;
  const reference = assets.find((a) => a.id === target.referenceId);
  const referencesValid = directional
    ? selected.every((a) => assets.some((asset) => asset.id === a.assetId))
    : !!reference;
  let request: AnimationBatchRequest | undefined;
  try {
    request = animationBatch({
      ...(directional
        ? { anchors: selected }
        : { referenceId: target.referenceId! }),
      size: settings.size,
      accessConfirmed: settings.accessConfirmed,
      motions,
    });
  } catch {
    /* Field constraints and the summary explain why submit is disabled. */
  }
  const valid = referencesValid && !!request;
  const jobCount = (directional ? selected.length : 1) * motions.length;
  async function submit() {
    if (!valid || !request || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.batchAnimate(request);
      onSubmit(settings.accessConfirmed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="batch-dialog panel"
      aria-labelledby="batch-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-title">
        <h2 id="batch-title">
          {directional ? "여러 방향·동작 생성" : "여러 동작 생성"}
        </h2>
        <button aria-label="일괄 생성 닫기" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="hint">
        {directional
          ? "방향과 장식이 올바른 기준 이미지를 지정한 뒤, 확인한 방향만 체크하세요."
          : "선택한 기준 이미지의 방향과 캐릭터를 유지하며 동작별로 생성합니다."}
        각 동작의 설명과 재생 설정을 입력하세요.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          <legend>기준 이미지와 동작 설정</legend>
          {directional ? (
            <div className="batch-anchors">
              {Object.entries(directionLabels).map(([direction, label]) => {
                const asset = assets.find((a) => a.id === mapping[direction]);
                return (
                  <div className="batch-anchor" key={direction}>
                    <div className="checker">
                      {asset ? (
                        <img src={asset.url} alt={`${label} 기준 미리보기`} />
                      ) : (
                        <span>미지정</span>
                      )}
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        disabled={!asset}
                        checked={reviewed.includes(direction)}
                        onChange={(e) =>
                          setReviewed((prev) =>
                            e.target.checked
                              ? [...prev, direction]
                              : prev.filter((d) => d !== direction),
                          )
                        }
                      />
                      {label} 확인
                    </label>
                    <select
                      aria-label={`${label} 기준 자산`}
                      value={mapping[direction] || ""}
                      onChange={(e) => {
                        setMapping((prev) => ({
                          ...prev,
                          [direction]: e.target.value,
                        }));
                        setReviewed((prev) =>
                          prev.filter((d) => d !== direction),
                        );
                      }}
                    >
                      <option value="">기준 자산 선택</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.width}×{a.height}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="batch-reference checker">
              {reference && (
                <img src={reference.url} alt="여러 동작 기준 미리보기" />
              )}
              <span>{reference?.name ?? "기준 자산을 찾을 수 없습니다."}</span>
            </div>
          )}
          <AnimationMotions motions={motions} onChange={setMotions} />
          <div className="batch-settings">
            <label className="field">
              목표 크기
              <select
                value={settings.size}
                onChange={(e) =>
                  setSettings({ ...settings, size: Number(e.target.value) })
                }
              >
                {[16, 32, 64, 128].map((s) => (
                  <option key={s} value={s}>
                    {s} × {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.accessConfirmed}
              onChange={(e) =>
                setSettings({ ...settings, accessConfirmed: e.target.checked })
              }
            />
            GPT 이미지 생성 이용 권한을 확인했습니다
          </label>
          <p className="hint">
            {directional ? `${selected.length}개 방향` : "기준 이미지 1개"} ×{" "}
            {motions.length}개 동작 = {jobCount}개 생성 요청. 각 요청에 계정
            사용량이 발생합니다. 동작 설명·기준·이용 권한을 모두 확인해야 시작할
            수 있습니다. 최대 40개 작업을 한 개씩 처리하며 각 작업은 최대
            20분입니다. 작업 내역에서 개별 결과와 취소를 확인하세요.
          </p>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <button
            className="primary wide"
            type="submit"
            disabled={!valid || busy}
          >
            {busy ? "작업 등록 중…" : `${jobCount}개 작업 생성 시작`}
          </button>
        </fieldset>
      </form>
    </dialog>
  );
}
