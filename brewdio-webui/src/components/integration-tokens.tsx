import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch, getAuthBaseUrl, isAuthenticated } from "@/lib/auth";

interface IntegrationToken {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface CreatedIntegrationToken {
  token: string;
  integrationToken: IntegrationToken;
}

function formatServerDate(value: string | null) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function IntegrationTokens() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [name, setName] = useState("CraftBeerPi");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authenticated = isAuthenticated();
  const serverConfigured = !!localStorage.getItem("brewdio_server");

  useEffect(() => {
    if (!authenticated || !serverConfigured) return;
    let cancelled = false;

    authFetch(`${getAuthBaseUrl()}/api/v1/integration-tokens`)
      .then((response) => {
        if (!response.ok) throw new Error("list failed");
        return response.json();
      })
      .then((loadedTokens: IntegrationToken[]) => {
        if (!cancelled) setTokens(loadedTokens);
      })
      .catch(() => {
        if (!cancelled) setError(t("settings.integrations.errors.load"));
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, serverConfigured, t]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setCreatedToken(null);
    setCopied(false);
    try {
      const response = await authFetch(`${getAuthBaseUrl()}/api/v1/integration-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) throw new Error("create failed");
      const created: CreatedIntegrationToken = await response.json();
      setCreatedToken(created.token);
      setTokens((current) => [created.integrationToken, ...current]);
    } catch {
      setError(t("settings.integrations.errors.create"));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
  };

  const handleRevoke = async (token: IntegrationToken) => {
    if (!window.confirm(t("settings.integrations.revokeConfirmation", { name: token.name }))) {
      return;
    }
    setError(null);
    try {
      const response = await authFetch(
        `${getAuthBaseUrl()}/api/v1/integration-tokens/${token.id}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("revoke failed");
      setTokens((current) => current.filter((item) => item.id !== token.id));
      setCreatedToken(null);
    } catch {
      setError(t("settings.integrations.errors.revoke"));
    }
  };

  return (
    <div className="space-y-6 border rounded-lg p-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t("settings.integrations.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.integrations.description")}
        </p>
      </div>

      {!authenticated || !serverConfigured ? (
        <p className="text-sm text-orange-700 dark:text-orange-300">
          {t("settings.integrations.authenticationRequired")}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <Label htmlFor="integration-token-name">
              {t("settings.integrations.name")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="integration-token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
              />
              <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                {loading
                  ? t("settings.integrations.creating")
                  : t("settings.integrations.create")}
              </Button>
            </div>
          </div>

          {createdToken && (
            <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-4 space-y-3">
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                {t("settings.integrations.createdTitle")}
              </p>
              <p className="text-sm text-green-800 dark:text-green-300">
                {t("settings.integrations.createdWarning")}
              </p>
              <div className="flex gap-2">
                <Input value={createdToken} readOnly className="font-mono" />
                <Button variant="outline" onClick={handleCopy}>
                  {copied
                    ? t("settings.integrations.copied")
                    : t("settings.integrations.copy")}
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="space-y-3">
            <h3 className="font-medium">{t("settings.integrations.activeKeys")}</h3>
            {tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("settings.integrations.noKeys")}
              </p>
            ) : (
              tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{token.name}</p>
                    <p className="text-sm font-mono text-muted-foreground">
                      {token.keyPrefix}…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.lastUsedAt
                        ? t("settings.integrations.lastUsed", {
                            date: formatServerDate(token.lastUsedAt),
                          })
                        : t("settings.integrations.neverUsed")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleRevoke(token)}
                  >
                    {t("settings.integrations.revoke")}
                  </Button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
