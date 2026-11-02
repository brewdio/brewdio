use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{FromRequestParts, Query};
use axum::http::request::Parts;
use axum::http::StatusCode;
use serde::Deserialize;

use super::jwt::decode_token;
use crate::auth::routes::AppState;
use crate::db;

/// Authenticated user extracted from JWT in either:
/// 1. Authorization: Bearer <token> header
/// 2. ?token=<token> query parameter
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub email: String,
    pub is_admin: bool,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {

        // Try Authorization: Bearer <token> header first
        let token = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_string());

        // Fall back to ?token= query parameter
        let token = match token {
            Some(t) => t,
            None => {
                let Query(q) = Query::<TokenQuery>::try_from_uri(&parts.uri)
                    .map_err(|_| (StatusCode::UNAUTHORIZED, "Missing authentication token"))?;
                q.token
                    .ok_or((StatusCode::UNAUTHORIZED, "Missing authentication token"))?
            }
        };

        let claims = decode_token(&token, &state.auth_config.jwt_secret)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid or expired token"))?;

        Ok(AuthUser {
            user_id: claims.sub,
            email: claims.email,
            is_admin: claims.is_admin,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ApiKeyUser {
    pub user_id: String,
    pub token_id: String,
    pub scopes: HashSet<String>,
}

impl ApiKeyUser {
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.contains(scope)
    }
}

fn bearer_token(parts: &Parts) -> Option<&str> {
    parts
        .headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

fn authenticate_api_key(state: &AppState, token: &str) -> Option<ApiKeyUser> {
    if !token.starts_with("brewdio_") {
        return None;
    }
    let key_prefix: String = token.chars().take(20).collect();
    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    let candidates = db::list_active_api_tokens_by_prefix(&*conn, &key_prefix).ok()?;

    for candidate in candidates {
        if super::password::verify_password(token, &candidate.token_hash).unwrap_or(false) {
            if db::mark_api_token_used(&*conn, &candidate.id).is_err() {
                return None;
            }
            return Some(ApiKeyUser {
                user_id: candidate.user_id,
                token_id: candidate.id,
                scopes: candidate
                    .scopes
                    .split(',')
                    .map(str::trim)
                    .filter(|scope| !scope.is_empty())
                    .map(str::to_string)
                    .collect(),
            });
        }
    }
    None
}

impl FromRequestParts<Arc<AppState>> for ApiKeyUser {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)
            .ok_or((StatusCode::UNAUTHORIZED, "Missing API authentication token"))?;
        authenticate_api_key(state, token)
            .ok_or((StatusCode::UNAUTHORIZED, "Invalid or revoked API token"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::config::AuthConfig;
    use crate::auth::password::hash_password;
    use brewdio_persistence::connection_native;
    use std::sync::Mutex;

    fn state_with_token() -> (AppState, String, String) {
        let conn = connection_native::open(":memory:").unwrap();
        db::run_server_migrations(&conn).unwrap();
        db::create_user(&conn, "user-1", "one@example.com", None, None, "", false).unwrap();
        let token = "brewdio_01exampletoken01exampletoken01exampletoken".to_string();
        let prefix = token.chars().take(20).collect::<String>();
        let hash = hash_password(&token).unwrap();
        db::create_api_token(
            &conn,
            "token-1",
            "user-1",
            "CraftBeerPi",
            &prefix,
            &hash,
            "recipes:read,batches:write",
        )
        .unwrap();
        let state = AppState {
            conn: Arc::new(Mutex::new(conn)),
            auth_config: AuthConfig {
                jwt_secret: "test-secret".to_string(),
                allow_signups: true,
                google_client_id: None,
                admin_email: None,
                admin_password: None,
                no_auth: false,
            },
        };
        (state, token, prefix)
    }

    #[test]
    fn valid_api_key_authenticates_with_scopes() {
        let (state, token, _) = state_with_token();
        let user = authenticate_api_key(&state, &token).unwrap();
        assert_eq!(user.user_id, "user-1");
        assert!(user.has_scope("recipes:read"));
        assert!(user.has_scope("batches:write"));
    }

    #[test]
    fn invalid_and_revoked_api_keys_are_rejected() {
        let (state, token, _) = state_with_token();
        assert!(authenticate_api_key(&state, "brewdio_invalid").is_none());
        {
            let conn = state.conn.lock().unwrap();
            db::revoke_api_token(&*conn, "token-1", "user-1").unwrap();
        }
        assert!(authenticate_api_key(&state, &token).is_none());
    }
}
