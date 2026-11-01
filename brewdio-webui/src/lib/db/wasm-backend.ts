import type { AppDb as AppDbClass, EquipmentType, RecipeType, EquipmentProfile, InventoryItem } from "brewdio-wasm";
import type { DataBackend, Recipe, Batch, SettingsDocument, InventoryDeductionPlan } from "./backend";

/**
 * WASM backend — wraps the existing AppDb WASM class.
 * All methods are synchronous WASM calls wrapped in Promise.resolve().
 */
export class WasmBackend implements DataBackend {
  private db: AppDbClass;
  constructor(db: AppDbClass) {
    this.db = db;
  }

  // --- Recipes ---

  async listRecipes(): Promise<Recipe[]> {
    return this.db.listRecipes() as unknown as Recipe[];
  }

  async getRecipe(id: string): Promise<Recipe | null> {
    const result = this.db.getRecipe(id);
    return (result ?? null) as unknown as Recipe | null;
  }

  async createRecipe(name: string, recipe: RecipeType, equipment?: EquipmentType, equipmentId?: string): Promise<string> {
    return this.db.createRecipe(name, recipe, equipment, equipmentId);
  }

  async updateRecipe(id: string, name: string, recipe: RecipeType, equipment?: EquipmentType): Promise<void> {
    this.db.updateRecipe(id, name, recipe, equipment);
  }

  async setRecipeEquipment(id: string, equipment?: EquipmentType, equipmentId?: string): Promise<void> {
    this.db.setRecipeEquipment(id, equipment, equipmentId);
  }

  async deleteRecipe(id: string): Promise<void> {
    this.db.deleteRecipe(id);
  }

  // --- Batches ---

  async listBatches(): Promise<Batch[]> {
    return this.db.listBatches() as unknown as Batch[];
  }

  async getBatch(id: string): Promise<Batch | null> {
    const result = this.db.getBatch(id);
    return (result ?? null) as unknown as Batch | null;
  }

  async createBatch(name: string, recipeId: string, data: unknown, inventoryPlan: InventoryDeductionPlan): Promise<string> {
    return this.db.createBatch(name, recipeId, data, inventoryPlan);
  }

  async updateBatch(id: string, name: string, data: unknown): Promise<void> {
    this.db.updateBatch(id, name, data);
  }

  async deleteBatch(id: string, updatedAt: string): Promise<void> {
    this.db.deleteBatch(id, updatedAt);
  }

  // --- Settings ---

  async getSettings(): Promise<SettingsDocument | null> {
    return this.db.getSettings() as unknown as SettingsDocument | null;
  }

  async saveSettings(data: SettingsDocument): Promise<void> {
    this.db.saveSettings(data);
  }

  // --- Equipment Profiles ---

  async listEquipmentProfiles(): Promise<EquipmentProfile[]> {
    return this.db.listEquipmentProfiles() as unknown as EquipmentProfile[];
  }

  async createEquipmentProfile(profile: EquipmentProfile): Promise<string> {
    return this.db.createEquipmentProfile(profile);
  }

  async updateEquipmentProfile(id: string, profile: EquipmentProfile): Promise<void> {
    this.db.updateEquipmentProfile(id, profile);
  }

  async deleteEquipmentProfile(id: string): Promise<void> {
    this.db.deleteEquipmentProfile(id);
  }

  // --- Inventory ---

  async listInventoryItems(): Promise<InventoryItem[]> {
    return this.db.listInventoryItems() as unknown as InventoryItem[];
  }

  async getInventoryItem(id: string): Promise<InventoryItem | null> {
    const result = this.db.getInventoryItem(id);
    return (result ?? null) as unknown as InventoryItem | null;
  }

  async createInventoryItem(item: InventoryItem): Promise<string> {
    return this.db.createInventoryItem(item);
  }

  async updateInventoryItem(id: string, item: InventoryItem): Promise<void> {
    this.db.updateInventoryItem(id, item);
  }

  async deleteInventoryItem(id: string): Promise<void> {
    this.db.deleteInventoryItem(id);
  }

  // --- Change notifications ---

  onRecipesChange(cb: () => void): void {
    this.db.onRecipesChange(cb);
  }

  onBatchesChange(cb: () => void): void {
    this.db.onBatchesChange(cb);
  }

  onSettingsChange(cb: () => void): void {
    this.db.onSettingsChange(cb);
  }

  onEquipmentChange(cb: () => void): void {
    this.db.onEquipmentChange(cb);
  }

  onInventoryChange(cb: () => void): void {
    this.db.onInventoryChange(cb);
  }
}
