// ---------------------------------------------------------------------------
// Centralised query-key constants for TanStack Query.
// Import from here (rather than from individual db modules) to avoid circular
// dependencies – especially inside app-db.ts which is imported by every other
// db module.
// ---------------------------------------------------------------------------

export const recipeKeys = {
  all: ['recipes'] as const,
  detail: (id: string) => ['recipes', id] as const,
};

export const batchKeys = {
  all: ['batches'] as const,
  detail: (id: string) => ['batches', id] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
};

export const equipmentKeys = {
  all: ['equipment-profiles'] as const,
};

export const inventoryKeys = {
  all: ['inventory-items'] as const,
  detail: (id: string) => ['inventory-items', id] as const,
};
