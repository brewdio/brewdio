import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSyncStatus, onSyncStatusChange } from "@/lib/sync";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useTranslation } from "react-i18next";

type SyncStatusType = ReturnType<typeof getSyncStatus>;

const statusConfig: Record<
  SyncStatusType | "offline",
  { labelKey: string; dotClass: string }
> = {
  offline: { labelKey: "settings.sync.status.offline", dotClass: "bg-gray-400" },
  disconnected: { labelKey: "settings.sync.status.disconnected", dotClass: "bg-gray-400" },
  connecting: { labelKey: "settings.sync.status.connecting", dotClass: "bg-yellow-400" },
  connected: { labelKey: "settings.sync.status.connected", dotClass: "bg-green-400" },
  client_outdated: { labelKey: "settings.sync.status.clientOutdated", dotClass: "bg-orange-400" },
  server_outdated: { labelKey: "settings.sync.status.serverOutdated", dotClass: "bg-orange-400" },
  authentication_required: { labelKey: "settings.sync.status.authenticationRequired", dotClass: "bg-orange-400" },
  connection_error: { labelKey: "settings.sync.status.connectionError", dotClass: "bg-red-400" },
};

export function SyncStatus() {
  const { t } = useTranslation();
  const serverConfigured = !!localStorage.getItem("brewdio_server");
  const [status, setStatus] = useState<SyncStatusType>(getSyncStatus());

  useEffect(() => {
    return onSyncStatusChange(setStatus);
  }, []);

  const displayStatus = serverConfigured ? status : "offline";
  const { labelKey, dotClass } = statusConfig[displayStatus];
  const label = t(labelKey);

  return (
    <SidebarMenuButton tooltip={label} asChild>
      <Link to="/settings">
        <span
          className={`inline-block shrink-0 rounded-full ${dotClass} h-2 w-2 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4`}
          aria-hidden
        />
        <span>{label}</span>
      </Link>
    </SidebarMenuButton>
  );
}
