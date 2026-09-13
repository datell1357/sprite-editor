import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";
import { api } from "../lib/api";
import { directionLabels } from "../lib/directions";

export function BatchAnimation({
  assets,
  anchors,
  defaults,
  onSubmit,
  onClose,
}: {
  assets: Asset[];
  anchors: { direction: string; assetId: string }[];
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
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(anchors.map((a) => [a.direction, a.assetId])),
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
  const valid =
    selected.length > 0 &&
    selected.every((a) => assets.some((asset) => asset.id === a.assetId)) &&
    settings.prompt.trim().length > 0 &&
    settings.accessConfirmed &&
    Number.isInteger(settings.frames) &&
    settings.frames >= 2 &&
    settings.frames <= 16 &&
    Number.isInteger(settings.fps) &&
    settings.fps >= 1 &&
    settings.fps <= 60;
  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.batchAnimate({ ...settings, anchors: selected });
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
        <h2 id="batch-title">여러 방향 모션 생성</h2>
        <button aria-label="일괄 생성 닫기" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="hint">
        방향과 장식이 올바른 기준 이미지를 지정한 뒤, 확인한 방향만 체크하세요.
        선택한 이미지의 방향을 유지해 같은 동작을 만듭니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          <legend>방향 기준과 동작 설정</legend>
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
          <label className="field">
            동작 설명
            <textarea
              aria-label="일괄 생성 프롬프트"
              required
              maxLength={4000}
              value={settings.prompt}
              onChange={(e) =>
                setSettings({ ...settings, prompt: e.target.value })
              }
            />
          </label>
          <div className="batch-settings">
            <label className="field">
              동작 상태
              <select
                value={settings.state}
                onChange={(e) =>
                  setSettings({ ...settings, state: e.target.value })
                }
              >
                {["idle", "walk", "run", "attack", "jump"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
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
            <label className="field">
              프레임 수
              <input
                aria-label="일괄 생성 프레임 수"
                type="number"
                required
                min={2}
                max={16}
                value={settings.frames}
                onChange={(e) =>
                  setSettings({ ...settings, frames: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              FPS
              <input
                aria-label="일괄 생성 FPS"
                type="number"
                required
                min={1}
                max={60}
                value={settings.fps}
                onChange={(e) =>
                  setSettings({ ...settings, fps: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.loop}
              onChange={(e) =>
                setSettings({ ...settings, loop: e.target.checked })
              }
            />
            반복 애니메이션 생성
          </label>
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
            {selected.length}개 방향 · 방향마다 생성 요청과 계정 사용량이
            발생합니다. 순서대로 처리하며 각 작업은 최대 20분입니다. 결과와
            취소는 작업 내역에서 방향별로 확인하세요.
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
            {busy ? "작업 등록 중…" : `${selected.length}개 방향 생성 시작`}
          </button>
        </fieldset>
      </form>
    </dialog>
  );
}
