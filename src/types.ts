export interface Asset {
  id: string;
  name: string;
  width: number;
  height: number;
  url: string;
  parentId: string | null;
  createdAt: string;
  processing?: "plain" | "pixel-unfake" | "pixel-snapper";
}
export interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  assetId?: string;
  error?: string;
  stage?: string;
  clips?: AnimationClip[];
  reviewRequired?: boolean;
  archiveUrl?: string;
  request: { kind: string; prompt?: string };
}
export interface Capabilities {
  spriteGen: boolean;
  pixelSnapper: boolean;
  providers: { codex: boolean; grok: boolean };
}
export type Tool = "brush" | "eraser" | "picker";
export interface Placement {
  id: string;
  assetId: string;
  x: number;
  y: number;
  layerId: string;
}
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  collider: boolean;
  autotile?: AutotileConfig;
}
export interface AutotileRule {
  id: string;
  pattern: number[];
  assetId: string;
}
export interface AutotileConfig {
  defaultAssetId: string;
  rules: AutotileRule[];
}
export interface Project {
  version: 2;
  name: string;
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
  layers: Layer[];
  placements: Placement[];
  clips: AnimationClip[];
  activeClipId: string;
}
export interface ClipFrame {
  assetId: string;
  durationMs: number;
}
export interface AnimationClip {
  id: string;
  name: string;
  frames: ClipFrame[];
  candidates?: ClipFrame[];
  fps: number;
  loop: boolean;
  variant?: "plain" | "pixel-unfake";
}
export interface PortableProject {
  kind: "sprite-editor";
  project: Project;
  assets: (Asset & { png: string })[];
}
