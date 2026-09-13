import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";

export const processingName = (asset: Asset) =>
  asset.processing === "plain"
    ? "정규화 전 · 셀 크기"
    : asset.processing === "pixel-unfake"
      ? "Pixel Unfake"
      : asset.processing === "pixel-snapper"
        ? "Pixel Snapper"
        : "저장된 버전";

export function AssetComparison({
  source,
  result,
  onChoose,
  onClose,
}: {
  source: Asset;
  result: Asset;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="compare-dialog panel"
      ref={dialog}
      aria-labelledby="compare-title"
      onCancel={() => onClose()}
    >
      <div className="section-title">
        <h2 id="compare-title">원본과 결과 비교</h2>
        <button aria-label="비교 닫기" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="compare-images">
        {[source, result].map((a, i) => (
          <section key={a.id}>
            <h3>
              {i === 0 ? "비교 기준" : "현재 결과"} · {processingName(a)}
            </h3>
            <div className="checker">
              <img
                src={a.url}
                alt={i === 0 ? "비교 기준 이미지" : "처리 결과 이미지"}
                onError={() => setFailed(true)}
              />
            </div>
            <p>
              {a.width} × {a.height}px · {a.name}
            </p>
            <button
              className={i === 1 ? "primary wide" : "wide"}
              disabled={failed}
              onClick={() => {
                onChoose(a.id);
                onClose();
              }}
            >
              {i === 0 ? "원본 선택" : "결과 선택"}
            </button>
          </section>
        ))}
      </div>
      {failed && (
        <p className="notice" role="alert">
          비교 이미지를 읽지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.
        </p>
      )}
      <p className="hint">
        저장된 두 버전을 각각 화면에 맞춰 보여줍니다. 실제 크기는 위 숫자를
        기준으로 확인하세요. 선택해도 이미지나 기존 맵·클립은 바뀌지 않습니다.
      </p>
    </dialog>
  );
}
