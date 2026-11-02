import { startSync as wasmStartSync, stopSync as wasmStopSync } from "brewdio-wasm";
import { getToken, isTokenExpired } from "@/lib/auth";

export type SyncStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "client_outdated"
  | "server_outdated"
  | "authentication_required"
  | "connection_error";
let status: SyncStatus = "disconnected";
let listeners = new Set<(s: SyncStatus) => void>();

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function setStatus(s: SyncStatus) {
  status = s;
  for (const fn of listeners) fn(status);
}

export async function startSync(serverUrl: string) {
  const token = getToken();
  if (!token || isTokenExpired()) {
    setStatus("authentication_required");
    return;
  }

  setStatus("connecting");
  const separator = serverUrl.includes("?") ? "&" : "?";
  const authenticatedUrl = `${serverUrl}${separator}token=${encodeURIComponent(token)}`;

  try {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      listen<SyncStatus>("sync-status", (event) => {
        setStatus(event.payload === "disconnected" ? "connection_error" : event.payload);
      });
      await invoke("start_sync", { url: authenticatedUrl });
    } else {
      // WASM mode: use the existing AppDb-based sync
      const { getAppDb } = await import("@/lib/db/wasm-app-db");
      const db = getAppDb();
      wasmStartSync(db, authenticatedUrl, (syncStatus: SyncStatus) => {
        setStatus(syncStatus === "disconnected" ? "connection_error" : syncStatus);
      });
    }
  } catch {
    setStatus("connection_error");
  }
}

export async function stopSync() {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_sync");
  } else {
    wasmStopSync();
  }
  setStatus("disconnected");
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
