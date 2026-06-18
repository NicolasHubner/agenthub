import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Backend routes that must never be served the SPA shell by the service worker.
const API_PREFIXES = ["files", "file", "state", "sessions", "msg", "note", "subagents", "ws"];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: {
        navigateFallbackDenylist: [new RegExp(`^/(${API_PREFIXES.join("|")})(/|$)`)],
        // Don't try to cache PTY/websocket or API responses.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      manifest: {
        name: "AgentHub",
        short_name: "AgentHub",
        description: "Canvas of terminal AI agents that message each other",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/files": "http://127.0.0.1:3000",
      "/file": "http://127.0.0.1:3000",
      "/state": "http://127.0.0.1:3000",
      "/sessions": "http://127.0.0.1:3000",
      "/msg": "http://127.0.0.1:3000",
      "/note": "http://127.0.0.1:3000",
      "/subagents": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
