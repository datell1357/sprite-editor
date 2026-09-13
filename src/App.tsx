import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  FolderOpen,
  X,
  AlertCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { AssetLibrary } from "./components/AssetLibrary";
import { PixelEditor } from "./components/PixelEditor";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { AtlasImport } from "./components/AtlasImport";
import { AssetComparison } from "./components/AssetComparison";
import { MapEditor } from "./components/MapEditor";
import { api, download, pngData } from "./lib/api";
import {
  PROJECT_FILE_MAX_BYTES,
  serializeProjectFile,
} from "./lib/projectFile";
import { requireTileDimensions } from "./lib/autotile";
import {
  emptyProject,
  activeClip,
  updateClip,
  adoptClips,
  orderedAssets,
  remapProject,
  validatePortable,
  validateProject,
} from "./lib/project";
import type { Asset, Capabilities, Job, Project } from "./types";

const STORAGE = "sprite-editor-project-v1";
function initialProject(): {
  project: Project;
  error: string;
  recover: boolean;
} {
  try {
    const value = localStorage.getItem(STORAGE);
    return {
      project: value ? validateProject(JSON.parse(value)) : emptyProject(),
      error: "",
      recover: false,
    };
  } catch {
    return {
      project: emptyProject(),
      error:
        "저장된 프로젝트를 읽지 못했습니다. 기존 브라우저 데이터는 보존했습니다. 백업 프로젝트를 열어 복구하세요.",
      recover: true,
    };
  }
}

export default function App() {
  const [initial] = useState(initialProject);
  const [project, setProject] = useState<Project>(initial.project),
    [assets, setAssets] = useState<Asset[]>([]),
    [selectedId, setSelected] = useState<string>();
  const [jobs, setJobs] = useState<Job[]>([]),
    [capabilities, setCapabilities] = useState<Capabilities | null>(null),
    [mode, setMode] = useState<"sprite" | "map">("sprite");
  const [color, setColor] = useState("#f4cc68"),
    [error, setError] = useState(initial.error),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [inspector, setInspector] = useState(() => window.innerWidth > 850),
    [saveState, setSaveState] = useState("Saved locally");
  const recovery = useRef(initial.recover);
  const latestProject = useRef(project);
  useLayoutEffect(() => {
    latestProject.current = project;
  }, [project]);
  const fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    dirty = useRef(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const clip = activeClip(project);
  const selected = assets.find((a) => a.id === selectedId);
  const parentAsset = assets.find((a) => a.id === selected?.parentId);
  const [comparing, setComparing] = useState(false);
  const onError = useCallback((message: string) => setError(message), []);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [newAssets, newJobs, status] = await Promise.all([
        api.assets(),
        api.jobs(),
        api.status(),
      ]);
      setAssets((old) =>
        JSON.stringify(old) === JSON.stringify(newAssets) ? old : newAssets,
      );
      setJobs(newJobs);
      setCapabilities(status);
      setConnected(true);
      setSelected((old) => old || newAssets[0]?.id);
    } catch {
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 850px)");
    const narrow = () => {
      if (query.matches) setInspector(false);
    };
    query.addEventListener("change", narrow);
    return () => query.removeEventListener("change", narrow);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (recovery.current) {
      setSaveState("복구 대기 · 기존 저장 데이터 보존");
      return;
    }
    try {
      localStorage.setItem(STORAGE, JSON.stringify(project));
      setSaveState("Saved locally");
    } catch {
      setSaveState("저장 공간 부족 · 프로젝트를 내보내 주세요");
    }
  }, [project]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  function select(id: string) {
    if (
      dirty.current &&
      id !== selectedId &&
      !window.confirm(
        "저장하지 않은 픽셀 수정이 있습니다. 저장하지 않고 이동할까요?",
      )
    )
      return false;
    setSelected(id);
    return true;
  }
  function changeMode(next: "sprite" | "map") {
    if (
      next !== mode &&
      dirty.current &&
      !window.confirm("픽셀 수정본을 저장하지 않고 화면을 바꿀까요?")
    )
      return;
    dirty.current = false;
    setMode(next);
  }
  async function imported(name: string, png: string, parentId?: string) {
    const asset = await api.import(name, png, parentId);
    await refresh();
    setSelected(asset.id);
    return asset;
  }
  async function blank() {
    try {
      if (
        dirty.current &&
        !window.confirm("현재 픽셀 수정본을 저장하지 않고 새 자산을 만들까요?")
      )
        return;
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      await imported("Untitled sprite", c.toDataURL());
      setMode("sprite");
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    if (
      dirty.current &&
      !window.confirm("현재 픽셀 수정본을 저장하지 않고 이미지를 가져올까요?")
    )
      return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 12 * 1024 * 1024)
          throw new Error("PNG는 12MB 이하여야 합니다.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
          reader.readAsDataURL(file);
        });
        await imported(file.name.replace(/\.png$/i, ""), data);
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function exportProject() {
    setBusy(true);
    try {
      if (assets.length > 256)
        throw new Error("한 프로젝트에 최대 256개 자산을 내보낼 수 있습니다.");
      const embedded = [];
      for (const asset of assets) {
        embedded.push({ ...asset, png: await pngData(asset) });
      }
      const text = serializeProjectFile({
        kind: "sprite-editor",
        project,
        assets: embedded,
      });
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      download(`${project.name}.sprite.json`, url);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importProject(file?: File) {
    if (!file) return;
    if (
      dirty.current &&
      !window.confirm("현재 픽셀 수정본을 저장하지 않고 프로젝트를 열까요?")
    )
      return;
    setBusy(true);
    try {
      if (file.size > PROJECT_FILE_MAX_BYTES)
        throw new Error("프로젝트는 64MB 이하여야 합니다.");
      const portable = validatePortable(JSON.parse(await file.text())),
        ids = new Map<string, string>();
      const restoredAssets: Asset[] = [];
      for (const a of orderedAssets(portable.assets)) {
        const added = await api.import(
          a.name,
          a.png,
          a.parentId ? ids.get(a.parentId) : undefined,
          a.processing,
        );
        ids.set(a.id, added.id);
        restoredAssets.push(added);
      }
      const restored = remapProject(portable.project, ids);
      requireTileDimensions(restored, restoredAssets);
      recovery.current = false;
      setProject(restored);
      await refresh();
      setSelected(ids.values().next().value);
      dirty.current = false;
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (projectInput.current) projectInput.current.value = "";
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="pixel-logo">
            <i />
            <i />
            <i />
            <i />
          </span>
          Sprite Editor
        </div>
        <input
          className="project-name"
          aria-label="프로젝트 이름"
          value={project.name}
          maxLength={120}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <nav className="workspace-tabs" aria-label="작업 공간">
          <button
            className={mode === "sprite" ? "active" : ""}
            onClick={() => changeMode("sprite")}
          >
            Sprite
          </button>
          <button
            className={mode === "map" ? "active" : ""}
            onClick={() => changeMode("map")}
          >
            Map
          </button>
        </nav>
        <div className="header-actions">
          <button
            aria-label="Import"
            disabled={busy || !connected}
            onClick={() => fileInput.current?.click()}
          >
            <ArrowDownToLine size={16} />
            <span>Import</span>
          </button>
          <button
            disabled={busy || !connected}
            title="프로젝트 열기"
            aria-label="프로젝트 열기"
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={17} />
          </button>
          <button
            aria-label="Export project"
            disabled={busy || !connected}
            onClick={exportProject}
          >
            <ArrowUpFromLine size={16} />
            <span>Export project</span>
          </button>
          <button
            className="inspector-toggle"
            aria-label="도구 패널 전환"
            onClick={() => setInspector(!inspector)}
          >
            {inspector ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button aria-label="오류 닫기" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!connected && (
        <div className="connection-banner" role="status">
          로컬 서비스에 연결 중입니다. 연결되지 않으면 터미널에서{" "}
          <code>npm run api</code>를 실행해 주세요.
        </div>
      )}
      <main className={`workspace ${!inspector ? "inspector-hidden" : ""}`}>
        <AssetLibrary
          assets={assets}
          selected={selectedId}
          onSelect={select}
          onImport={() => fileInput.current?.click()}
          onBlank={blank}
        />
        <div
          className={`main-workspace ${clip.candidates?.length ? "with-candidates" : ""}`}
        >
          {mode === "sprite" ? (
            <>
              <div className="clip-toolbar">
                <label>
                  Animation
                  <select
                    aria-label="애니메이션 클립"
                    value={project.activeClipId}
                    onChange={(e) =>
                      setProject({ ...project, activeClipId: e.target.value })
                    }
                  >
                    {project.clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.variant
                          ? ` · ${c.variant === "plain" ? "정규화 전" : "Pixel Unfake"}`
                          : ""}{" "}
                        · {c.frames.length} frames
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!connected || busy || project.clips.length >= 64}
                  onClick={() => setAtlasOpen(true)}
                >
                  sprite-gen 가져오기
                </button>
                <button
                  aria-label="새 애니메이션 클립"
                  disabled={project.clips.length >= 64}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setProject({
                      ...project,
                      activeClipId: id,
                      clips: [
                        ...project.clips,
                        {
                          id,
                          name: `Animation ${project.clips.length + 1}`,
                          frames: [],
                          fps: 8,
                          loop: true,
                        },
                      ],
                    });
                  }}
                >
                  + 클립
                </button>
              </div>
              <PixelEditor
                asset={selected}
                color={color}
                onColor={setColor}
                onError={onError}
                onDirty={onDirty}
                canCompare={!!parentAsset}
                onCompare={() => setComparing(true)}
                onSave={async (png) => {
                  if (selected)
                    await imported(
                      `${selected.name} · Edit`.slice(0, 120),
                      png,
                      selected.id,
                    );
                }}
              />
              <Timeline
                assets={assets}
                key={clip.id}
                clip={clip}
                selected={selectedId}
                onClip={(changed) => setProject((p) => updateClip(p, changed))}
                onSelect={select}
                onError={onError}
              />
            </>
          ) : (
            <MapEditor
              project={project}
              assets={assets}
              selected={selectedId}
              onChange={setProject}
              onError={onError}
              onSelect={select}
            />
          )}
        </div>
        {inspector && (
          <Inspector
            assets={assets}
            selected={selected}
            capabilities={capabilities}
            jobs={jobs}
            color={color}
            onColor={setColor}
            onJob={refresh}
            onChooseAnchor={select}
            onUseClips={async (clips) => {
              await refresh();
              const next = adoptClips(latestProject.current, clips);
              setProject(next);
              setMode("sprite");
              if (!dirty.current && clips[0].frames[0])
                setSelected(clips[0].frames[0].assetId);
            }}
            onError={onError}
          />
        )}
      </main>
      {atlasOpen && (
        <AtlasImport
          remainingClips={64 - project.clips.length}
          onClose={() => setAtlasOpen(false)}
          onImport={(added, clips) => {
            if (!dirty.current) setSelected(clips[0].frames[0].assetId);
            setAssets((old) => [...added, ...old]);
            setProject((p) => ({
              ...p,
              clips: [...p.clips, ...clips],
              activeClipId: clips[0].id,
            }));
            setAtlasOpen(false);
            refresh();
          }}
        />
      )}
      {comparing && selected && parentAsset && (
        <AssetComparison
          source={parentAsset}
          result={selected}
          onChoose={select}
          onClose={() => setComparing(false)}
        />
      )}
      <footer className="statusbar">
        <span>
          <CheckCircle2 size={14} />
          {busy ? "처리 중…" : saveState}
        </span>
        <span>
          {connected ? "Local workspace" : "Connecting"}
          <span className={`connection-dot ${connected ? "online" : ""}`} />
        </span>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept="image/png"
        multiple
        hidden
        onChange={(e) => importFiles(e.target.files)}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => importProject(e.target.files?.[0])}
      />
    </div>
  );
}
