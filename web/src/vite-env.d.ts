/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_RPC_FALLBACK_URL?: string;
  readonly VITE_POLL_MS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
