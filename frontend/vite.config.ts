import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { robotsTxt, sitemapXml } from "./src/lib/seo";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // The dev server proxies API calls so the app and API share an origin (cookies just work).
  const target = env.VITE_PROXY_TARGET || "http://localhost:3001";
  const port = Number(env.VITE_PORT || 5173);
  // Public origin used for the sitemap, robots.txt and Open Graph URLs. Set VITE_SITE_URL for production builds.
  const siteUrl = (env.VITE_SITE_URL || "https://fixlocal.example").replace(/\/+$/, "");
  return {
    plugins: [
      react(),
      {
        name: "fixlocal-seo",
        transformIndexHtml: (html: string) => html.replace(/%SITE_URL%/g, siteUrl),
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(siteUrl) });
          this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt(siteUrl) });
        },
      },
    ],
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
      // Maps are generated for error-tracking uploads but not linked from the shipped bundles.
      sourcemap: "hidden",
      rollupOptions: {
        output: {
          // React rarely changes between releases: a separate chunk stays cached across deploys.
          manualChunks(id: string) {
            if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return "react-vendor";
            if (id.includes("node_modules/leaflet/")) return "leaflet";
            return undefined;
          },
        },
      },
    },
  };
});
