/**
 * Application Configuration
 * Centralized config that reads from environment variables
 */

export const config = {
  // Backend API URL - read from VITE_API_URL env variable
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:8000",

  // App environment
  env: import.meta.env.VITE_APP_ENV || "development",

  // Is development mode?
  isDev: import.meta.env.DEV,

  // Is production mode?
  isProd: import.meta.env.PROD,
} as const;

// Type-safe environment variables (for TypeScript)
declare global {
  interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_APP_ENV: "development" | "production";
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
