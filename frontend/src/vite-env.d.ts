/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  readonly VITE_LEGAL_ENTITY?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_GRIEVANCE_OFFICER?: string;
  readonly VITE_GRIEVANCE_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __BUILD_ID__: string;
