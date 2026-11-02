// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::{Arc, Mutex};

use commands::AppState;
use tauri::Manager;

fn main() {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Resolve DB path — shared with TUI via `directories`
            let proj_dirs = directories::ProjectDirs::from("com", "brewdio", "brewdio")
                .expect("Could not determine data directory");
            let data_dir = proj_dirs.data_dir();
            std::fs::create_dir_all(data_dir)?;
            let db_path = data_dir.join("brewdio.db");

            log::info!("[tauri] Opening database at {:?}", db_path);
            let conn = brewdio_persistence::connection_native::open(
                db_path.to_str().unwrap(),
            )
            .expect("Failed to open database");

            let state = AppState {
                conn: Arc::new(Mutex::new(conn)),
                sync_task: Mutex::new(None),
            };
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_recipes,
            commands::get_recipe,
            commands::create_recipe,
            commands::update_recipe,
            commands::set_recipe_equipment,
            commands::delete_recipe,
            commands::list_batches,
            commands::get_batch,
            commands::create_batch,
            commands::update_batch,
            commands::delete_batch,
            commands::get_settings,
            commands::save_settings,
            commands::list_equipment_profiles,
            commands::create_equipment_profile,
            commands::update_equipment_profile,
            commands::delete_equipment_profile,
            commands::list_inventory_items,
            commands::get_inventory_item,
            commands::create_inventory_item,
            commands::update_inventory_item,
            commands::delete_inventory_item,
            commands::start_sync,
            commands::stop_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
