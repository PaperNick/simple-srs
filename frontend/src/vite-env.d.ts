/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KEY_PLAY_AUDIO?: string
  readonly VITE_KEY_EXPAND_DETAILS?: string
  [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
