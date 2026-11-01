import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSettings, saveSettingsImperative, DEFAULT_SETTINGS, type SettingsDocument } from "@/lib/db/settings";
import { useQueryClient } from "@tanstack/react-query";
import { settingsKeys } from "@/lib/db/settings";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { startSync, stopSync, getSyncStatus, onSyncStatusChange } from "@/lib/sync";
import { clearToken, getToken, isAuthenticated, parseToken } from "@/lib/auth";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

const volumeUnits = ["ml", "l", "tsp", "tbsp", "floz", "cup", "pt", "qt", "gal", "bbl"] as const;
const massUnits = ["mg", "g", "kg", "lb", "oz"] as const;
const temperatureUnits = ["C", "F"] as const;

function SettingsComponent() {
  const { t } = useTranslation();
  const { data: currentSettings, status } = useSettings();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<SettingsDocument>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings when they become available
  useEffect(() => {
    if (status === "success" && currentSettings) {
      setSettings(currentSettings);
    }
  }, [currentSettings, status]);

  const handleSave = async () => {
    await saveSettingsImperative(settings);
    await queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    setHasChanges(false);
  };

  const handleReset = () => {
    if (currentSettings) {
      setSettings(currentSettings);
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
    setHasChanges(false);
  };

  const updateSetting = <K extends keyof SettingsDocument>(
    key: K,
    value: SettingsDocument[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (status === "pending") {
    return <div>{t("settings.loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
        <p className="text-muted-foreground mt-2">
          {t("settings.description")}
        </p>
      </div>

      <div className="space-y-6 border rounded-lg p-6">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t("settings.recipeDefaults.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.recipeDefaults.description")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="default-author">{t("settings.recipeDefaults.defaultAuthor")}</Label>
            <Input
              id="default-author"
              type="text"
              value={settings.defaultAuthor || ""}
              onChange={(e) => updateSetting("defaultAuthor", e.target.value)}
              placeholder={t("settings.recipeDefaults.authorPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.recipeDefaults.authorHelp")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t("settings.ai.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.ai.description")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="openai-key">{t("settings.ai.apiKeyLabel")}</Label>
            <Input
              id="openai-key"
              type="password"
              value={settings.openaiApiKey || ""}
              onChange={(e) => updateSetting("openaiApiKey", e.target.value)}
              placeholder="sk-..."
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.ai.apiKeyHelp")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t("settings.editor.title")}</h2>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="vim-mode"
              checked={settings.vimMode}
              onCheckedChange={(checked) => updateSetting("vimMode", checked as boolean)}
            />
            <Label
              htmlFor="vim-mode"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t("settings.editor.vimMode")}
            </Label>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t("settings.units.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.units.description")}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="volume-unit">{t("settings.units.volume")}</Label>
              <Select
                value={settings.defaultVolumeUnit}
                onValueChange={(value) =>
                  updateSetting("defaultVolumeUnit", value as SettingsDocument["defaultVolumeUnit"])
                }
              >
                <SelectTrigger id="volume-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {volumeUnits.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mass-unit">{t("settings.units.mass")}</Label>
              <Select
                value={settings.defaultMassUnit}
                onValueChange={(value) =>
                  updateSetting("defaultMassUnit", value as SettingsDocument["defaultMassUnit"])
                }
              >
                <SelectTrigger id="mass-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {massUnits.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="temperature-unit">{t("settings.units.temperature")}</Label>
              <Select
                value={settings.defaultTemperatureUnit}
                onValueChange={(value) =>
                  updateSetting("defaultTemperatureUnit", value as SettingsDocument["defaultTemperatureUnit"])
                }
              >
                <SelectTrigger id="temperature-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {temperatureUnits.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit === "C"
                        ? t("settings.units.celsius")
                        : t("settings.units.fahrenheit")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={!hasChanges}>
          {hasChanges ? t("settings.actions.saveChanges") : t("settings.actions.noChanges")}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={!hasChanges}>
          {t("settings.actions.reset")}
        </Button>
      </div>

      <SyncSection />
    </div>
  );
}

const statusColors: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500",
  disconnected: "bg-gray-400",
  client_outdated: "bg-orange-500",
  server_outdated: "bg-orange-500",
  authentication_required: "bg-orange-500",
  connection_error: "bg-red-500",
};

const statusLabelKeys: Record<string, string> = {
  connected: "settings.sync.status.connected",
  connecting: "settings.sync.status.connecting",
  disconnected: "settings.sync.status.disconnected",
  client_outdated: "settings.sync.status.clientOutdated",
  server_outdated: "settings.sync.status.serverOutdated",
  authentication_required: "settings.sync.status.authenticationRequired",
  connection_error: "settings.sync.status.connectionError",
};

function isVersionMismatch(status: string) {
  return status === "client_outdated" || status === "server_outdated";
}

function canStartConnection(status: string) {
  return status === "disconnected"
    || status === "authentication_required"
    || status === "connection_error"
    || isVersionMismatch(status);
}

function SyncSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setAuthRevision] = useState(0);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus);
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem("brewdio_server") ?? ""
  );

  useEffect(() => {
    return onSyncStatusChange(setSyncStatus);
  }, []);

  const authenticated = isAuthenticated();
  const token = getToken();
  const account = token ? parseToken(token) : null;

  const handleConnect = () => {
    if (!serverUrl.trim()) return;
    localStorage.setItem("brewdio_server", serverUrl.trim());
    startSync(serverUrl.trim());
  };

  const handleLogin = () => {
    if (!serverUrl.trim()) return;
    localStorage.setItem("brewdio_server", serverUrl.trim());
    navigate({ to: "/login" });
  };

  const handleLogout = async () => {
    await stopSync();
    clearToken();
    setAuthRevision((revision) => revision + 1);
  };

  const handleDisconnect = () => {
    localStorage.removeItem("brewdio_server");
    stopSync();
  };

  return (
    <div className="space-y-6 border rounded-lg p-6">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{t("settings.sync.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.sync.description")}
        </p>

        <div className="space-y-2">
          <Label htmlFor="sync-server-url">{t("settings.sync.serverUrl")}</Label>
          <Input
            id="sync-server-url"
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="ws://192.168.1.100:8080/ws"
            disabled={!canStartConnection(syncStatus)}
          />
        </div>

        <div className="rounded-md border p-3 space-y-3">
          <p className="text-sm font-medium">{t("settings.sync.accountTitle")}</p>
          {authenticated && account ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("settings.sync.signedInAs", { email: account.email })}
              </p>
              <Button size="sm" variant="outline" onClick={handleLogout}>
                {t("settings.sync.logout")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("settings.sync.authenticationRequiredMessage")}
              </p>
              <Button
                size="sm"
                onClick={handleLogin}
                disabled={!serverUrl.trim()}
              >
                {t("settings.sync.loginOrRegister")}
              </Button>
            </div>
          )}
        </div>

        {syncStatus === "connection_error" && authenticated && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3">
            <p className="text-sm text-red-800 dark:text-red-300">
              {t("settings.sync.connectionErrorMessage")}
            </p>
          </div>
        )}

        {syncStatus === "client_outdated" && (
          <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 p-3 space-y-2">
            <p className="text-sm text-orange-800 dark:text-orange-300">
              {t("settings.sync.clientOutdatedMessage")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              {t("settings.sync.refreshPage")}
            </Button>
          </div>
        )}

        {syncStatus === "server_outdated" && (
          <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 p-3 space-y-2">
            <p className="text-sm text-orange-800 dark:text-orange-300">
              {t("settings.sync.serverOutdatedMessage")}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          {canStartConnection(syncStatus) ? (
            <>
              <Button
                onClick={handleConnect}
                disabled={!serverUrl.trim() || !authenticated}
              >
                {t("settings.sync.connect")}
              </Button>
              {isVersionMismatch(syncStatus) && (
                <Button variant="outline" onClick={handleDisconnect}>
                  {t("settings.sync.disconnect")}
                </Button>
              )}
            </>
          ) : (
            <Button variant="outline" onClick={handleDisconnect}>
              {t("settings.sync.disconnect")}
            </Button>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${statusColors[syncStatus] ?? "bg-gray-400"}`}
            />
            {statusLabelKeys[syncStatus] ? t(statusLabelKeys[syncStatus]) : syncStatus}
          </div>
        </div>
      </div>
    </div>
  );
}
