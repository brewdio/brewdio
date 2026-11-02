import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import wasm from "vite-plugin-wasm";
// import topLevelAwait from "vite-plugin-top-level-await";

// https://vite.dev/config/
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss(), wasm()], // topLevelAwait()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
        ...(isTauri ? {} : { sw: path.resolve(__dirname, "src/sw.ts") }),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    strictPort: true,
    ...(!isTauri && {
      proxy: {
        "/ws": {
          target: "ws://localhost:8080",
          ws: true,
        },
      },
    }),
  },
  // Don't clear the screen so Tauri logs stay visible
  clearScreen: false,
});
