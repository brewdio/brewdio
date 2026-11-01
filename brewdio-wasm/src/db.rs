use std::sync::Arc;
use wasm_bindgen::prelude::*;
use brewdio_core::beerjson_types::{EquipmentType, RecipeType};
use brewdio_core::inventory::InventoryItem;
use brewdio_persistence::connection_wasm::WasmConnection;
use brewdio_persistence::db;
use brewdio_persistence::batch;
use brewdio_persistence::equipment_profile;
use brewdio_persistence::inventory;
use brewdio_persistence::settings;

/// Install the IndexedDB-backed persistent VFS.
/// Must be called once before creating an AppDb with `AppDb.open(path)`.
#[wasm_bindgen(js_name = "initPersistentStorage")]
pub async fn init_persistent_storage() -> Result<(), JsError> {
    brewdio_persistence::connection_wasm::install_persistent_vfs()
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen(js_name = "AppDb")]
pub struct AppDb {
    conn: Arc<WasmConnection>,
    pub(crate) on_recipes_change: Option<js_sys::Function>,
    pub(crate) on_batches_change: Option<js_sys::Function>,
    pub(crate) on_settings_change: Option<js_sys::Function>,
    pub(crate) on_equipment_change: Option<js_sys::Function>,
    pub(crate) on_inventory_change: Option<js_sys::Function>,
}

#[wasm_bindgen(js_class = "AppDb")]
impl AppDb {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<AppDb, JsError> {
        let conn = WasmConnection::open_memory().map_err(|e| JsError::new(&e.to_string()))?;
        Ok(AppDb { conn: Arc::new(conn), on_recipes_change: None, on_batches_change: None, on_settings_change: None, on_equipment_change: None, on_inventory_change: None })
    }

    pub fn open(path: &str) -> Result<AppDb, JsError> {
        let conn = WasmConnection::open(path).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(AppDb { conn: Arc::new(conn), on_recipes_change: None, on_batches_change: None, on_settings_change: None, on_equipment_change: None, on_inventory_change: None })
    }

    pub(crate) fn conn_arc(&self) -> &Arc<WasmConnection> {
        &self.conn
    }

    #[wasm_bindgen(js_name = "onRecipesChange")]
    pub fn on_recipes_change(&mut self, callback: js_sys::Function) {
        self.on_recipes_change = Some(callback);
    }

    #[wasm_bindgen(js_name = "onBatchesChange")]
    pub fn on_batches_change(&mut self, callback: js_sys::Function) {
        self.on_batches_change = Some(callback);
    }

    #[wasm_bindgen(js_name = "onSettingsChange")]
    pub fn on_settings_change(&mut self, callback: js_sys::Function) {
        self.on_settings_change = Some(callback);
    }

    #[wasm_bindgen(js_name = "onEquipmentChange")]
    pub fn on_equipment_change(&mut self, callback: js_sys::Function) {
        self.on_equipment_change = Some(callback);
    }

    #[wasm_bindgen(js_name = "onInventoryChange")]
    pub fn on_inventory_change(&mut self, callback: js_sys::Function) {
        self.on_inventory_change = Some(callback);
    }

    pub(crate) fn notify(&self) {
        if let Some(ref cb) = self.on_recipes_change {
            let _ = cb.call0(&JsValue::NULL);
        }
    }

    pub(crate) fn notify_batches(&self) {
        if let Some(ref cb) = self.on_batches_change {
            let _ = cb.call0(&JsValue::NULL);
        }
    }

    pub(crate) fn notify_settings(&self) {
        if let Some(ref cb) = self.on_settings_change {
            let _ = cb.call0(&JsValue::NULL);
        }
    }

    pub(crate) fn notify_inventory(&self) {
        if let Some(ref cb) = self.on_inventory_change {
            let _ = cb.call0(&JsValue::NULL);
        }
    }

    // --- Recipe operations (now using typed Recipe from persistence) ---

    #[wasm_bindgen(js_name = "listRecipes")]
    pub fn list_recipes(&self) -> Result<JsValue, JsError> {
        let recipes = db::list_recipes(&*self.conn)
            .map_err(|e| JsError::new(&e.to_string()))?;
        crate::to_js(&recipes).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "getRecipe")]
    pub fn get_recipe(&self, id: &str) -> Result<JsValue, JsError> {
        let recipe = db::get_recipe(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))?;
        match recipe {
            Some(r) => crate::to_js(&r).map_err(|e| JsError::new(&e.to_string())),
            None => Ok(JsValue::NULL),
        }
    }

    #[wasm_bindgen(js_name = "createRecipe")]
    pub fn create_recipe(&self, name: &str, recipe: RecipeType, equipment: Option<EquipmentType>, equipment_id: Option<String>) -> Result<String, JsError> {
        let row = db::create_recipe(&*self.conn, name, &recipe, equipment.as_ref(), equipment_id.as_deref())
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify();
        Ok(row.id)
    }

    #[wasm_bindgen(js_name = "updateRecipe")]
    pub fn update_recipe(&self, id: &str, name: &str, recipe: RecipeType, equipment: Option<EquipmentType>) -> Result<(), JsError> {
        db::update_recipe(&*self.conn, id, name, &recipe, equipment.as_ref())
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify();
        Ok(())
    }

    #[wasm_bindgen(js_name = "setRecipeEquipment")]
    pub fn set_recipe_equipment(&self, id: &str, equipment: Option<EquipmentType>, equipment_id: Option<String>) -> Result<(), JsError> {
        db::set_recipe_equipment(&*self.conn, id, equipment.as_ref(), equipment_id.as_deref())
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify();
        Ok(())
    }

    #[wasm_bindgen(js_name = "deleteRecipe")]
    pub fn delete_recipe(&self, id: &str) -> Result<(), JsError> {
        db::delete_recipe(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify();
        Ok(())
    }

    // --- Batch operations (now using typed Batch from persistence) ---

    #[wasm_bindgen(js_name = "createBatch")]
    pub fn create_batch(&self, name: &str, recipe_id: &str, data: JsValue, inventory_plan: JsValue) -> Result<String, JsError> {
        let data: serde_json::Value = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let data: batch::BatchData = serde_json::from_value(data)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let inventory_plan: batch::InventoryDeductionPlan =
            serde_wasm_bindgen::from_value(inventory_plan)
                .map_err(|e| JsError::new(&e.to_string()))?;
        let has_inventory_changes = !inventory_plan.deductions.is_empty();
        let row = batch::create_batch_with_inventory(
            &*self.conn,
            name,
            recipe_id,
            data,
            inventory_plan,
        )
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_batches();
        if has_inventory_changes {
            self.notify_inventory();
        }
        Ok(row.id)
    }

    #[wasm_bindgen(js_name = "getBatch")]
    pub fn get_batch(&self, id: &str) -> Result<JsValue, JsError> {
        let b = batch::get_batch(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))?;
        match b {
            Some(b) => crate::to_js(&b).map_err(|e| JsError::new(&e.to_string())),
            None => Ok(JsValue::NULL),
        }
    }

    #[wasm_bindgen(js_name = "listBatches")]
    pub fn list_batches(&self) -> Result<JsValue, JsError> {
        let batches = batch::list_batches(&*self.conn)
            .map_err(|e| JsError::new(&e.to_string()))?;
        crate::to_js(&batches).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "updateBatch")]
    pub fn update_batch(&self, id: &str, name: &str, data: JsValue) -> Result<(), JsError> {
        let data: serde_json::Value = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let data_json = serde_json::to_string(&data).unwrap();
        batch::update_batch(&*self.conn, id, name, &data_json)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_batches();
        Ok(())
    }

    #[wasm_bindgen(js_name = "deleteBatch")]
    pub fn delete_batch(&self, id: &str, updated_at: &str) -> Result<(), JsError> {
        let restored_inventory = batch::delete_batch_with_inventory(
            &*self.conn,
            id,
            updated_at,
        )
        .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_batches();
        if restored_inventory {
            self.notify_inventory();
        }
        Ok(())
    }

    // --- Settings operations ---

    #[wasm_bindgen(js_name = "getSettings")]
    pub fn get_settings(&self) -> Result<JsValue, JsError> {
        let doc = settings::get_settings_document(&*self.conn)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let data = serde_json::to_value(&doc)
            .unwrap_or(serde_json::Value::Null);
        crate::to_js(&data).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "saveSettings")]
    pub fn save_settings(&self, data: JsValue) -> Result<(), JsError> {
        let doc: settings::SettingsDocument = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsError::new(&e.to_string()))?;
        settings::save_settings(&*self.conn, &doc)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_settings();
        Ok(())
    }

    // --- Equipment Profile operations (now using typed EquipmentProfile) ---

    #[wasm_bindgen(js_name = "listEquipmentProfiles")]
    pub fn list_equipment_profiles(&self) -> Result<JsValue, JsError> {
        let profiles = equipment_profile::list_equipment_profiles(&*self.conn)
            .map_err(|e| JsError::new(&e.to_string()))?;
        crate::to_js(&profiles).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "createEquipmentProfile")]
    pub fn create_equipment_profile(&self, profile: brewdio_core::equipment_profile::EquipmentProfile) -> Result<String, JsError> {
        let row = equipment_profile::create_equipment_profile(&*self.conn, &profile)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(row.id)
    }

    #[wasm_bindgen(js_name = "updateEquipmentProfile")]
    pub fn update_equipment_profile(&self, id: &str, profile: brewdio_core::equipment_profile::EquipmentProfile) -> Result<(), JsError> {
        equipment_profile::update_equipment_profile(&*self.conn, id, &profile)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "deleteEquipmentProfile")]
    pub fn delete_equipment_profile(&self, id: &str) -> Result<(), JsError> {
        equipment_profile::delete_equipment_profile(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    // --- Inventory operations ---

    #[wasm_bindgen(js_name = "listInventoryItems")]
    pub fn list_inventory_items(&self) -> Result<JsValue, JsError> {
        let items = inventory::list_inventory_items(&*self.conn)
            .map_err(|e| JsError::new(&e.to_string()))?;
        crate::to_js(&items).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = "getInventoryItem")]
    pub fn get_inventory_item(&self, id: &str) -> Result<JsValue, JsError> {
        let item = inventory::get_inventory_item(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))?;
        match item {
            Some(item) => crate::to_js(&item).map_err(|e| JsError::new(&e.to_string())),
            None => Ok(JsValue::NULL),
        }
    }

    #[wasm_bindgen(js_name = "createInventoryItem")]
    pub fn create_inventory_item(&self, item: InventoryItem) -> Result<String, JsError> {
        let row = inventory::create_inventory_item(&*self.conn, &item)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_inventory();
        Ok(row.id)
    }

    #[wasm_bindgen(js_name = "updateInventoryItem")]
    pub fn update_inventory_item(&self, id: &str, item: InventoryItem) -> Result<(), JsError> {
        inventory::update_inventory_item(&*self.conn, id, &item)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_inventory();
        Ok(())
    }

    #[wasm_bindgen(js_name = "deleteInventoryItem")]
    pub fn delete_inventory_item(&self, id: &str) -> Result<(), JsError> {
        inventory::delete_inventory_item(&*self.conn, id)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.notify_inventory();
        Ok(())
    }
}
