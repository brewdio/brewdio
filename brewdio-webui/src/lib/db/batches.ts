import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getBackend } from './app-db';
import { batchKeys } from './query-keys';
import type { Batch, BatchData, InventoryDeductionPlan } from './backend';

export { batchKeys };

// Re-export typed Batch from backend.
export type { Batch, BatchData };

// ---------------------------------------------------------------------------
// Types — flattened BatchDocument for consumer compatibility
// ---------------------------------------------------------------------------

export interface BatchDocument {
  id: string;
  name: string;
  recipeId: string;
  equipmentId: string;
  recipe: import('brewdio-wasm').RecipeType;
  equipment: import('brewdio-wasm').EquipmentType;
  brewDate: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  inventoryDeductions?: BatchData['inventoryDeductions'];
  inventoryShortages?: BatchData['inventoryShortages'];
}

function batchToBatchDoc(b: Batch): BatchDocument {
  return {
    id: b.id,
    name: b.name,
    recipeId: b.recipeId,
    equipmentId: b.data.equipmentId,
    recipe: b.data.recipe,
    equipment: b.data.equipment,
    brewDate: b.data.brewDate,
    notes: b.data.notes,
    createdAt: b.data.createdAt,
    updatedAt: b.data.updatedAt,
    inventoryDeductions: b.data.inventoryDeductions,
    inventoryShortages: b.data.inventoryShortages,
  };
}

function batchDocToData(doc: Omit<BatchDocument, 'id' | 'name' | 'recipeId'>) {
  return {
    equipmentId: doc.equipmentId,
    recipe: doc.recipe,
    equipment: doc.equipment,
    brewDate: doc.brewDate,
    notes: doc.notes,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    inventoryDeductions: doc.inventoryDeductions ?? [],
    inventoryShortages: doc.inventoryShortages ?? [],
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useBatches() {
  return useQuery<BatchDocument[]>({
    queryKey: batchKeys.all,
    queryFn: async () => {
      const batches = await getBackend().listBatches();
      return batches.map(batchToBatchDoc);
    },
  });
}

export function useBatch(id: string) {
  return useQuery<BatchDocument | null>({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const b = await getBackend().getBatch(id);
      return b ? batchToBatchDoc(b) : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Imperative helpers
// ---------------------------------------------------------------------------

export async function createBatchImperative(
  name: string,
  recipeId: string,
  data: Omit<BatchDocument, 'id' | 'name' | 'recipeId'>,
  inventoryPlan: InventoryDeductionPlan,
): Promise<string> {
  return getBackend().createBatch(name, recipeId, batchDocToData(data), inventoryPlan);
}

export async function updateBatchImperative(
  id: string,
  name: string,
  data: Omit<BatchDocument, 'id' | 'name' | 'recipeId'>,
): Promise<void> {
  return getBackend().updateBatch(id, name, batchDocToData(data));
}

export async function deleteBatchImperative(id: string): Promise<void> {
  return getBackend().deleteBatch(id, new Date().toISOString());
}

export async function listBatchesImperative(): Promise<BatchDocument[]> {
  const batches = await getBackend().listBatches();
  return batches.map(batchToBatchDoc);
}

// ---------------------------------------------------------------------------
// Cache invalidation helper
// ---------------------------------------------------------------------------

export function invalidateBatches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: batchKeys.all });
}
