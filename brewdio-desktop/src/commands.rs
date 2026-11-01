use std::sync::{Arc, Mutex};

use brewdio_core::beerjson_types::{EquipmentType, RecipeType};
use brewdio_core::equipment_profile::EquipmentProfile;
use brewdio_core::inventory::InventoryItem;
use brewdio_persistence::{
    batch::{self, Batch},
    db,
    equipment_profile,
    inventory,
    protocol::DocType,
    recipe::Recipe,
    settings::{self, SettingsDocument},
    sync_worker,
};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub conn: Arc<Mutex<rusqlite::Connection>>,
    pub sync_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_recipes(state: State<AppState>) -> Result<Vec<Recipe>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    db::list_recipes(&*conn).map_err(map_err)
}

#[tauri::command]
pub fn get_recipe(state: State<AppState>, id: String) -> Result<Option<Recipe>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    db::get_recipe(&*conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn create_recipe(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    recipe: RecipeType,
    equipment: Option<EquipmentType>,
    equipment_id: Option<String>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let row = db::create_recipe(
        &*conn,
        &name,
        &recipe,
        equipment.as_ref(),
        equipment_id.as_deref(),
    )
    .map_err(map_err)?;
    let _ = app.emit("db-change", "recipe");
    Ok(row.id)
}

#[tauri::command]
pub fn update_recipe(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    name: String,
    recipe: RecipeType,
    equipment: Option<EquipmentType>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    db::update_recipe(&*conn, &id, &name, &recipe, equipment.as_ref()).map_err(map_err)?;
    let _ = app.emit("db-change", "recipe");
    Ok(())
}

#[tauri::command]
pub fn set_recipe_equipment(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    equipment: Option<EquipmentType>,
    equipment_id: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    db::set_recipe_equipment(&*conn, &id, equipment.as_ref(), equipment_id.as_deref())
        .map_err(map_err)?;
    let _ = app.emit("db-change", "recipe");
    Ok(())
}

#[tauri::command]
pub fn delete_recipe(
    state: State<AppState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    db::delete_recipe(&*conn, &id).map_err(map_err)?;
    let _ = app.emit("db-change", "recipe");
    Ok(())
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_batches(state: State<AppState>) -> Result<Vec<Batch>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    batch::list_batches(&*conn).map_err(map_err)
}

#[tauri::command]
pub fn get_batch(state: State<AppState>, id: String) -> Result<Option<Batch>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    batch::get_batch(&*conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn create_batch(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    recipe_id: String,
    data: serde_json::Value,
    inventory_plan: batch::InventoryDeductionPlan,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let data: batch::BatchData = serde_json::from_value(data).map_err(map_err)?;
    let has_inventory_changes = !inventory_plan.deductions.is_empty();
    let row = brewdio_persistence::batch::create_batch_with_inventory(
        &*conn,
        &name,
        &recipe_id,
        data,
        inventory_plan,
    )
    .map_err(map_err)?;
    let _ = app.emit("db-change", "batch");
    if has_inventory_changes {
        let _ = app.emit("db-change", "inventory");
    }
    Ok(row.id)
}

#[tauri::command]
pub fn update_batch(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    name: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let data_str = serde_json::to_string(&data).map_err(map_err)?;
    brewdio_persistence::batch::update_batch(&*conn, &id, &name, &data_str).map_err(map_err)?;
    let _ = app.emit("db-change", "batch");
    Ok(())
}

#[tauri::command]
pub fn delete_batch(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    updated_at: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let restored_inventory = brewdio_persistence::batch::delete_batch_with_inventory(
        &*conn,
        &id,
        &updated_at,
    )
    .map_err(map_err)?;
    let _ = app.emit("db-change", "batch");
    if restored_inventory {
        let _ = app.emit("db-change", "inventory");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Option<SettingsDocument>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let doc = settings::get_settings_document(&*conn).map_err(map_err)?;
    Ok(Some(doc))
}

#[tauri::command]
pub fn save_settings(
    state: State<AppState>,
    app: AppHandle,
    data: SettingsDocument,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    settings::save_settings(&*conn, &data).map_err(map_err)?;
    let _ = app.emit("db-change", "settings");
    Ok(())
}

// ---------------------------------------------------------------------------
// Equipment Profiles
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_equipment_profiles(
    state: State<AppState>,
) -> Result<Vec<EquipmentProfile>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    equipment_profile::list_equipment_profiles(&*conn).map_err(map_err)
}

#[tauri::command]
pub fn create_equipment_profile(
    state: State<AppState>,
    app: AppHandle,
    profile: EquipmentProfile,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let row = equipment_profile::create_equipment_profile(&*conn, &profile).map_err(map_err)?;
    let _ = app.emit("db-change", "equipment");
    Ok(row.id)
}

#[tauri::command]
pub fn update_equipment_profile(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    profile: EquipmentProfile,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    equipment_profile::update_equipment_profile(&*conn, &id, &profile).map_err(map_err)?;
    let _ = app.emit("db-change", "equipment");
    Ok(())
}

#[tauri::command]
pub fn delete_equipment_profile(
    state: State<AppState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    equipment_profile::delete_equipment_profile(&*conn, &id).map_err(map_err)?;
    let _ = app.emit("db-change", "equipment");
    Ok(())
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_inventory_items(state: State<AppState>) -> Result<Vec<InventoryItem>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    inventory::list_inventory_items(&*conn).map_err(map_err)
}

#[tauri::command]
pub fn get_inventory_item(
    state: State<AppState>,
    id: String,
) -> Result<Option<InventoryItem>, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    inventory::get_inventory_item(&*conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn create_inventory_item(
    state: State<AppState>,
    app: AppHandle,
    item: InventoryItem,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(map_err)?;
    let row = inventory::create_inventory_item(&*conn, &item).map_err(map_err)?;
    let _ = app.emit("db-change", "inventory");
    Ok(row.id)
}

#[tauri::command]
pub fn update_inventory_item(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    item: InventoryItem,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    inventory::update_inventory_item(&*conn, &id, &item).map_err(map_err)?;
    let _ = app.emit("db-change", "inventory");
    Ok(())
}

#[tauri::command]
pub fn delete_inventory_item(
    state: State<AppState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(map_err)?;
    inventory::delete_inventory_item(&*conn, &id).map_err(map_err)?;
    let _ = app.emit("db-change", "inventory");
    Ok(())
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_sync(
    state: State<'_, AppState>,
    app: AppHandle,
    url: String,
) -> Result<(), String> {
    // Stop existing sync task if running
    {
        let mut task = state.sync_task.lock().map_err(map_err)?;
        if let Some(handle) = task.take() {
            handle.abort();
        }
    }

    let conn = state.conn.clone();
    let app_handle = app.clone();

    let join_handle = tokio::spawn(async move {
        loop {
            let result = sync_worker::run_sync(
                &*conn,
                &url,
                |s| {
                    let status_str = match &s {
                        sync_worker::SyncStatus::Connected => "connected",
                        sync_worker::SyncStatus::Disconnected => "disconnected",
                        sync_worker::SyncStatus::VersionMismatch {
                            local_version,
                            remote_version,
                        } => {
                            if local_version < remote_version {
                                "client_outdated"
                            } else {
                                "server_outdated"
                            }
                        }
                    };
                    let _ = app_handle.emit("sync-status", status_str);
                },
                |doc_type| {
                    let type_str = match doc_type {
                        DocType::Recipe => "recipe",
                        DocType::Batch => "batch",
                        DocType::Settings => "settings",
                        DocType::EquipmentProfile => "equipment",
                        DocType::InventoryItem => "inventory",
                    };
                    let _ = app_handle.emit("db-change", type_str);
                },
            )
            .await;

            if let Err(e) = result {
                log::warn!("[tauri-sync] sync error: {}", e);
            }

            let _ = app_handle.emit("sync-status", "disconnected");
            // Reconnect after delay
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });

    let mut task = state.sync_task.lock().map_err(map_err)?;
    *task = Some(join_handle);

    Ok(())
}

#[tauri::command]
pub async fn stop_sync(state: State<'_, AppState>) -> Result<(), String> {
    let mut task = state.sync_task.lock().map_err(map_err)?;
    if let Some(handle) = task.take() {
        handle.abort();
    }
    Ok(())
}
