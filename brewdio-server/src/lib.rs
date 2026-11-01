use std::sync::{Arc, Mutex};

use axum::http::Method;
use axum::routing::{delete, get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

pub mod api;
pub mod auth;
pub mod db;
mod user_db;
mod ws_handler;

use auth::config::AuthConfig;
use auth::routes::AppState;

pub fn start_server(
    listener: TcpListener,
    conn: Arc<Mutex<rusqlite::Connection>>,
    auth_config: AuthConfig,
) -> JoinHandle<()> {
    let (notify_tx, _) = tokio::sync::broadcast::channel(64);

    let state = Arc::new(AppState {
        conn: conn.clone(),
        auth_config: auth_config.clone(),
    });

    let ws_state = ws_handler::ServerState {
        conn,
        notify_tx,
        auth_config,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/ws", get(ws_handler::ws_upgrade))
        .with_state(ws_state)
        .route("/auth/register", post(auth::routes::register))
        .route("/auth/login", post(auth::routes::login))
        .route("/auth/google", post(auth::routes::google_login))
        .route(
            "/api/v1/integration-tokens",
            get(api::tokens::list_tokens).post(api::tokens::create_token),
        )
        .route(
            "/api/v1/integration-tokens/{id}",
            delete(api::tokens::revoke_token),
        )
        .route("/api/v1/recipes", get(api::recipes::list_recipes))
        .route("/api/v1/recipes/{id}", get(api::recipes::get_recipe))
        .route(
            "/api/v1/recipes/{id}/batches",
            post(api::batches::start_batch),
        )
        .with_state(state)
        .layer(cors);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    })
}
