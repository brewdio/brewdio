import type { QueryClient } from '@tanstack/react-query';
import type { DataBackend } from './backend';
import { recipeKeys, batchKeys, settingsKeys, equipmentKeys, inventoryKeys } from './query-keys';

// ---------------------------------------------------------------------------
// Singleton DataBackend instance
// ---------------------------------------------------------------------------

let backend: DataBackend | null = null;

/** Call once during app initialisation (before React renders). */
export function initBackend(b: DataBackend) {
  backend = b;
}

export function getBackend(): DataBackend {
  if (!backend) throw new Error('DataBackend not initialised – call initBackend() first');
  return backend;
}

// ---------------------------------------------------------------------------
// Cross-tab sync via BroadcastChannel
// ---------------------------------------------------------------------------

const CHANNEL_NAME = 'brewdio-db-changes';
let channel: BroadcastChannel | null = null;

type ChangeKind = typeof recipeKeys.all[0] | typeof batchKeys.all[0] | typeof settingsKeys.all[0] | typeof equipmentKeys.all[0] | typeof inventoryKeys.all[0];

function getBroadcastChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function postChange(kind: ChangeKind) {
  getBroadcastChannel()?.postMessage(kind);
}

/**
 * Wire up the DataBackend change-notification callbacks so that external
 * mutations (e.g. incoming sync) automatically invalidate the TanStack Query
 * cache.
 *
 * Also sets up a BroadcastChannel so that changes in one tab are reflected
 * in all other open tabs.
 */
export function registerChangeCallback(queryClient: QueryClient) {
  const b = getBackend();
  b.onRecipesChange(() => {
    queryClient.invalidateQueries({ queryKey: recipeKeys.all });
    postChange('recipes');
  });
  b.onBatchesChange(() => {
    queryClient.invalidateQueries({ queryKey: batchKeys.all });
    postChange('batches');
  });
  b.onSettingsChange(() => {
    queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    postChange('settings');
  });
  b.onEquipmentChange(() => {
    queryClient.invalidateQueries({ queryKey: equipmentKeys.all });
    postChange('equipment-profiles');
  });
  b.onInventoryChange(() => {
    queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    postChange('inventory-items');
  });

  // Listen for changes from other tabs
  const bc = getBroadcastChannel();
  if (bc) {
    bc.onmessage = (event: MessageEvent<ChangeKind>) => {
      queryClient.invalidateQueries({ queryKey: [event.data] });
    };
  }
}
