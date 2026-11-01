use std::collections::{HashMap, HashSet};
use std::fmt;
use std::time::Duration;

use futures_util::stream::SplitSink;
use futures_util::{pin_mut, SinkExt, StreamExt};
use futures_util::future::{select, Either};
use tokio_tungstenite_wasm::{connect, Message, WebSocketStream};

#[cfg(feature = "native")]
use tokio::time::{interval, sleep};
#[cfg(feature = "wasm")]
use wasmtimer::tokio::interval;

use crate::connection::{Connection, SCHEMA_VERSION};
use crate::db;
use crate::protocol::{DocType, SyncMessage};
use crate::sync::SyncSession;

const PEER_ID: &str = "server";
const DIRTY_CHECK_INTERVAL: Duration = Duration::from_secs(2);
#[cfg(feature = "native")]
const RECONNECT_DELAY: Duration = Duration::from_secs(5);

/// Sync connection status reported via the `on_status` callback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncStatus {
    Connected,
    Disconnected,
    VersionMismatch { local_version: u32, remote_version: u32 },
}

/// Status codes for AtomicU8 (native TUI).
pub const SYNC_STATUS_DISCONNECTED: u8 = 0;
pub const SYNC_STATUS_CONNECTED: u8 = 1;
/// Client is older than server — user should update the app.
pub const SYNC_STATUS_CLIENT_OUTDATED: u8 = 2;
/// Server is older than client — server needs updating.
pub const SYNC_STATUS_SERVER_OUTDATED: u8 = 3;

/// Persistent sync sessions keyed by (DocType, doc_id), kept alive for the connection.
type Sessions = HashMap<(DocType, String), SyncSession>;

#[derive(Debug)]
pub enum SyncError {
    WebSocket(tokio_tungstenite_wasm::Error),
    Json(serde_json::Error),
    Db(crate::connection::DbError),
    Protocol(String),
    VersionMismatch { local_version: u32, remote_version: u32 },
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::WebSocket(e) => write!(f, "WebSocket error: {}", e),
            SyncError::Json(e) => write!(f, "JSON error: {}", e),
            SyncError::Db(e) => write!(f, "DB error: {}", e),
            SyncError::Protocol(e) => write!(f, "Protocol error: {}", e),
            SyncError::VersionMismatch { local_version, remote_version } => {
                write!(f, "Version mismatch: local={}, remote={}", local_version, remote_version)
            }
        }
    }
}

impl From<tokio_tungstenite_wasm::Error> for SyncError {
    fn from(e: tokio_tungstenite_wasm::Error) -> Self {
        SyncError::WebSocket(e)
    }
}

impl From<serde_json::Error> for SyncError {
    fn from(e: serde_json::Error) -> Self {
        SyncError::Json(e)
    }
}

impl From<crate::connection::DbError> for SyncError {
    fn from(e: crate::connection::DbError) -> Self {
        SyncError::Db(e)
    }
}

/// Run the sync protocol against a WebSocket server. Returns when the connection
/// drops or an unrecoverable error occurs. The caller should reconnect after a delay.
///
/// - `conn`: any `Connection + Sync` — `&Mutex<rusqlite::Connection>` on native,
///   `&WasmConnection` on WASM (which is `Sync` because WASM is single-threaded).
/// - `on_status(connected)`: called when connection status changes.
/// - `on_change(doc_type)`: called when a remote change is applied to the DB.
pub async fn run_sync(
    conn: &(impl Connection + Sync),
    server_url: &str,
    on_status: impl Fn(SyncStatus),
    on_change: impl Fn(DocType),
) -> Result<(), SyncError> {
    log::info!("[sync] connecting to {}", server_url);
    // server_url may already contain ?token=... appended by the caller
    let ws_stream = connect(server_url).await?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let mut sessions: Sessions = HashMap::new();

    // Clear stale sync states from any previous connection
    db::clear_sync_states_for_peer(conn, PEER_ID)?;

    // --- Hello handshake ---
    let local_recipe_ids = db::list_all_doc_ids(conn, DocType::Recipe)?;
    let local_batch_ids = db::list_all_doc_ids(conn, DocType::Batch)?;
    let local_settings_ids = db::list_all_doc_ids(conn, DocType::Settings)?;
    let local_equipment_profile_ids = db::list_all_doc_ids(conn, DocType::EquipmentProfile)?;
    let local_inventory_item_ids = db::list_all_doc_ids(conn, DocType::InventoryItem)?;

    let hello = SyncMessage::Hello {
        recipe_ids: local_recipe_ids.clone(),
        batch_ids: local_batch_ids.clone(),
        settings_ids: local_settings_ids.clone(),
        equipment_profile_ids: local_equipment_profile_ids.clone(),
        inventory_item_ids: local_inventory_item_ids.clone(),
        schema_version: SCHEMA_VERSION,
    };
    log::debug!(
        "[sync] sending Hello (recipes={}, batches={}, settings={}, equipment={}, inventory={})",
        local_recipe_ids.len(),
        local_batch_ids.len(),
        local_settings_ids.len(),
        local_equipment_profile_ids.len(),
        local_inventory_item_ids.len(),
    );
    ws_tx
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    // Wait for server Hello (or Reject)
    let server_hello = loop {
        match ws_rx.next().await {
            Some(Ok(Message::Text(text))) => {
                let msg: SyncMessage = serde_json::from_str(&text)?;
                break msg;
            }
            Some(Ok(_)) => continue,
            Some(Err(e)) => return Err(e.into()),
            None => return Ok(()),
        }
    };

    let (server_recipe_ids, server_batch_ids, server_settings_ids, server_equipment_profile_ids, server_inventory_item_ids) =
        match server_hello {
            SyncMessage::Reject {
                reason,
                server_version,
                client_version,
            } => {
                log::warn!(
                    "[sync] server rejected connection: {} (server_version={}, client_version={})",
                    reason, server_version, client_version
                );
                on_status(SyncStatus::VersionMismatch {
                    local_version: SCHEMA_VERSION,
                    remote_version: server_version,
                });
                return Err(SyncError::VersionMismatch {
                    local_version: client_version,
                    remote_version: server_version,
                });
            }
            SyncMessage::Hello {
                recipe_ids,
                batch_ids,
                settings_ids,
                equipment_profile_ids,
                inventory_item_ids,
                schema_version,
            } => {
                if schema_version != SCHEMA_VERSION {
                    log::warn!(
                        "[sync] server schema_version={} does not match local={}",
                        schema_version, SCHEMA_VERSION
                    );
                    on_status(SyncStatus::VersionMismatch {
                        local_version: SCHEMA_VERSION,
                        remote_version: schema_version,
                    });
                    return Err(SyncError::VersionMismatch {
                        local_version: SCHEMA_VERSION,
                        remote_version: schema_version,
                    });
                }
                (
                    recipe_ids.into_iter().collect::<HashSet<_>>(),
                    batch_ids.into_iter().collect::<HashSet<_>>(),
                    settings_ids.into_iter().collect::<HashSet<_>>(),
                    equipment_profile_ids.into_iter().collect::<HashSet<_>>(),
                    inventory_item_ids.into_iter().collect::<HashSet<_>>(),
                )
            }
            _ => return Err(SyncError::Protocol("Expected Hello from server".into())),
        };

    // Handshake complete — mark as connected
    log::info!("[sync] connected, handshake complete");
    on_status(SyncStatus::Connected);

    // Send NewDoc for docs only we have
    let local_sets: [(DocType, HashSet<String>, &HashSet<String>); 5] = [
        (
            DocType::Recipe,
            local_recipe_ids.into_iter().collect(),
            &server_recipe_ids,
        ),
        (
            DocType::Batch,
            local_batch_ids.into_iter().collect(),
            &server_batch_ids,
        ),
        (
            DocType::Settings,
            local_settings_ids.into_iter().collect(),
            &server_settings_ids,
        ),
        (
            DocType::EquipmentProfile,
            local_equipment_profile_ids.into_iter().collect(),
            &server_equipment_profile_ids,
        ),
        (
            DocType::InventoryItem,
            local_inventory_item_ids.into_iter().collect(),
            &server_inventory_item_ids,
        ),
    ];

    for (doc_type, local_ids, server_ids) in &local_sets {
        for id in local_ids.difference(server_ids) {
            let am_data = db::get_doc_am_data(conn, *doc_type, id)?;
            if let Some(am_data) = am_data {
                log::debug!("[sync] sending NewDoc {:?}/{}", doc_type, id);
                let msg = SyncMessage::NewDoc {
                    doc_type: *doc_type,
                    doc_id: id.clone(),
                    am_data,
                };
                ws_tx
                    .send(Message::Text(serde_json::to_string(&msg)?.into()))
                    .await?;
                db::clear_dirty_doc(conn, *doc_type, id)?;
            }
        }
    }

    // --- Steady-state loop ---
    let mut dirty_interval = interval(DIRTY_CHECK_INTERVAL);

    loop {
        let ws_future = ws_rx.next();
        let tick_future = dirty_interval.tick();
        pin_mut!(ws_future, tick_future);

        match select(ws_future, tick_future).await {
            Either::Left((msg, _)) => match msg {
                Some(Ok(Message::Text(text))) => {
                    handle_incoming(conn, &mut sessions, &mut ws_tx, &text, &on_change).await?;
                }
                Some(Ok(Message::Close(_))) | None => {
                    log::info!("[sync] connection closed");
                    on_status(SyncStatus::Disconnected);
                    return Ok(());
                }
                Some(Err(e)) => {
                    log::info!("[sync] connection error: {}", e);
                    on_status(SyncStatus::Disconnected);
                    return Err(e.into());
                }
                _ => {}
            },
            Either::Right((_, _)) => {
                let dirty = db::list_dirty_docs(conn)?;
                if !dirty.is_empty() {
                    log::debug!("[sync] dirty check: {} docs", dirty.len());
                }
                for (doc_type, id) in &dirty {
                    send_sync_for_doc(conn, &mut sessions, &mut ws_tx, *doc_type, id).await?;
                }
            }
        }
    }
}

/// Get or create a persistent SyncSession for a document.
fn get_or_create_session<'a>(
    conn: &(impl Connection + Sync),
    sessions: &'a mut Sessions,
    doc_type: DocType,
    doc_id: &str,
) -> Option<&'a mut SyncSession> {
    let key = (doc_type, doc_id.to_string());
    if !sessions.contains_key(&key) {
        let am_data = db::get_doc_am_data(conn, doc_type, doc_id).ok().flatten();
        if let Some(am_data) = am_data {
            sessions.insert(key.clone(), SyncSession::from_doc_bytes(&am_data));
        } else {
            return None;
        }
    }
    sessions.get_mut(&key)
}

/// Generate and send a sync message for a single document using a persistent session.
async fn send_sync_for_doc(
    conn: &(impl Connection + Sync),
    sessions: &mut Sessions,
    ws_tx: &mut SplitSink<WebSocketStream, Message>,
    doc_type: DocType,
    doc_id: &str,
) -> Result<(), SyncError> {
    let session = match get_or_create_session(conn, sessions, doc_type, doc_id) {
        Some(s) => s,
        None => return Ok(()),
    };

    // Merge latest DB state into the session (picks up local edits)
    let am_data = db::get_doc_am_data(conn, doc_type, doc_id)?;
    if let Some(am_data) = am_data {
        session.merge_doc(&am_data);
    }

    // Log the session state when sending
    if doc_type == DocType::Recipe {
        let snap = session.save_doc();
        match crate::automerge::hydrate_from_automerge::<crate::recipe::RecipeDocument>(&snap) {
            Ok(doc) => log::info!(
                "[sync] send_sync_for_doc {:?}/{}: batch_size.value={}",
                doc_type, doc_id, doc.recipe.batch_size.value
            ),
            Err(e) => log::warn!(
                "[sync] send_sync_for_doc {:?}/{}: hydration FAILED: {:?}",
                doc_type, doc_id, e
            ),
        }
        // Restore session state — save_doc was only for logging
        session.merge_doc(&snap);
    }

    if let Some(sync_msg_bytes) = session.generate_sync_message() {
        log::debug!("[sync] sending SyncDoc {:?}/{}", doc_type, doc_id);
        let msg = SyncMessage::SyncDoc {
            doc_type,
            doc_id: doc_id.to_string(),
            data: sync_msg_bytes,
        };
        ws_tx
            .send(Message::Text(serde_json::to_string(&msg)?.into()))
            .await?;
    } else {
        log::debug!("[sync] send_sync_for_doc {:?}/{}: already synced, nothing to send", doc_type, doc_id);
    }

    db::clear_dirty_doc(conn, doc_type, doc_id)?;

    Ok(())
}

/// Handle an incoming WebSocket message from the server using persistent sessions.
async fn handle_incoming(
    conn: &(impl Connection + Sync),
    sessions: &mut Sessions,
    ws_tx: &mut SplitSink<WebSocketStream, Message>,
    text: &str,
    on_change: &impl Fn(DocType),
) -> Result<(), SyncError> {
    let msg: SyncMessage = serde_json::from_str(text)?;

    match msg {
        SyncMessage::NewDoc {
            doc_type,
            doc_id,
            am_data,
        } => {
            log::debug!("[sync] received NewDoc {:?}/{}", doc_type, doc_id);
            db::apply_remote_merge_doc(conn, doc_type, &doc_id, &am_data)?;
            sessions.insert(
                (doc_type, doc_id),
                SyncSession::from_doc_bytes(&am_data),
            );
            on_change(doc_type);
        }
        SyncMessage::SyncDoc {
            doc_type,
            doc_id,
            data,
        } => {
            log::debug!(
                "[sync] received SyncDoc {:?}/{} ({} bytes)",
                doc_type,
                doc_id,
                data.len()
            );
            let session = match get_or_create_session(conn, sessions, doc_type, &doc_id) {
                Some(s) => s,
                None => return Ok(()),
            };

            let reply = session.receive_sync_message(&data).map_err(|e| {
                SyncError::Protocol(format!("Sync error: {}", e))
            })?;

            if let Some(ref reply_bytes) = reply {
                let reply_msg = SyncMessage::SyncDoc {
                    doc_type,
                    doc_id: doc_id.clone(),
                    data: reply_bytes.clone(),
                };
                ws_tx
                    .send(Message::Text(serde_json::to_string(&reply_msg)?.into()))
                    .await?;
            }

            // Save the merged doc to DB
            let saved = session.save_doc();

            // Log the hydrated state of the merged session doc
            if doc_type == DocType::Recipe {
                match crate::automerge::hydrate_from_automerge::<crate::recipe::RecipeDocument>(&saved) {
                    Ok(doc) => log::info!(
                        "[sync] handle_incoming SyncDoc {:?}/{}: session hydrates to batch_size.value={}, reply={}",
                        doc_type, doc_id, doc.recipe.batch_size.value, reply.is_some()
                    ),
                    Err(e) => log::warn!(
                        "[sync] handle_incoming SyncDoc {:?}/{}: session hydration FAILED: {:?}",
                        doc_type, doc_id, e
                    ),
                }
            }

            db::apply_remote_merge_doc(conn, doc_type, &doc_id, &saved)?;
            if reply.is_none() {
                db::clear_dirty_doc(conn, doc_type, &doc_id)?;
            }
            on_change(doc_type);
        }
        SyncMessage::Hello { .. } => {
            // Unexpected mid-session Hello, ignore
        }
        SyncMessage::Reject { .. } => {
            // Unexpected mid-session Reject, ignore
        }
    }

    Ok(())
}

/// Shared state for a background sync worker, bundling the atomic flags
/// that the UI reads to show sync status and detect remote changes.
#[cfg(feature = "native")]
pub struct SyncHandle {
    /// Sync status code — see `SYNC_STATUS_*` constants.
    pub status: std::sync::Arc<std::sync::atomic::AtomicU8>,
    /// Set to `true` whenever a remote change is applied to the DB.
    pub changed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(feature = "native")]
impl SyncHandle {
    pub fn new() -> Self {
        Self {
            status: std::sync::Arc::new(std::sync::atomic::AtomicU8::new(SYNC_STATUS_DISCONNECTED)),
            changed: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

/// Build a WebSocket URL with optional auth token appended as query parameter.
pub fn build_ws_url(server_url: &str, auth_token: Option<&str>) -> String {
    match auth_token {
        Some(token) if !token.is_empty() => {
            if server_url.contains('?') {
                format!("{}&token={}", server_url, token)
            } else {
                format!("{}?token={}", server_url, token)
            }
        }
        _ => server_url.to_string(),
    }
}

/// Spawn a background sync worker (native only).
/// Connects to the given WebSocket server URL with automatic reconnection.
/// Keeps retrying on version mismatch (server may be restarted/upgraded).
/// If `auth_token` is set (e.g. from BREWDIO_AUTH_TOKEN env var), it will be
/// appended as `?token=<value>` to the WebSocket URL.
#[cfg(feature = "native")]
pub fn spawn_sync(
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    server_url: String,
    auth_token: Option<String>,
    handle: &SyncHandle,
) -> tokio::task::JoinHandle<()> {
    let status = handle.status.clone();
    let changed = handle.changed.clone();
    let ws_url = build_ws_url(&server_url, auth_token.as_deref());
    tokio::spawn(async move {
        loop {
            let result = run_sync(
                &*conn,
                &ws_url,
                |s| {
                    let code = match &s {
                        SyncStatus::Connected => SYNC_STATUS_CONNECTED,
                        SyncStatus::Disconnected => SYNC_STATUS_DISCONNECTED,
                        SyncStatus::VersionMismatch { local_version, remote_version } => {
                            if local_version < remote_version {
                                SYNC_STATUS_CLIENT_OUTDATED
                            } else {
                                SYNC_STATUS_SERVER_OUTDATED
                            }
                        }
                    };
                    status.store(code, std::sync::atomic::Ordering::Relaxed);
                },
                |_| changed.store(true, std::sync::atomic::Ordering::Relaxed),
            )
            .await;

            // On version mismatch, show the appropriate status but keep retrying
            // (the server may be restarted/upgraded)
            if let Err(SyncError::VersionMismatch { local_version, remote_version }) = result {
                log::warn!("[sync] version mismatch (local={}, remote={}), will retry", local_version, remote_version);
                let code = if local_version < remote_version {
                    SYNC_STATUS_CLIENT_OUTDATED
                } else {
                    SYNC_STATUS_SERVER_OUTDATED
                };
                status.store(code, std::sync::atomic::Ordering::Relaxed);
            } else {
                status.store(SYNC_STATUS_DISCONNECTED, std::sync::atomic::Ordering::Relaxed);
            }

            sleep(RECONNECT_DELAY).await;
        }
    })
}
