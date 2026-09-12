import { useState } from "react";
import { Search, Plus, Layers3 } from "lucide-react";
import type { Asset } from "../types";

export function AssetLibrary({
  assets,
  selected,
  onSelect,
  onImport,
  onBlank,
}: {
  assets: Asset[];
  selected?: string;
  onSelect: (id: string) => void;
  onImport: () => void;
  onBlank: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = assets.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || (filter === "revisions" ? a.parentId : !a.parentId)),
  );
  return (
    <aside className="asset-library panel">
      <div className="section-title">
        <h2>
          Assets <span>{assets.length}</span>
        </h2>
        <button
          className="icon-button"
          onClick={onBlank}
          title="빈 스프라이트 만들기"
          aria-label="빈 스프라이트 만들기"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="segmented">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          전체
        </button>
        <button
          className={filter === "original" ? "active" : ""}
          onClick={() => setFilter("original")}
        >
          원본
        </button>
        <button
          className={filter === "revisions" ? "active" : ""}
          onClick={() => setFilter("revisions")}
        >
          수정본
        </button>
      </div>
      <label className="search">
        <Search size={16} />
        <input
          placeholder="자산 검색"
          aria-label="자산 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="asset-grid">
        {filtered.map((a) => (
          <button
            className={`asset ${selected === a.id ? "selected" : ""}`}
            key={a.id}
            onClick={() => onSelect(a.id)}
            title={a.name}
          >
            <div className="asset-thumb">
              <img src={a.url} alt="" loading="lazy" />
            </div>
            <span>{a.name}</span>
            <small>
              {a.width} × {a.height}
              {a.parentId ? " · 수정본" : ""}
            </small>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty">
          <Layers3 size={28} />
          <p>
            {assets.length ? "검색 결과가 없습니다." : "첫 자산을 가져오세요."}
          </p>
          <button onClick={onImport}>PNG 가져오기</button>
          <p className="hint">
            생성하거나 빈 캔버스에서
            <br />
            직접 그릴 수도 있어요.
          </p>
        </div>
      )}
      <button className="library-import" onClick={onImport}>
        <Plus size={16} /> 자산 가져오기
      </button>
    </aside>
  );
}
