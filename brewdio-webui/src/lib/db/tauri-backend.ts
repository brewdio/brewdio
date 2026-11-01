import type { EquipmentType, RecipeType, EquipmentProfile, InventoryItem } from "brewdio-wasm";
import type { DataBackend, Recipe, Batch, SettingsDocument, InventoryDeductionPlan } from "./backend";

// Lazy-load Tauri APIs to avoid errors when not in Tauri environment
async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

async function getListen() {
  const { listen } = await import("@tauri-apps/api/event");
  return listen;
}

/**
 * Tauri backend — all CRUD operations go through Tauri commands (invoke),
 * which call brewdio-persistence native functions on the Rust side.
 */
export class TauriBackend implements DataBackend {
  private recipesCallbacks: Set<() => void> = new Set();
  private batchesCallbacks: Set<() => void> = new Set();
  private settingsCallbacks: Set<() => void> = new Set();
  private equipmentCallbacks: Set<() => void> = new Set();
  private inventoryCallbacks: Set<() => void> = new Set();

  constructor() {
    this.setupListeners();
  }

  private async setupListeners() {
    const listen = await getListen();
    listen<string>("db-change", (event) => {
      switch (event.payload) {
        case "recipe":
          this.recipesCallbacks.forEach((cb) => cb());
          break;
        case "batch":
          this.batchesCallbacks.forEach((cb) => cb());
          break;
        case "settings":
          this.settingsCallbacks.forEach((cb) => cb());
          break;
        case "equipment":
          this.equipmentCallbacks.forEach((cb) => cb());
          break;
        case "inventory":
          this.inventoryCallbacks.forEach((cb) => cb());
          break;
      }
    });
  }

  // --- Recipes ---

  async listRecipes(): Promise<Recipe[]> {
    const invoke = await getInvoke();
    return invoke<Recipe[]>("list_recipes");
  }

  async getRecipe(id: string): Promise<Recipe | null> {
    const invoke = await getInvoke();
    return invoke<Recipe | null>("get_recipe", { id });
  }

  async createRecipe(name: string, recipe: RecipeType, equipment?: EquipmentType, equipmentId?: string): Promise<string> {
    const invoke = await getInvoke();
    return invoke<string>("create_recipe", { name, recipe, equipment, equipmentId });
  }

  async updateRecipe(id: string, name: string, recipe: RecipeType, equipment?: EquipmentType): Promise<void> {
    const invoke = await getInvoke();
    await invoke("update_recipe", { id, name, recipe, equipment });
  }

  async setRecipeEquipment(id: string, equipment?: EquipmentType, equipmentId?: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke("set_recipe_equipment", { id, equipment, equipmentId });
  }

  async deleteRecipe(id: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke("delete_recipe", { id });
  }

  // --- Batches ---

  async listBatches(): Promise<Batch[]> {
    const invoke = await getInvoke();
    return invoke<Batch[]>("list_batches");
  }

  async getBatch(id: string): Promise<Batch | null> {
    const invoke = await getInvoke();
    return invoke<Batch | null>("get_batch", { id });
  }

  async createBatch(name: string, recipeId: string, data: unknown, inventoryPlan: InventoryDeductionPlan): Promise<string> {
    const invoke = await getInvoke();
    return invoke<string>("create_batch", { name, recipeId, data, inventoryPlan });
  }

  async updateBatch(id: string, name: string, data: unknown): Promise<void> {
    const invoke = await getInvoke();
    await invoke("update_batch", { id, name, data });
  }

  async deleteBatch(id: string, updatedAt: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke("delete_batch", { id, updatedAt });
  }

  // --- Settings ---

  async getSettings(): Promise<SettingsDocument | null> {
    const invoke = await getInvoke();
    return invoke<SettingsDocument | null>("get_settings");
  }

  async saveSettings(data: SettingsDocument): Promise<void> {
    const invoke = await getInvoke();
    await invoke("save_settings", { data });
  }

  // --- Equipment Profiles ---

  async listEquipmentProfiles(): Promise<EquipmentProfile[]> {
    const invoke = await getInvoke();
    return invoke<EquipmentProfile[]>("list_equipment_profiles");
  }

  async createEquipmentProfile(profile: EquipmentProfile): Promise<string> {
    const invoke = await getInvoke();
    return invoke<string>("create_equipment_profile", { profile });
  }

  async updateEquipmentProfile(id: string, profile: EquipmentProfile): Promise<void> {
    const invoke = await getInvoke();
    await invoke("update_equipment_profile", { id, profile });
  }

  async deleteEquipmentProfile(id: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke("delete_equipment_profile", { id });
  }

  // --- Inventory ---

  async listInventoryItems(): Promise<InventoryItem[]> {
    const invoke = await getInvoke();
    return invoke<InventoryItem[]>("list_inventory_items");
  }

  async getInventoryItem(id: string): Promise<InventoryItem | null> {
    const invoke = await getInvoke();
    return invoke<InventoryItem | null>("get_inventory_item", { id });
  }

  async createInventoryItem(item: InventoryItem): Promise<string> {
    const invoke = await getInvoke();
    return invoke<string>("create_inventory_item", { item });
  }

  async updateInventoryItem(id: string, item: InventoryItem): Promise<void> {
    const invoke = await getInvoke();
    await invoke("update_inventory_item", { id, item });
  }

  async deleteInventoryItem(id: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke("delete_inventory_item", { id });
  }

  // --- Change notifications ---

  onRecipesChange(cb: () => void): void {
    this.recipesCallbacks.add(cb);
  }

  onBatchesChange(cb: () => void): void {
    this.batchesCallbacks.add(cb);
  }

  onSettingsChange(cb: () => void): void {
    this.settingsCallbacks.add(cb);
  }

  onEquipmentChange(cb: () => void): void {
    this.equipmentCallbacks.add(cb);
  }

  onInventoryChange(cb: () => void): void {
    this.inventoryCallbacks.add(cb);
  }
}
