use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use super::config::AuthConfig;
use super::google;
use super::jwt::encode_token;
use super::models::*;
use super::password;
use crate::db;

pub struct AppState {
    pub conn: Arc<Mutex<rusqlite::Connection>>,
    pub auth_config: AuthConfig,
}

// Implement AsRef<AuthConfig> for AppState so middleware can access it
impl AsRef<AuthConfig> for AppState {
    fn as_ref(&self) -> &AuthConfig {
        &self.auth_config
    }
}

/// POST /auth/register
pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    if !state.auth_config.allow_signups {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Signups are disabled" })),
        );
    }

    let email = req.email.trim().to_lowercase();
    if email.is_empty() || req.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Email and password are required" })),
        );
    }

    if req.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Password must be at least 8 characters" })),
        );
    }

    // Check if user already exists
    {
        let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(Some(_)) = db::get_user_by_email(&*c, &email) {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({ "error": "Email already registered" })),
            );
        }
    }

    let hash = match password::hash_password(&req.password) {
        Ok(h) => h,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Internal server error" })),
            );
        }
    };

    let id = ulid::Ulid::new().to_string().to_lowercase();

    {
        let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = db::create_user(&*c, &id, &email, Some(&hash), None, "", false) {
            eprintln!("[auth] failed to create user: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to create user" })),
            );
        }
        if let Err(e) = db::claim_unowned_data_if_only_user(&*c, &id) {
            eprintln!("[auth] failed to claim unowned data for first user: {}", e);
        }
    }

    let user = db::UserRow {
        id,
        email,
        password_hash: Some(hash),
        google_id: None,
        display_name: String::new(),
        is_admin: false,
    };

    match encode_token(&user, &state.auth_config.jwt_secret) {
        Ok(token) => (StatusCode::CREATED, Json(serde_json::json!({ "token": token }))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to create token" })),
        ),
    }
}

/// POST /auth/login
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let email = req.email.trim().to_lowercase();

    let user = {
        let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
        db::get_user_by_email(&*c, &email)
    };

    let user = match user {
        Ok(Some(u)) => u,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid email or password" })),
            );
        }
    };

    let hash = match &user.password_hash {
        Some(h) => h,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid email or password" })),
            );
        }
    };

    match password::verify_password(&req.password, hash) {
        Ok(true) => {}
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid email or password" })),
            );
        }
    }

    // A single-user server can safely assign data created before auth existed.
    let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
    if let Err(e) = db::claim_unowned_data_if_only_user(&*c, &user.id) {
        eprintln!("[auth] failed to claim unowned data for only user: {}", e);
    }

    match encode_token(&user, &state.auth_config.jwt_secret) {
        Ok(token) => (StatusCode::OK, Json(serde_json::json!({ "token": token }))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to create token" })),
        ),
    }
}

/// POST /auth/google
pub async fn google_login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GoogleLoginRequest>,
) -> impl IntoResponse {
    let client_id = match &state.auth_config.google_client_id {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Google OAuth is not configured" })),
            );
        }
    };

    let token_info = match google::verify_google_token(&req.id_token, &client_id).await {
        Ok(info) => info,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": e })),
            );
        }
    };

    // Find or create user by google_id
    let user = {
        let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
        match db::get_user_by_google_id(&*c, &token_info.sub) {
            Ok(Some(u)) => u,
            _ => {
                // Check if user exists by email (link accounts)
                match db::get_user_by_email(&*c, &token_info.email) {
                    Ok(Some(u)) => u,
                    _ => {
                        // Create new user
                        if !state.auth_config.allow_signups {
                            return (
                                StatusCode::FORBIDDEN,
                                Json(serde_json::json!({ "error": "Signups are disabled" })),
                            );
                        }
                        let id = ulid::Ulid::new().to_string().to_lowercase();
                        let display_name = token_info.name.as_deref().unwrap_or("");
                        if let Err(e) = db::create_user(
                            &*c,
                            &id,
                            &token_info.email,
                            None,
                            Some(&token_info.sub),
                            display_name,
                            false,
                        ) {
                            eprintln!("[auth] failed to create Google user: {}", e);
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({ "error": "Failed to create user" })),
                            );
                        }
                        db::UserRow {
                            id,
                            email: token_info.email.clone(),
                            password_hash: None,
                            google_id: Some(token_info.sub),
                            display_name: display_name.to_string(),
                            is_admin: false,
                        }
                    }
                }
            }
        }
    };

    let c = state.conn.lock().unwrap_or_else(|e| e.into_inner());
    if let Err(e) = db::claim_unowned_data_if_only_user(&*c, &user.id) {
        eprintln!("[auth] failed to claim unowned data for only user: {}", e);
    }

    match encode_token(&user, &state.auth_config.jwt_secret) {
        Ok(token) => (StatusCode::OK, Json(serde_json::json!({ "token": token }))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to create token" })),
        ),
    }
}
