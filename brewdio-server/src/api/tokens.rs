use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::auth::password;
use crate::auth::routes::AppState;
use crate::db::{self, ApiTokenRow};

const CRAFTBEERPI_SCOPES: &str = "recipes:read,batches:write";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIntegrationTokenRequest {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationTokenView {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

impl From<ApiTokenRow> for IntegrationTokenView {
    fn from(row: ApiTokenRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            key_prefix: row.key_prefix,
            scopes: row
                .scopes
                .split(',')
                .map(str::trim)
                .filter(|scope| !scope.is_empty())
                .map(str::to_string)
                .collect(),
            created_at: row.created_at,
            last_used_at: row.last_used_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIntegrationToken {
    pub token: String,
    pub integration_token: IntegrationTokenView,
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

pub async fn list_tokens(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Response {
    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match db::list_active_api_tokens_for_user(&*conn, &user.user_id) {
        Ok(tokens) => Json(
            tokens
                .into_iter()
                .map(IntegrationTokenView::from)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            eprintln!("[api] failed to list integration tokens: {}", error);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list integration tokens")
        }
    }
}

pub async fn create_token(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateIntegrationTokenRequest>,
) -> Response {
    let name = request.name.trim();
    if name.is_empty() || name.len() > 64 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Integration token name must be between 1 and 64 characters",
        );
    }

    let token = format!(
        "brewdio_{}{}",
        ulid::Ulid::new().to_string().to_lowercase(),
        ulid::Ulid::new().to_string().to_lowercase(),
    );
    let key_prefix: String = token.chars().take(20).collect();
    let token_hash = match password::hash_password(&token) {
        Ok(hash) => hash,
        Err(error) => {
            eprintln!("[api] failed to hash integration token: {}", error);
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create integration token",
            );
        }
    };
    let id = ulid::Ulid::new().to_string().to_lowercase();

    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match db::create_api_token(
        &*conn,
        &id,
        &user.user_id,
        name,
        &key_prefix,
        &token_hash,
        CRAFTBEERPI_SCOPES,
    ) {
        Ok(row) => (
            StatusCode::CREATED,
            Json(CreatedIntegrationToken {
                token,
                integration_token: row.into(),
            }),
        )
            .into_response(),
        Err(error) => {
            eprintln!("[api] failed to create integration token: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create integration token",
            )
        }
    }
}

pub async fn revoke_token(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(token_id): Path<String>,
) -> Response {
    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match db::revoke_api_token(&*conn, &token_id, &user.user_id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => json_error(StatusCode::NOT_FOUND, "Integration token not found"),
        Err(error) => {
            eprintln!("[api] failed to revoke integration token: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to revoke integration token",
            )
        }
    }
}
