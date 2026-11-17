/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Missive web app (sign-in / sign-up links). */
  readonly VITE_APP_URL?: string;
  /** Public base URL of the Missive REST API, shown in the code examples. */
  readonly VITE_API_URL?: string;
}
