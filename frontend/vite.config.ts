import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // The dev server proxies API calls so the app and API share an origin (cookies just work).
  const target = env.VITE_PROXY_TARGET || "http://localhost:3001";
  const port = Number(env.VITE_PORT || 5173);
  return {
    plugins: [react()],
    define: {
      __BUILD_ID__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: false },
        "/uploads": { target, changeOrigin: false },
      },
    },
    preview: {
      host: "127.0.0.1",
      port,
      proxy: {
        "/api": { target, changeOrigin: false },
        "/uploads": { target, changeOrigin: false },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
