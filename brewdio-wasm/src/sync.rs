use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::{AbortHandle, Abortable};
use wasm_bindgen::prelude::*;

use brewdio_persistence::connection_wasm::WasmConnection;
use brewdio_persistence::protocol::DocType;
use brewdio_persistence::sync::SyncSession as InnerSyncSession;
use brewdio_persistence::sync_worker::{run_sync, SyncError, SyncStatus};

use crate::db::AppDb;

// ---------------------------------------------------------------------------
// SyncSession — wasm-bindgen wrapper (still used by tests / other code)
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct SyncSession {
    inner: InnerSyncSession,
}

#[wasm_bindgen]
impl SyncSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: InnerSyncSession::new(),
        }
    }

    #[wasm_bindgen(js_name = "fromBytes")]
    pub fn from_bytes(am_bytes: &[u8]) -> Self {
        Self {
            inner: InnerSyncSession::from_doc_bytes(am_bytes),
        }
    }

    #[wasm_bindgen(js_name = "fromDocAndState")]
    pub fn from_doc_and_state(am_bytes: &[u8], state_bytes: &[u8]) -> Self {
        Self {
            inner: InnerSyncSession::from_doc_and_state(am_bytes, state_bytes),
        }
    }

    #[wasm_bindgen(js_name = "reconcileJson")]
    pub fn reconcile_json(&mut self, recipe_json: &str) {
        let doc: brewdio_persistence::recipe::RecipeDocument =
            serde_json::from_str(recipe_json).expect("Failed to parse RecipeDocument JSON");
        self.inner.reconcile(&doc);
    }

    #[wasm_bindgen(js_name = "hydrateJson")]
    pub fn hydrate_json(&self) -> String {
        let doc = self.inner.hydrate();
        serde_json::to_string(&doc).expect("Failed to serialize RecipeDocument")
    }

    #[wasm_bindgen(js_name = "generateSyncMessage")]
    pub fn generate_sync_message(&mut self) -> Option<Vec<u8>> {
        self.inner.generate_sync_message()
    }

    #[wasm_bindgen(js_name = "receiveSyncMessage")]
    pub fn receive_sync_message(&mut self, data: &[u8]) -> Result<Option<Vec<u8>>, JsError> {
        self.inner
            .receive_sync_message(data)
            .map_err(|e| JsError::new(&format!("Sync error: {}", e)))
    }

    #[wasm_bindgen(js_name = "saveDoc")]
    pub fn save_doc(&mut self) -> Vec<u8> {
        self.inner.save_doc()
    }

    #[wasm_bindgen(js_name = "saveState")]
    pub fn save_state(&self) -> Vec<u8> {
        self.inner.save_state()
    }

    #[wasm_bindgen(js_name = "loadState")]
    pub fn load_state(&mut self, bytes: &[u8]) {
        self.inner.load_state(bytes);
    }

    #[wasm_bindgen(js_name = "isSynced")]
    pub fn is_synced(&mut self) -> bool {
        self.inner.is_synced()
    }
}

// ---------------------------------------------------------------------------
// start_sync / stop_sync — thin WASM wrappers around run_sync
// ---------------------------------------------------------------------------

thread_local! {
    static ABORT_HANDLE: RefCell<Option<AbortHandle>> = RefCell::new(None);
}

#[wasm_bindgen(js_name = "startSync")]
pub fn start_sync(db: &AppDb, server_url: &str, on_status: js_sys::Function) {
    stop_sync();

    let conn: Arc<WasmConnection> = db.conn_arc().clone();
    let url = server_url.to_string();

    // Clone the change callbacks from the db
    let on_recipes_change = db.on_recipes_change.clone();
    let on_batches_change = db.on_batches_change.clone();
    let on_settings_change = db.on_settings_change.clone();
    let on_equipment_change = db.on_equipment_change.clone();
    let on_inventory_change = db.on_inventory_change.clone();
    let on_status_fn = on_status;

    let (handle, reg) = AbortHandle::new_pair();
    ABORT_HANDLE.with(|h| *h.borrow_mut() = Some(handle));

    wasm_bindgen_futures::spawn_local(async move {
        let _ = Abortable::new(
            async move {
                loop {
                    let on_recipes = on_recipes_change.clone();
                    let on_batches = on_batches_change.clone();
                    let on_settings = on_settings_change.clone();
                    let on_equipment = on_equipment_change.clone();
                    let on_inventory = on_inventory_change.clone();
                    let on_status_ref = on_status_fn.clone();

                    let result = run_sync(
                        &*conn,
                        &url,
                        |sync_status| {
                            let status = match &sync_status {
                                SyncStatus::Connected => "connected",
                                SyncStatus::Disconnected => "disconnected",
                                SyncStatus::VersionMismatch { local_version, remote_version } => {
                                    if local_version < remote_version {
                                        "client_outdated"
                                    } else {
                                        "server_outdated"
                                    }
                                }
                            };
                            let _ = on_status_ref.call1(
                                &JsValue::NULL,
                                &JsValue::from_str(status),
                            );
                        },
                        |doc_type| {
                            let cb = match doc_type {
                                DocType::Recipe => &on_recipes,
                                DocType::Batch => &on_batches,
                                DocType::Settings => &on_settings,
                                DocType::EquipmentProfile => &on_equipment,
                                DocType::InventoryItem => &on_inventory,
                            };
                            if let Some(f) = cb {
                                let _ = f.call0(&JsValue::NULL);
                            }
                        },
                    )
                    .await;

                    // On version mismatch, show appropriate status but keep retrying
                    // (server may be restarted/upgraded)
                    if let Err(SyncError::VersionMismatch { local_version, remote_version }) = result {
                        let status = if local_version < remote_version {
                            "client_outdated"
                        } else {
                            "server_outdated"
                        };
                        let _ = on_status_fn.call1(
                            &JsValue::NULL,
                            &JsValue::from_str(status),
                        );
                    } else {
                        // Disconnected — notify status
                        let _ = on_status_fn.call1(
                            &JsValue::NULL,
                            &JsValue::from_str("disconnected"),
                        );
                    }
                    wasmtimer::tokio::sleep(Duration::from_secs(5)).await;
                }
            },
            reg,
        )
        .await;
    });
}

#[wasm_bindgen(js_name = "stopSync")]
pub fn stop_sync() {
    ABORT_HANDLE.with(|h| {
        if let Some(handle) = h.borrow_mut().take() {
            handle.abort();
        }
    });
}
