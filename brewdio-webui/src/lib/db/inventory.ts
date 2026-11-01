import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { InventoryItem } from "brewdio-wasm";
import { getBackend } from "./app-db";
import { inventoryKeys } from "./query-keys";

export { inventoryKeys };

export function useInventoryItems() {
  return useQuery<InventoryItem[]>({
    queryKey: inventoryKeys.all,
    queryFn: () => getBackend().listInventoryItems(),
  });
}

export function useInventoryItem(id: string) {
  return useQuery<InventoryItem | null>({
    queryKey: inventoryKeys.detail(id),
    queryFn: () => getBackend().getInventoryItem(id),
    enabled: Boolean(id),
  });
}

export function createInventoryItemImperative(item: InventoryItem): Promise<string> {
  return getBackend().createInventoryItem(item);
}

export function updateInventoryItemImperative(
  id: string,
  item: InventoryItem
): Promise<void> {
  return getBackend().updateInventoryItem(id, item);
}

export function deleteInventoryItemImperative(id: string): Promise<void> {
  return getBackend().deleteInventoryItem(id);
}

export async function invalidateInventoryItems(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
}
