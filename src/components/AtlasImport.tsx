import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { api } from "../lib/api";
import type { AnimationClip, Asset } from "../types";

export function AtlasImport({
  remainingClips,
  onImport,
  onClose,
}: {
  remainingClips: number;
  onImport: (assets: Asset[], clips: AnimationClip[]) => void;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<File>(),
    [sheet, setSheet] = useState<File>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function run() {
    if (!manifest || !sheet) return;
    setBusy(true);
    setError("");
    try {
      if (manifest.size > 2 * 1024 * 1024 || sheet.size > 12 * 1024 * 1024)
        throw new Error("manifest는 2MB, PNG는 12MB 이하여야 합니다.");
      const data = JSON.parse(await manifest.text());
      if (
        !data.frame_layout?.rows ||
        Object.keys(data.frame_layout.rows).length > remainingClips
      )
        throw new Error(
          "클립 수 제한(64개)을 초과했거나 manifest 형식이 다릅니다.",
        );
      const png = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("PNG 파일을 읽지 못했습니다."));
        reader.readAsDataURL(sheet);
      });
      const result = await api.importAtlas(data, png);
      onImport(result.assets, result.clips);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="import-dialog panel"
      aria-labelledby="atlas-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-title">
        <h2 id="atlas-title">sprite-gen 작업 가져오기</h2>
        <button aria-label="가져오기 닫기" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p>
        완성된 작업의 <strong>manifest.json</strong>과{" "}
        <strong>sprite-sheet-alpha.png</strong>를 선택하세요. 상태별 클립,
        프레임 순서, 재생 시간이 함께 복원됩니다.
      </p>
      <label>
        런타임 manifest
        <input
          aria-label="sprite-gen manifest"
          type="file"
          accept=".json"
          disabled={busy}
          onChange={(e) => setManifest(e.target.files?.[0])}
        />
      </label>
      <label>
        PNG 아틀라스
        <input
          aria-label="sprite-gen PNG 시트"
          type="file"
          accept="image/png"
          disabled={busy}
          onChange={(e) => setSheet(e.target.files?.[0])}
        />
      </label>
      <p className="hint">
        원본 작업은 변경하지 않습니다. 로컬 에디터에 새 자산과 클립을
        추가합니다.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        disabled={busy || !manifest || !sheet}
        onClick={run}
      >
        <Upload size={16} />
        {busy ? "검증하고 가져오는 중…" : "클립 가져오기"}
      </button>
    </dialog>
  );
}
