/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Pingsell web app (sign-in / sign-up links). */
  readonly VITE_APP_URL?: string;
  /** Public base URL of the Pingsell REST API, shown in the code examples. */
  readonly VITE_API_URL?: string;
}
