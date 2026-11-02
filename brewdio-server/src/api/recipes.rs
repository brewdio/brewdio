use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use brewdio_core::beerjson_types::VolumeType;
use brewdio_persistence::connection::DbError;
use brewdio_persistence::protocol::DocType;
use brewdio_persistence::recipe::Recipe;
use serde::Serialize;

use crate::auth::middleware::ApiKeyUser;
use crate::auth::routes::AppState;
use crate::user_db;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub recipe_type: String,
    pub batch_size: VolumeType,
    pub equipment_id: Option<String>,
}

impl From<Recipe> for RecipeSummary {
    fn from(recipe: Recipe) -> Self {
        Self {
            id: recipe.id,
            name: recipe.name,
            author: recipe.recipe.author,
            recipe_type: recipe.recipe.type_.to_string(),
            batch_size: recipe.recipe.batch_size,
            equipment_id: recipe.equipment_id,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeListResponse {
    pub recipes: Vec<RecipeSummary>,
    pub count: usize,
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

fn list_recipes_for_user(
    conn: &rusqlite::Connection,
    user_id: &str,
) -> Result<Vec<Recipe>, DbError> {
    let ids = user_db::list_all_doc_ids_for_user(conn, DocType::Recipe, user_id)?;
    let mut recipes = ids
        .into_iter()
        .filter_map(|id| match brewdio_persistence::db::get_recipe(conn, &id) {
            Ok(Some(recipe)) => Some(Ok(recipe)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;
    recipes.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(recipes)
}

fn get_recipe_for_user(
    conn: &rusqlite::Connection,
    user_id: &str,
    recipe_id: &str,
) -> Result<Option<Recipe>, DbError> {
    if !user_db::doc_owned_by_user(conn, DocType::Recipe, recipe_id, user_id)? {
        return Ok(None);
    }
    brewdio_persistence::db::get_recipe(conn, recipe_id)
}

pub async fn list_recipes(
    api_user: ApiKeyUser,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !api_user.has_scope("recipes:read") {
        return json_error(StatusCode::FORBIDDEN, "API token lacks recipes:read scope");
    }

    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match list_recipes_for_user(&conn, &api_user.user_id) {
        Ok(recipes) => {
            let recipes = recipes
                .into_iter()
                .map(RecipeSummary::from)
                .collect::<Vec<_>>();
            let count = recipes.len();
            Json(RecipeListResponse { recipes, count }).into_response()
        }
        Err(error) => {
            eprintln!("[api] failed to list recipes: {}", error);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list recipes")
        }
    }
}

pub async fn get_recipe(
    api_user: ApiKeyUser,
    State(state): State<Arc<AppState>>,
    Path(recipe_id): Path<String>,
) -> Response {
    if !api_user.has_scope("recipes:read") {
        return json_error(StatusCode::FORBIDDEN, "API token lacks recipes:read scope");
    }

    let conn = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match get_recipe_for_user(&conn, &api_user.user_id, &recipe_id) {
        Ok(Some(recipe)) => Json(recipe).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Recipe not found"),
        Err(error) => {
            eprintln!("[api] failed to get recipe: {}", error);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get recipe")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::beerjson_types::RecipeType;
    use brewdio_persistence::{connection_native, db as persistence_db};

    fn sample_recipe(name: &str) -> RecipeType {
        serde_json::from_value(serde_json::json!({
            "name": name,
            "type": "all grain",
            "author": "Tester",
            "batch_size": { "unit": "l", "value": 20.0 },
            "efficiency": { "brewhouse": { "unit": "%", "value": 72.0 } },
            "ingredients": { "fermentable_additions": [], "hop_additions": [] }
        }))
        .unwrap()
    }

    #[test]
    fn recipe_queries_are_scoped_to_user() {
        let conn = connection_native::open(":memory:").unwrap();
        crate::db::run_server_migrations(&conn).unwrap();
        crate::db::create_user(&conn, "user-1", "one@example.com", None, None, "", false)
            .unwrap();
        crate::db::create_user(&conn, "user-2", "two@example.com", None, None, "", false)
            .unwrap();

        let first = persistence_db::create_recipe(
            &conn,
            "Alpha IPA",
            &sample_recipe("Alpha IPA"),
            None,
            None,
        )
        .unwrap();
        let second = persistence_db::create_recipe(
            &conn,
            "Beta Stout",
            &sample_recipe("Beta Stout"),
            None,
            None,
        )
        .unwrap();
        user_db::set_doc_user_id(&conn, DocType::Recipe, &first.id, "user-1").unwrap();
        user_db::set_doc_user_id(&conn, DocType::Recipe, &second.id, "user-2").unwrap();

        let recipes = list_recipes_for_user(&conn, "user-1").unwrap();
        assert_eq!(recipes.len(), 1);
        assert_eq!(recipes[0].name, "Alpha IPA");
        assert!(get_recipe_for_user(&conn, "user-1", &first.id)
            .unwrap()
            .is_some());
        assert!(get_recipe_for_user(&conn, "user-1", &second.id)
            .unwrap()
            .is_none());
    }
}
