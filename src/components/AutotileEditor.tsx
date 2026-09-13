import { useEffect, useRef, useState } from "react";
import { X, Plus, ChevronUp, ChevronDown } from "lucide-react";
import type { Asset, AutotileConfig, Layer } from "../types";
import { validAutotile } from "../lib/autotile";

const labels = [
  "위 왼쪽",
  "위",
  "위 오른쪽",
  "왼쪽",
  "중심",
  "오른쪽",
  "아래 왼쪽",
  "아래",
  "아래 오른쪽",
];
export function AutotileEditor({
  layer,
  assets,
  tileSize,
  onApply,
  onClose,
}: {
  layer: Layer;
  assets: Asset[];
  tileSize: number;
  onApply: (config: AutotileConfig | undefined) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const choices = assets.filter(
    (a) => a.width === tileSize && a.height === tileSize,
  );
  const [enabled, setEnabled] = useState(!!layer.autotile),
    [draft, setDraft] = useState<AutotileConfig>(() =>
      structuredClone(
        layer.autotile || { defaultAssetId: choices[0]?.id || "", rules: [] },
      ),
    );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function move(index: number, delta: number) {
    const rules = [...draft.rules];
    [rules[index], rules[index + delta]] = [rules[index + delta], rules[index]];
    setDraft({ ...draft, rules });
  }
  return (
    <dialog
      ref={dialog}
      className="autotile-dialog panel"
      aria-labelledby="autotile-title"
      onCancel={onClose}
    >
      <div className="section-title">
        <h2 id="autotile-title">{layer.name} · 오토타일 규칙</h2>
        <button aria-label="오토타일 닫기" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        오토타일 사용
      </label>
      <p className="hint">
        선택한 레이어의 이웃 유무로 타일을 고릅니다. 위에서 먼저 맞는 규칙을
        사용하고, 없으면 기본 타일을 표시합니다.
      </p>
      <label className="field">
        기본 타일
        <select
          aria-label="오토타일 기본 타일"
          disabled={!enabled}
          value={draft.defaultAssetId}
          onChange={(e) =>
            setDraft({ ...draft, defaultAssetId: e.target.value })
          }
        >
          <option value="">
            {tileSize}×{tileSize} 타일 선택
          </option>
          {choices.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {!choices.length && (
        <p className="notice">같은 크기의 PNG를 먼저 가져오세요.</p>
      )}
      <div className="autotile-rules">
        {draft.rules.map((r, n) => (
          <div className="autotile-rule" key={r.id}>
            <div className="rule-pattern">
              {r.pattern.map((v, i) => (
                <button
                  key={i}
                  disabled={!enabled || i === 4}
                  className={v === 1 ? "required" : v === 0 ? "absent" : ""}
                  aria-label={`규칙 ${n + 1} ${labels[i]}: ${v === 1 ? "있음" : v === 0 ? "없음" : "무관"}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.map((rule) =>
                        rule.id === r.id
                          ? {
                              ...rule,
                              pattern: rule.pattern.map((value, j) =>
                                i === j
                                  ? value === -1
                                    ? 1
                                    : value === 1
                                      ? 0
                                      : -1
                                  : value,
                              ),
                            }
                          : rule,
                      ),
                    })
                  }
                >
                  {i === 4 ? "중심" : v === 1 ? "있음" : v === 0 ? "없음" : "·"}
                </button>
              ))}
            </div>
            <div className="rule-fields">
              <label>
                규칙 {n + 1} 타일
                <select
                  aria-label={`규칙 ${n + 1} 타일`}
                  disabled={!enabled}
                  value={r.assetId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.map((rule) =>
                        rule.id === r.id
                          ? { ...rule, assetId: e.target.value }
                          : rule,
                      ),
                    })
                  }
                >
                  <option value="">타일 선택</option>
                  {choices.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline">
                <button
                  aria-label={`규칙 ${n + 1} 위로`}
                  disabled={!enabled || n === 0}
                  onClick={() => move(n, -1)}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  aria-label={`규칙 ${n + 1} 아래로`}
                  disabled={!enabled || n === draft.rules.length - 1}
                  onClick={() => move(n, 1)}
                >
                  <ChevronDown size={15} />
                </button>
                <button
                  disabled={!enabled}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.filter((rule) => rule.id !== r.id),
                    })
                  }
                >
                  규칙 제거
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        disabled={!enabled || draft.rules.length >= 32}
        onClick={() =>
          setDraft({
            ...draft,
            rules: [
              ...draft.rules,
              {
                id: crypto.randomUUID(),
                assetId: draft.defaultAssetId,
                pattern: [-1, -1, -1, -1, 1, -1, -1, -1, -1],
              },
            ],
          })
        }
      >
        <Plus size={16} />
        규칙 추가
      </button>
      <p className="hint">
        칸을 눌러 무관→있음→없음을 바꿉니다. 변경은 적용 후 맵과 PNG 내보내기에
        동일하게 반영됩니다.
      </p>
      <button
        className="primary wide"
        disabled={enabled && !validAutotile(draft)}
        onClick={() => onApply(enabled ? draft : undefined)}
      >
        규칙 적용
      </button>
    </dialog>
  );
}
