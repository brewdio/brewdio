const TOKEN_KEY = "brewdio_auth_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !isTokenExpired();
}

/** Parse JWT payload without verifying signature (client-side only). */
export function parseToken(token: string): { sub: string; email: string; is_admin: boolean; exp: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Check if the stored token is expired. */
export function isTokenExpired(): boolean {
  const token = getToken();
  if (!token) return true;
  const parsed = parseToken(token);
  if (!parsed) return true;
  return parsed.exp * 1000 < Date.now();
}

/** Get the base URL for auth API calls (derived from sync server URL or current origin). */
export function getAuthBaseUrl(): string {
  // If a sync server is configured, derive the HTTP URL from it
  const syncServer = localStorage.getItem("brewdio_server");
  if (syncServer) {
    // Convert ws://host:port/ws to http://host:port
    return syncServer
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/ws\/?$/, "");
  }
  // Fall back to current origin (for same-origin deployments)
  return window.location.origin;
}

/** Authenticated fetch wrapper that adds Bearer token header. */
export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
