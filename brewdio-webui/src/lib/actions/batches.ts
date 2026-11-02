import { deleteBatchImperative } from '@/lib/db/batches';

/**
 * Delete a batch by ID
 */
export async function deleteBatch(batchId: string): Promise<void> {
  await deleteBatchImperative(batchId);
}
