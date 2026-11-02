use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use brewdio_core::beerjson_types::{
    CultureAdditionTypeAmount, FermentableAdditionTypeAmount, HopAdditionTypeAmount,
    MassType, MassUnitType, RecipeType, UnitType, VolumeType, VolumeUnitType,
};
use brewdio_core::inventory::{
    InventoryItem, InventoryQuantity, InventoryShortage,
};
use brewdio_persistence::batch::{
    Batch, BatchData, InventoryDeductionPlan, InventoryDeductionRequest,
};
use brewdio_persistence::connection::{Connection, DbError, Value};
use brewdio_persistence::protocol::DocType;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::ApiKeyUser;
use crate::auth::routes::AppState;
use crate::user_db;

const EPSILON: f64 = 0.000_001;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBatchRequest {
    pub idempotency_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBatchResponse {
    pub batch_id: String,
    pub batch_name: String,
    pub created: bool,
    pub inventory_deduction_count: usize,
    pub inventory_shortage_count: usize,
}

struct Requirement {
    kind: &'static str,
    name: String,
    quantity: InventoryQuantity,
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

fn quantity_to_base(quantity: &InventoryQuantity) -> f64 {
    match quantity {
        InventoryQuantity::Mass(value) => brewdio_core::units::mass_to_grams(value),
        InventoryQuantity::Volume(value) => {
            brewdio_core::units::volume_to_milliliters(value)
        }
        InventoryQuantity::Unit(value) => value.value,
    }
}

fn quantity_from_base(template: &InventoryQuantity, value: f64) -> InventoryQuantity {
    match template {
        InventoryQuantity::Mass(current) => {
            let value = match current.unit {
                MassUnitType::Mg => value * 1000.0,
                MassUnitType::G => value,
                MassUnitType::Kg => value / 1000.0,
                MassUnitType::Lb => value / 453.592,
                MassUnitType::Oz => value / 28.3495,
            };
            InventoryQuantity::Mass(MassType {
                unit: current.unit,
                value,
            })
        }
        InventoryQuantity::Volume(current) => {
            let value = match current.unit {
                VolumeUnitType::Ml => value,
                VolumeUnitType::L => value / 1000.0,
                VolumeUnitType::Tsp => value / 4.92892,
                VolumeUnitType::Tbsp => value / 14.7868,
                VolumeUnitType::Floz => value / 29.5735,
                VolumeUnitType::Cup => value / 236.588,
                VolumeUnitType::Pt => value / 473.176,
                VolumeUnitType::Qt => value / 946.353,
                VolumeUnitType::Gal => value / 3785.41,
                VolumeUnitType::Bbl => value / 117347.77,
                VolumeUnitType::Ifloz => value / 28.4131,
                VolumeUnitType::Ipt => value / 568.261,
                VolumeUnitType::Iqt => value / 1136.52,
                VolumeUnitType::Igal => value / 4546.09,
                VolumeUnitType::Ibbl => value / 163659.24,
            };
            InventoryQuantity::Volume(VolumeType {
                unit: current.unit,
                value,
            })
        }
        InventoryQuantity::Unit(current) => InventoryQuantity::Unit(UnitType {
            unit: current.unit,
            value,
        }),
    }
}

fn compatible(left: &InventoryQuantity, right: &InventoryQuantity) -> bool {
    match (left, right) {
        (InventoryQuantity::Mass(_), InventoryQuantity::Mass(_)) => true,
        (InventoryQuantity::Volume(_), InventoryQuantity::Volume(_)) => true,
        (InventoryQuantity::Unit(left), InventoryQuantity::Unit(right)) => {
            left.unit == right.unit
        }
        _ => false,
    }
}

fn recipe_requirements(recipe: &RecipeType) -> Vec<Requirement> {
    let mut requirements = Vec::new();
    for addition in &recipe.ingredients.fermentable_additions {
        let quantity = match &addition.amount {
            FermentableAdditionTypeAmount::MassType(value) => {
                InventoryQuantity::Mass(value.clone())
            }
            FermentableAdditionTypeAmount::VolumeType(value) => {
                InventoryQuantity::Volume(value.clone())
            }
        };
        requirements.push(Requirement {
            kind: "fermentable",
            name: addition.name.clone(),
            quantity,
        });
    }
    for addition in &recipe.ingredients.hop_additions {
        let quantity = match &addition.amount {
            HopAdditionTypeAmount::MassType(value) => InventoryQuantity::Mass(value.clone()),
            HopAdditionTypeAmount::VolumeType(value) => {
                InventoryQuantity::Volume(value.clone())
            }
        };
        requirements.push(Requirement {
            kind: "hop",
            name: addition.name.clone(),
            quantity,
        });
    }
    for addition in &recipe.ingredients.culture_additions {
        let quantity = match &addition.amount {
            CultureAdditionTypeAmount::MassType(value) => {
                InventoryQuantity::Mass(value.clone())
            }
            CultureAdditionTypeAmount::VolumeType(value) => {
                InventoryQuantity::Volume(value.clone())
            }
            CultureAdditionTypeAmount::UnitType(value) => {
                InventoryQuantity::Unit(value.clone())
            }
        };
        requirements.push(Requirement {
            kind: "culture",
            name: addition.name.clone(),
            quantity,
        });
    }
    requirements
}

fn build_inventory_plan(
    recipe: &RecipeType,
    inventory: &[InventoryItem],
    updated_at: String,
) -> InventoryDeductionPlan {
    let mut ordered_inventory = inventory.iter().collect::<Vec<_>>();
    ordered_inventory.sort_by(|left, right| {
        left.best_before
            .as_deref()
            .unwrap_or("9999-12-31")
            .cmp(right.best_before.as_deref().unwrap_or("9999-12-31"))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut remaining = inventory
        .iter()
        .map(|item| (item.id.clone(), quantity_to_base(&item.quantity)))
        .collect::<HashMap<_, _>>();
    let mut deductions = Vec::new();
    let mut shortages = Vec::new();

    for requirement in recipe_requirements(recipe) {
        let required = quantity_to_base(&requirement.quantity);
        let mut missing = required;
        for item in &ordered_inventory {
            if missing <= EPSILON {
                break;
            }
            if item.kind() != requirement.kind
                || !item.name().eq_ignore_ascii_case(&requirement.name)
                || !compatible(&item.quantity, &requirement.quantity)
            {
                continue;
            }
            let available = remaining.get(&item.id).copied().unwrap_or(0.0);
            let amount = available.min(missing);
            if amount <= EPSILON {
                continue;
            }
            deductions.push(InventoryDeductionRequest {
                inventory_item_id: item.id.clone(),
                quantity: quantity_from_base(&item.quantity, amount),
            });
            remaining.insert(item.id.clone(), available - amount);
            missing -= amount;
        }
        if missing > EPSILON {
            shortages.push(InventoryShortage {
                ingredient_name: requirement.name,
                required: requirement.quantity.clone(),
                missing: quantity_from_base(&requirement.quantity, missing),
            });
        }
    }

    InventoryDeductionPlan {
        deductions,
        shortages,
        updated_at,
    }
}

fn owned_inventory(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
) -> Result<Vec<InventoryItem>, DbError> {
    let ids = user_db::list_all_doc_ids_for_user(conn, DocType::InventoryItem, user_id)?;
    let mut items = Vec::new();
    for id in ids {
        if let Some(item) = brewdio_persistence::inventory::get_inventory_item(conn, &id)? {
            items.push(item);
        }
    }
    Ok(items)
}

fn batch_name(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
    recipe_id: &str,
    recipe_name: &str,
) -> Result<String, DbError> {
    let ids = user_db::list_all_doc_ids_for_user(conn, DocType::Batch, user_id)?;
    let mut count = 0;
    for id in ids {
        if let Some(batch) = brewdio_persistence::batch::get_batch(conn, &id)? {
            if batch.recipe_id == recipe_id {
                count += 1;
            }
        }
    }
    Ok(format!("{} – brygg {}", recipe_name, count + 1))
}

fn existing_batch_id(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
    idempotency_key: &str,
) -> Result<Option<String>, DbError> {
    conn.query_one(
        "SELECT batch_id FROM integration_batch_start WHERE user_id = ?1 AND idempotency_key = ?2",
        &[Value::Text(user_id), Value::Text(idempotency_key)],
        |row| row.get_text(0),
    )
}

fn response_for(batch: Batch, created: bool) -> StartBatchResponse {
    StartBatchResponse {
        batch_id: batch.id,
        batch_name: batch.name,
        created,
        inventory_deduction_count: batch.data.inventory_deductions.len(),
        inventory_shortage_count: batch.data.inventory_shortages.len(),
    }
}

fn start_batch_for_user(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
    recipe_id: &str,
    idempotency_key: &str,
) -> Result<(Batch, bool), DbError> {
    if !user_db::doc_owned_by_user(conn, DocType::Recipe, recipe_id, user_id)? {
        return Err(DbError("Recipe not found".into()));
    }
    let recipe = brewdio_persistence::db::get_recipe(conn, recipe_id)?
        .ok_or_else(|| DbError("Recipe not found".into()))?;

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<(Batch, bool), DbError> {
        if let Some(batch_id) = existing_batch_id(conn, user_id, idempotency_key)? {
            let row = brewdio_persistence::batch::get_batch_row(conn, &batch_id)?
                .ok_or_else(|| DbError("Idempotent batch record is missing".into()))?;
            return Ok((row.to_batch()?, false));
        }

        let (equipment, equipment_id) =
            match (recipe.equipment.clone(), recipe.equipment_id.clone()) {
                (Some(equipment), equipment_id) => (
                    equipment,
                    equipment_id.unwrap_or_else(|| "embedded".to_string()),
                ),
                (None, _) => {
                    let mut ids = user_db::list_all_doc_ids_for_user(
                        conn,
                        DocType::EquipmentProfile,
                        user_id,
                    )?;
                    ids.sort();
                    let mut selected = None;
                    for id in ids {
                        if let Some(profile) =
                            brewdio_persistence::equipment_profile::get_equipment_profile(conn, &id)?
                        {
                            selected = Some((profile.equipment, id));
                            break;
                        }
                    }
                    selected.ok_or_else(|| DbError("No equipment profile is available".into()))?
                }
            };
        let inventory = owned_inventory(conn, user_id)?;
        let updated_at = Connection::query_one(
            conn,
            "SELECT datetime('now')",
            &[],
            |row| row.get_text(0),
        )?
        .unwrap_or_else(|| "unknown".to_string());
        let plan = build_inventory_plan(&recipe.recipe, &inventory, updated_at);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| DbError(error.to_string()))?
            .as_millis() as u64;
        let name = batch_name(conn, user_id, &recipe.id, &recipe.recipe.name)?;
        let data = BatchData {
            equipment_id,
            recipe: recipe.recipe.clone(),
            equipment,
            brew_date: now,
            notes: None,
            created_at: now,
            updated_at: now,
            inventory_deductions: Vec::new(),
            inventory_shortages: Vec::new(),
        };
        let row = brewdio_persistence::batch::create_batch_with_inventory_in_transaction(
            conn,
            &name,
            &recipe.id,
            data,
            plan,
        )?;
        user_db::set_doc_user_id(conn, DocType::Batch, &row.id, user_id)?;
        Connection::execute(
            conn,
            "INSERT INTO integration_batch_start (user_id, idempotency_key, recipe_id, batch_id) VALUES (?1, ?2, ?3, ?4)",
            &[
                Value::Text(user_id),
                Value::Text(idempotency_key),
                Value::Text(&recipe.id),
                Value::Text(&row.id),
            ],
        )?;
        Ok((row.to_batch()?, true))
    })();

    match result {
        Ok(value) => {
            conn.execute_batch("COMMIT;")?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

pub async fn start_batch(
    api_user: ApiKeyUser,
    State(state): State<Arc<AppState>>,
    Path(recipe_id): Path<String>,
    Json(request): Json<StartBatchRequest>,
) -> Response {
    if !api_user.has_scope("batches:write") {
        return json_error(StatusCode::FORBIDDEN, "API token lacks batches:write scope");
    }
    if request.idempotency_key.len() < 8
        || request.idempotency_key.len() > 200
        || !request
            .idempotency_key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-:.".contains(character))
    {
        return json_error(StatusCode::BAD_REQUEST, "Invalid idempotency key");
    }

    let conn_guard = state.conn.lock().unwrap_or_else(|error| error.into_inner());
    match start_batch_for_user(
        &*conn_guard,
        &api_user.user_id,
        &recipe_id,
        &request.idempotency_key,
    ) {
        Ok((batch, created)) => {
            let status = if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (status, Json(response_for(batch, created))).into_response()
        }
        Err(error) => {
            eprintln!("[api] failed to start batch: {}", error);
            let status = if error.0 == "Recipe not found" {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::CONFLICT
            };
            json_error(status, &error.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::inventory::{
        InventoryIngredient, InventorySource,
    };
    use brewdio_persistence::{connection_native, db as persistence_db};

    fn sample_recipe(ingredient_name: &str) -> RecipeType {
        serde_json::from_value(serde_json::json!({
            "name": "Test Pils",
            "type": "all grain",
            "author": "Tester",
            "batch_size": { "unit": "l", "value": 20.0 },
            "efficiency": { "brewhouse": { "unit": "%", "value": 72.0 } },
            "ingredients": {
                "fermentable_additions": [{
                    "name": ingredient_name,
                    "type": "grain",
                    "amount": { "unit": "kg", "value": 4.0 },
                    "color": { "unit": "EBC", "value": 3.0 },
                    "yield": { "fine_grind": { "unit": "%", "value": 80.0 } }
                }],
                "hop_additions": []
            }
        }))
        .unwrap()
    }

    fn inventory_item(quantity_kg: f64) -> InventoryItem {
        let fermentable = brewdio_core::data::fermentables()[0].clone();
        InventoryItem {
            id: String::new(),
            ingredient: InventoryIngredient::Fermentable(fermentable),
            source: InventorySource::BuiltIn,
            quantity: InventoryQuantity::Mass(MassType {
                unit: MassUnitType::Kg,
                value: quantity_kg,
            }),
            low_stock_threshold: None,
            lot_number: None,
            best_before: Some("2027-01-01".into()),
            location: None,
            notes: None,
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
        }
    }

    #[test]
    fn inventory_plan_allocates_available_stock_and_records_shortage() {
        let mut item = inventory_item(3.0);
        item.id = "stock-1".into();
        let ingredient_name = item.name().to_string();
        let plan = build_inventory_plan(
            &sample_recipe(&ingredient_name),
            &[item],
            "now".into(),
        );
        assert_eq!(plan.deductions.len(), 1);
        assert_eq!(quantity_to_base(&plan.deductions[0].quantity), 3000.0);
        assert_eq!(plan.shortages.len(), 1);
        assert_eq!(quantity_to_base(&plan.shortages[0].missing), 1000.0);
    }

    #[test]
    fn batch_start_is_user_scoped_and_idempotent() {
        let conn = connection_native::open(":memory:").unwrap();
        crate::db::run_server_migrations(&conn).unwrap();
        crate::db::create_user(&conn, "user-1", "one@example.com", None, None, "", false)
            .unwrap();
        crate::db::create_user(&conn, "user-2", "two@example.com", None, None, "", false)
            .unwrap();

        let mut stock = inventory_item(5.0);
        let ingredient_name = stock.name().to_string();
        let stock_row = brewdio_persistence::inventory::create_inventory_item(&conn, &stock)
            .unwrap();
        stock.id = stock_row.id.clone();
        user_db::set_doc_user_id(
            &conn,
            DocType::InventoryItem,
            &stock_row.id,
            "user-1",
        )
        .unwrap();

        let profile = brewdio_core::data::equipment()[0].clone();
        let recipe_row = persistence_db::create_recipe(
            &conn,
            "Test Pils",
            &sample_recipe(&ingredient_name),
            Some(&profile.equipment),
            Some(&profile.id),
        )
        .unwrap();
        user_db::set_doc_user_id(&conn, DocType::Recipe, &recipe_row.id, "user-1")
            .unwrap();

        let (first, first_created) =
            start_batch_for_user(&conn, "user-1", &recipe_row.id, "craftbeerpi:test-1")
                .unwrap();
        let (second, second_created) =
            start_batch_for_user(&conn, "user-1", &recipe_row.id, "craftbeerpi:test-1")
                .unwrap();

        assert!(first_created);
        assert!(!second_created);
        assert_eq!(first.id, second.id);
        assert_eq!(first.data.inventory_deductions.len(), 1);
        let remaining = brewdio_persistence::inventory::get_inventory_item(
            &conn,
            &stock_row.id,
        )
        .unwrap()
        .unwrap();
        assert_eq!(quantity_to_base(&remaining.quantity), 1000.0);
        assert_eq!(
            user_db::list_all_doc_ids_for_user(&conn, DocType::Batch, "user-1")
                .unwrap()
                .len(),
            1
        );
        assert!(start_batch_for_user(
            &conn,
            "user-2",
            &recipe_row.id,
            "craftbeerpi:test-2"
        )
        .is_err());
    }
}
