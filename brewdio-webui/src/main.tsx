import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import initWasm, { AppDb, initPersistentStorage } from "brewdio-wasm";
import { initBackend, registerChangeCallback } from "@/lib/db/app-db";
import { WasmBackend } from "@/lib/db/wasm-backend";
import { setAppDb } from "@/lib/db/wasm-app-db";
import { startSync } from "@/lib/sync";
import { Toaster } from "sonner";
import "./index.css";
import "./i18n";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function init() {
  // WASM is always needed — calculations & static data (styles, fermentables, etc.)
  await initWasm();

  if (isTauri) {
    // Tauri mode: native SQLite persistence via Tauri commands.
    // DB is already opened in Tauri's setup hook (Rust side).
    const { TauriBackend } = await import("@/lib/db/tauri-backend");
    initBackend(new TauriBackend());
  } else {
    // Web mode: WASM SQLite persisted to IndexedDB
    try {
      await initPersistentStorage();
      console.log("[brewdio] Persistent storage initialized (IndexedDB VFS)");
    } catch (e) {
      console.warn("[brewdio] Failed to initialize persistent storage, falling back to in-memory:", e);
    }

    const db = AppDb.open("brewdio.db");
    setAppDb(db); // Store raw AppDb for WASM sync
    initBackend(new WasmBackend(db));
  }

  registerChangeCallback(queryClient);

  const syncServer = localStorage.getItem("brewdio_server");
  if (syncServer) startSync(syncServer);

  // Service worker: web only
  if (!isTauri && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </StrictMode>
  );
}

init();
