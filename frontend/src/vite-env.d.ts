/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ENABLE_LOADER?: string;
  readonly VITE_WAKE_WORD_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
