use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};

use brewdio_persistence::connection::SCHEMA_VERSION;
use brewdio_persistence::db;
use brewdio_persistence::protocol::{DocType, SyncMessage};
use brewdio_persistence::sync::SyncSession;

use crate::auth::config::AuthConfig;
use crate::auth::jwt::decode_token;

const PEER_ID: &str = "client";
const DIRTY_CHECK_INTERVAL: Duration = Duration::from_secs(2);

type WsSender = SplitSink<WebSocket, Message>;
type OwnerId = Option<String>;
type SyncNotification = (OwnerId, DocType, String);

/// Persistent sync sessions keyed by (DocType, doc_id), kept alive for the connection.
type Sessions = HashMap<(DocType, String), SyncSession>;

/// Shared server state: DB connection + broadcast channel for cross-client notification.
#[derive(Clone)]
pub struct ServerState {
    pub conn: Arc<Mutex<rusqlite::Connection>>,
    pub notify_tx: broadcast::Sender<SyncNotification>,
    pub auth_config: AuthConfig,
}

#[derive(Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

fn list_doc_ids_for_owner(
    conn: &rusqlite::Connection,
    doc_type: DocType,
    user_id: &OwnerId,
) -> Result<Vec<String>, brewdio_persistence::connection::DbError> {
    match user_id {
        Some(user_id) => crate::user_db::list_all_doc_ids_for_user(conn, doc_type, user_id),
        None => db::list_all_doc_ids(conn, doc_type),
    }
}

fn list_dirty_docs_for_owner(
    conn: &rusqlite::Connection,
    user_id: &OwnerId,
) -> Result<Vec<(DocType, String)>, brewdio_persistence::connection::DbError> {
    match user_id {
        Some(user_id) => crate::user_db::list_dirty_docs_for_user(conn, user_id),
        None => db::list_dirty_docs(conn),
    }
}

fn owner_can_access_doc(
    conn: &rusqlite::Connection,
    doc_type: DocType,
    doc_id: &str,
    user_id: &OwnerId,
) -> Result<bool, brewdio_persistence::connection::DbError> {
    match user_id {
        Some(user_id) => crate::user_db::doc_owned_by_user(conn, doc_type, doc_id, user_id),
        None => Ok(true),
    }
}

fn apply_new_doc_for_owner(
    conn: &rusqlite::Connection,
    doc_type: DocType,
    doc_id: &str,
    am_data: &[u8],
    user_id: &OwnerId,
) -> Result<(), brewdio_persistence::connection::DbError> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        let exists = db::get_doc_am_data(conn, doc_type, doc_id)?.is_some();
        if exists && !owner_can_access_doc(conn, doc_type, doc_id, user_id)? {
            return Err(brewdio_persistence::connection::DbError(
                "Document belongs to another user".to_string(),
            ));
        }

        db::apply_remote_merge_doc(conn, doc_type, doc_id, am_data)?;
        if !exists {
            if let Some(user_id) = user_id {
                crate::user_db::set_doc_user_id(conn, doc_type, doc_id, user_id)?;
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    let user_id = if state.auth_config.no_auth {
        None
    } else {
        let token = match query.token {
            Some(t) => t,
            None => {
                return (StatusCode::UNAUTHORIZED, "Missing authentication token").into_response();
            }
        };
        match decode_token(&token, &state.auth_config.jwt_secret) {
            Ok(claims) => Some(claims.sub),
            Err(_) => {
                return (StatusCode::UNAUTHORIZED, "Invalid or expired token").into_response();
            }
        }
    };
    eprintln!("[server] client connected");
    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

async fn handle_socket(socket: WebSocket, state: ServerState, user_id: OwnerId) {
    if let Err(e) = run_sync(socket, state, user_id).await {
        eprintln!("[server] sync error: {}", e);
    }
    eprintln!("[server] client disconnected");
}

async fn run_sync(
    socket: WebSocket,
    state: ServerState,
    user_id: OwnerId,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conn = &state.conn;
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut sessions: Sessions = HashMap::new();
    let mut notify_rx = state.notify_tx.subscribe();

    // --- Wait for client Hello ---
    let client_hello = loop {
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

    let (client_recipe_ids, client_batch_ids, client_settings_ids, client_equipment_profile_ids, client_inventory_item_ids) = match client_hello {
        SyncMessage::Hello {
            recipe_ids,
            batch_ids,
            settings_ids,
            equipment_profile_ids,
            inventory_item_ids,
            schema_version,
        } => {
            eprintln!(
                "[server] received Hello with {} recipe(s), {} batch(es), {} settings, {} equipment_profile(s), {} inventory item(s), schema_version={}",
                recipe_ids.len(),
                batch_ids.len(),
                settings_ids.len(),
                equipment_profile_ids.len(),
                inventory_item_ids.len(),
                schema_version,
            );

            // Reject client if schema version doesn't match
            if schema_version != SCHEMA_VERSION {
                eprintln!(
                    "[server] version mismatch: client={}, server={} — rejecting",
                    schema_version, SCHEMA_VERSION
                );
                let reject = SyncMessage::Reject {
                    reason: format!(
                        "Schema version mismatch: client={}, server={}",
                        schema_version, SCHEMA_VERSION
                    ),
                    server_version: SCHEMA_VERSION,
                    client_version: schema_version,
                };
                ws_tx
                    .send(Message::Text(serde_json::to_string(&reject)?.into()))
                    .await?;
                return Ok(());
            }

            (
                recipe_ids.into_iter().collect::<HashSet<_>>(),
                batch_ids.into_iter().collect::<HashSet<_>>(),
                settings_ids.into_iter().collect::<HashSet<_>>(),
                equipment_profile_ids.into_iter().collect::<HashSet<_>>(),
                inventory_item_ids.into_iter().collect::<HashSet<_>>(),
            )
        }
        _ => return Err("Expected Hello from client".into()),
    };

    // Clear stale sync states from any previous connection
    {
        let c = conn.lock().unwrap_or_else(|e| e.into_inner());
        db::clear_sync_states_for_peer(&*c, PEER_ID)?;
    }

    // --- Send server Hello ---
    let (local_recipe_ids, local_batch_ids, local_settings_ids, local_equipment_profile_ids, local_inventory_item_ids) = {
        let c = conn.lock().unwrap_or_else(|e| e.into_inner());
        (
            list_doc_ids_for_owner(&c, DocType::Recipe, &user_id)?,
            list_doc_ids_for_owner(&c, DocType::Batch, &user_id)?,
            list_doc_ids_for_owner(&c, DocType::Settings, &user_id)?,
            list_doc_ids_for_owner(&c, DocType::EquipmentProfile, &user_id)?,
            list_doc_ids_for_owner(&c, DocType::InventoryItem, &user_id)?,
        )
    };
    eprintln!(
        "[server] sending Hello with {} recipe(s), {} batch(es), {} settings, {} equipment_profile(s), {} inventory item(s)",
        local_recipe_ids.len(),
        local_batch_ids.len(),
        local_settings_ids.len(),
        local_equipment_profile_ids.len(),
        local_inventory_item_ids.len()
    );
    let hello = SyncMessage::Hello {
        recipe_ids: local_recipe_ids.clone(),
        batch_ids: local_batch_ids.clone(),
        settings_ids: local_settings_ids.clone(),
        equipment_profile_ids: local_equipment_profile_ids.clone(),
        inventory_item_ids: local_inventory_item_ids.clone(),
        schema_version: SCHEMA_VERSION,
    };
    ws_tx
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    // Send NewDoc for server-only docs and initiate sync for shared docs
    let local_sets: [(DocType, HashSet<String>, &HashSet<String>); 5] = [
        (DocType::Recipe, local_recipe_ids.into_iter().collect(), &client_recipe_ids),
        (DocType::Batch, local_batch_ids.into_iter().collect(), &client_batch_ids),
        (DocType::Settings, local_settings_ids.into_iter().collect(), &client_settings_ids),
        (DocType::EquipmentProfile, local_equipment_profile_ids.into_iter().collect(), &client_equipment_profile_ids),
        (DocType::InventoryItem, local_inventory_item_ids.into_iter().collect(), &client_inventory_item_ids),
    ];

    for (doc_type, local_ids, client_ids) in &local_sets {
        // Send NewDoc for server-only docs
        let server_only: Vec<_> = local_ids.difference(client_ids).cloned().collect();
        if !server_only.is_empty() {
            eprintln!(
                "[server] sending {} NewDoc(s) for server-only {:?}",
                server_only.len(),
                doc_type
            );
        }
        for id in &server_only {
            let am_data = {
                let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                db::get_doc_am_data(&*c, *doc_type, id)?
            };
            if let Some(am_data) = am_data {
                let msg = SyncMessage::NewDoc {
                    doc_type: *doc_type,
                    doc_id: id.clone(),
                    am_data,
                };
                ws_tx
                    .send(Message::Text(serde_json::to_string(&msg)?.into()))
                    .await?;
                let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                db::clear_dirty_doc(&*c, *doc_type, id)?;
            }
        }

        // Initiate sync for shared docs
        let shared_ids: Vec<String> = local_ids.intersection(client_ids).cloned().collect();
        if !shared_ids.is_empty() {
            eprintln!(
                "[server] initiating sync for {} shared {:?}(s)",
                shared_ids.len(),
                doc_type
            );
        }
        for id in &shared_ids {
            send_sync_for_doc(conn, &mut sessions, &mut ws_tx, *doc_type, id, &user_id).await?;
        }
    }

    eprintln!("[server] entering steady-state sync loop");

    // --- Steady-state loop ---
    let mut dirty_interval = interval(DIRTY_CHECK_INTERVAL);

    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_incoming(conn, &state.notify_tx, &mut sessions, &mut ws_tx, &text, &user_id).await?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return Ok(());
                    }
                    Some(Err(e)) => return Err(e.into()),
                    _ => {}
                }
            }
            // Broadcast notification: another connection received a change
            notification = notify_rx.recv() => {
                if let Ok((notification_owner, doc_type, doc_id)) = notification {
                    if notification_owner == user_id {
                        eprintln!("[server] broadcast: pushing {:?}/{} to client", doc_type, doc_id);
                        send_sync_for_doc(conn, &mut sessions, &mut ws_tx, doc_type, &doc_id, &user_id).await?;
                    }
                }
            }
            _ = dirty_interval.tick() => {
                let dirty = {
                    let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                    list_dirty_docs_for_owner(&c, &user_id)?
                };
                if !dirty.is_empty() {
                    eprintln!("[server] pushing {} dirty doc(s)", dirty.len());
                }
                for (doc_type, id) in &dirty {
                    send_sync_for_doc(conn, &mut sessions, &mut ws_tx, *doc_type, id, &user_id).await?;
                }
            }
        }
    }
}

/// Get or create a persistent SyncSession for a document.
fn get_or_create_session<'a>(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    sessions: &'a mut Sessions,
    doc_type: DocType,
    doc_id: &str,
) -> Option<&'a mut SyncSession> {
    let key = (doc_type, doc_id.to_string());
    if !sessions.contains_key(&key) {
        let am_data = {
            let c = conn.lock().unwrap_or_else(|e| e.into_inner());
            db::get_doc_am_data(&*c, doc_type, doc_id).ok().flatten()
        };
        if let Some(am_data) = am_data {
            sessions.insert(key.clone(), SyncSession::from_doc_bytes(&am_data));
        } else {
            return None;
        }
    }
    sessions.get_mut(&key)
}

async fn send_sync_for_doc(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    sessions: &mut Sessions,
    ws_tx: &mut WsSender,
    doc_type: DocType,
    doc_id: &str,
    user_id: &OwnerId,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    {
        let c = conn.lock().unwrap_or_else(|e| e.into_inner());
        if !owner_can_access_doc(&c, doc_type, doc_id, user_id)? {
            return Ok(());
        }
    }

    let session = match get_or_create_session(conn, sessions, doc_type, doc_id) {
        Some(s) => s,
        None => return Ok(()),
    };

    // Merge latest DB state into the session (picks up local edits)
    let am_data = {
        let c = conn.lock().unwrap_or_else(|e| e.into_inner());
        db::get_doc_am_data(&*c, doc_type, doc_id)?
    };
    if let Some(am_data) = am_data {
        session.merge_doc(&am_data);
    }

    if let Some(sync_msg_bytes) = session.generate_sync_message() {
        eprintln!("[server] sending SyncDoc for {:?}/{}", doc_type, doc_id);
        let msg = SyncMessage::SyncDoc {
            doc_type,
            doc_id: doc_id.to_string(),
            data: sync_msg_bytes,
        };
        ws_tx
            .send(Message::Text(serde_json::to_string(&msg)?.into()))
            .await?;
    }

    {
        let c = conn.lock().unwrap_or_else(|e| e.into_inner());
        db::clear_dirty_doc(&*c, doc_type, doc_id)?;
    }

    Ok(())
}

/// Handle an incoming WebSocket message from a client using persistent sessions.
/// Broadcasts notifications to other connections when changes are received.
async fn handle_incoming(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    notify_tx: &broadcast::Sender<SyncNotification>,
    sessions: &mut Sessions,
    ws_tx: &mut WsSender,
    text: &str,
    user_id: &OwnerId,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let msg: SyncMessage = serde_json::from_str(text)?;

    match msg {
        SyncMessage::NewDoc {
            doc_type,
            doc_id,
            ref am_data,
        } => {
            eprintln!(
                "[server] received NewDoc for {:?}/{} ({} bytes)",
                doc_type,
                doc_id,
                am_data.len()
            );
            let c = conn.lock().unwrap_or_else(|e| e.into_inner());
            apply_new_doc_for_owner(&c, doc_type, &doc_id, am_data, user_id)?;
            sessions.insert(
                (doc_type, doc_id.clone()),
                SyncSession::from_doc_bytes(am_data),
            );
            // Notify other connections
            let _ = notify_tx.send((user_id.clone(), doc_type, doc_id));
        }
        SyncMessage::SyncDoc {
            doc_type,
            doc_id,
            data,
        } => {
            eprintln!("[server] received SyncDoc for {:?}/{}", doc_type, doc_id);

            {
                let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                if !owner_can_access_doc(&c, doc_type, &doc_id, user_id)? {
                    return Err("Document belongs to another user".into());
                }
            }

            let session = match get_or_create_session(conn, sessions, doc_type, &doc_id) {
                Some(s) => s,
                None => return Ok(()),
            };

            let reply = session.receive_sync_message(&data)?;

            if let Some(ref reply_bytes) = reply {
                eprintln!("[server] replying SyncDoc for {:?}/{}", doc_type, doc_id);
                let reply_msg = SyncMessage::SyncDoc {
                    doc_type,
                    doc_id: doc_id.clone(),
                    data: reply_bytes.clone(),
                };
                ws_tx
                    .send(Message::Text(serde_json::to_string(&reply_msg)?.into()))
                    .await?;
            } else {
                eprintln!("[server] converged for {:?}/{}", doc_type, doc_id);
            }

            // Save the merged doc to DB
            let saved = session.save_doc();
            let c = conn.lock().unwrap_or_else(|e| e.into_inner());
            db::apply_remote_merge_doc(&*c, doc_type, &doc_id, &saved)?;
            if reply.is_none() {
                db::clear_dirty_doc(&*c, doc_type, &doc_id)?;
            }
            // Notify other connections
            let _ = notify_tx.send((user_id.clone(), doc_type, doc_id));
        }
        SyncMessage::Hello { .. } => {
            eprintln!("[server] unexpected mid-session Hello, ignoring");
        }
        SyncMessage::Reject { .. } => {
            eprintln!("[server] unexpected Reject from client, ignoring");
        }
    }

    Ok(())
}
