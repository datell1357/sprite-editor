export interface Asset {
  id: string;
  name: string;
  width: number;
  height: number;
  url: string;
  parentId: string | null;
  createdAt: string;
}
export interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  assetId?: string;
  error?: string;
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
}
export interface Project {
  version: 1;
  name: string;
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
  layers: Layer[];
  placements: Placement[];
  sequence: string[];
  fps: number;
}
export interface PortableProject {
  kind: "sprite-editor";
  project: Project;
  assets: (Asset & { png: string })[];
}
