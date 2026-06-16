import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/files": "http://127.0.0.1:3000",
      "/file": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
