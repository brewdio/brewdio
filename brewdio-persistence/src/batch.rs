use brewdio_core::beerjson_types::{
    EquipmentType, MassUnitType, RecipeType, VolumeUnitType,
};
use brewdio_core::inventory::{
    InventoryDeduction, InventoryQuantity, InventoryShortage,
};
use serde::{Deserialize, Serialize};

use crate::connection::{Connection, DbError, Value};
use crate::automerge::{current_time_millis, new_ulid, reconcile_to_automerge};
use crate::protocol::DocType;
use crate::traits::{SyncDocument, SyncRow};

/// Public typed batch for external consumers.
/// JSON data field is deserialized from the underlying `BatchRow`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub name: String,
    pub recipe_id: String,
    pub data: BatchData,
}

fn default_inventory_deductions() -> Vec<InventoryDeduction> {
    Vec::new()
}

fn default_inventory_shortages() -> Vec<InventoryShortage> {
    Vec::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, autosurgeon::Reconcile, autosurgeon::Hydrate)]
#[serde(rename_all = "camelCase")]
pub struct BatchData {
    pub equipment_id: String,
    pub recipe: RecipeType,
    pub equipment: EquipmentType,
    pub brew_date: u64,
    pub notes: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    #[autosurgeon(missing = "default_inventory_deductions")]
    pub inventory_deductions: Vec<InventoryDeduction>,
    #[serde(default)]
    #[autosurgeon(missing = "default_inventory_shortages")]
    pub inventory_shortages: Vec<InventoryShortage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryDeductionRequest {
    pub inventory_item_id: String,
    pub quantity: InventoryQuantity,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InventoryDeductionPlan {
    #[serde(default)]
    pub deductions: Vec<InventoryDeductionRequest>,
    #[serde(default)]
    pub shortages: Vec<InventoryShortage>,
    pub updated_at: String,
}

pub struct BatchRow {
    pub id: String,
    pub name: String,
    pub recipe_id: String,
    pub data: String,
    pub am_data: Vec<u8>,
    pub is_deleted: bool,
    pub is_dirty: bool,
}

/// Automerge-reconciled document for CRDT sync.
#[derive(Clone, Debug, Serialize, Deserialize, autosurgeon::Reconcile, autosurgeon::Hydrate)]
pub struct BatchDocument {
    pub id: String,
    pub name: String,
    pub recipe_id: String,
    pub data: BatchData,
    pub is_deleted: bool,
}

impl BatchRow {
    /// Convert to a typed `Batch` (deserializes JSON data field).
    pub fn to_batch(&self) -> Result<Batch, DbError> {
        let data: BatchData = serde_json::from_str(&self.data)
            .map_err(|e| DbError(e.to_string()))?;
        Ok(Batch {
            id: self.id.clone(),
            name: self.name.clone(),
            recipe_id: self.recipe_id.clone(),
            data,
        })
    }

    pub fn to_data(&self) -> Result<BatchData, serde_json::Error> {
        serde_json::from_str(&self.data)
    }

    pub fn to_document(&self) -> Result<BatchDocument, serde_json::Error> {
        let data: BatchData = serde_json::from_str(&self.data)?;
        Ok(BatchDocument {
            id: self.id.clone(),
            name: self.name.clone(),
            recipe_id: self.recipe_id.clone(),
            data,
            is_deleted: self.is_deleted,
        })
    }
}

impl SyncDocument for BatchDocument {
    fn id(&self) -> &str { &self.id }
    fn is_deleted(&self) -> bool { self.is_deleted }
    fn set_is_deleted(&mut self, deleted: bool) { self.is_deleted = deleted; }
}

impl SyncRow for BatchRow {
    type Document = BatchDocument;
    fn doc_type() -> DocType { DocType::Batch }
    fn id(&self) -> &str { &self.id }
    fn am_data(&self) -> &[u8] { &self.am_data }
    fn into_document(&self) -> Result<BatchDocument, DbError> {
        self.to_document().map_err(|e| DbError(e.to_string()))
    }
}

impl BatchDocument {
    pub fn to_row(&self, am_data: Vec<u8>) -> Result<BatchRow, serde_json::Error> {
        let data_json = serde_json::to_string(&self.data)?;
        Ok(BatchRow {
            id: self.id.clone(),
            name: self.name.clone(),
            recipe_id: self.recipe_id.clone(),
            data: data_json,
            am_data,
            is_deleted: self.is_deleted,
            is_dirty: true,
        })
    }
}

fn row_from_query(row: &dyn crate::connection::Row) -> BatchRow {
    BatchRow {
        id: row.get_text(0),
        name: row.get_text(1),
        recipe_id: row.get_text(2),
        data: row.get_text(3),
        am_data: row.get_blob(4),
        is_deleted: row.get_bool(5),
        is_dirty: row.get_bool(6),
    }
}

pub fn create_batch(
    conn: &(impl Connection + ?Sized),
    name: &str,
    recipe_id: &str,
    data: &str,
) -> Result<BatchRow, DbError> {
    let id = new_ulid();
    let parsed_data: BatchData =
        serde_json::from_str(data).map_err(|e| DbError(e.to_string()))?;
    let doc = BatchDocument {
        id: id.clone(),
        name: name.to_string(),
        recipe_id: recipe_id.to_string(),
        data: parsed_data,
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, None).map_err(|e| DbError(e))?;

    conn.execute(
        "INSERT INTO batch (id, name, recipe_id, data, am_data) VALUES (?1, ?2, ?3, ?4, ?5)",
        &[
            Value::Text(&id),
            Value::Text(name),
            Value::Text(recipe_id),
            Value::Text(data),
            Value::Blob(&am_data),
        ],
    )?;
    Ok(BatchRow {
        id,
        name: name.to_string(),
        recipe_id: recipe_id.to_string(),
        data: data.to_string(),
        am_data,
        is_deleted: false,
        is_dirty: true,
    })
}

fn subtract_quantity(
    current: &InventoryQuantity,
    requested: &InventoryQuantity,
) -> Result<InventoryQuantity, DbError> {
    const EPSILON: f64 = 0.000_001;
    match (current, requested) {
        (InventoryQuantity::Mass(current), InventoryQuantity::Mass(requested)) => {
            let current_grams = brewdio_core::units::mass_to_grams(current);
            let requested_grams = brewdio_core::units::mass_to_grams(requested);
            if requested_grams > current_grams + EPSILON {
                return Err(DbError("Inventory deduction exceeds available mass".into()));
            }
            let value = match current.unit {
                MassUnitType::Mg => (current_grams - requested_grams) * 1000.0,
                MassUnitType::G => current_grams - requested_grams,
                MassUnitType::Kg => (current_grams - requested_grams) / 1000.0,
                MassUnitType::Lb => (current_grams - requested_grams) / 453.592,
                MassUnitType::Oz => (current_grams - requested_grams) / 28.3495,
            };
            Ok(InventoryQuantity::Mass(brewdio_core::beerjson_types::MassType {
                unit: current.unit,
                value: value.max(0.0),
            }))
        }
        (InventoryQuantity::Volume(current), InventoryQuantity::Volume(requested)) => {
            let current_ml = brewdio_core::units::volume_to_milliliters(current);
            let requested_ml = brewdio_core::units::volume_to_milliliters(requested);
            if requested_ml > current_ml + EPSILON {
                return Err(DbError("Inventory deduction exceeds available volume".into()));
            }
            let value = match current.unit {
                VolumeUnitType::Ml => current_ml - requested_ml,
                VolumeUnitType::L => (current_ml - requested_ml) / 1000.0,
                VolumeUnitType::Tsp => (current_ml - requested_ml) / 4.92892,
                VolumeUnitType::Tbsp => (current_ml - requested_ml) / 14.7868,
                VolumeUnitType::Floz => (current_ml - requested_ml) / 29.5735,
                VolumeUnitType::Cup => (current_ml - requested_ml) / 236.588,
                VolumeUnitType::Pt => (current_ml - requested_ml) / 473.176,
                VolumeUnitType::Qt => (current_ml - requested_ml) / 946.353,
                VolumeUnitType::Gal => (current_ml - requested_ml) / 3785.41,
                VolumeUnitType::Bbl => (current_ml - requested_ml) / 117347.77,
                VolumeUnitType::Ifloz => (current_ml - requested_ml) / 28.4131,
                VolumeUnitType::Ipt => (current_ml - requested_ml) / 568.261,
                VolumeUnitType::Iqt => (current_ml - requested_ml) / 1136.52,
                VolumeUnitType::Igal => (current_ml - requested_ml) / 4546.09,
                VolumeUnitType::Ibbl => (current_ml - requested_ml) / 163659.24,
            };
            Ok(InventoryQuantity::Volume(
                brewdio_core::beerjson_types::VolumeType {
                    unit: current.unit,
                    value: value.max(0.0),
                },
            ))
        }
        (InventoryQuantity::Unit(current), InventoryQuantity::Unit(requested)) => {
            if current.unit != requested.unit {
                return Err(DbError("Inventory unit types do not match".into()));
            }
            if requested.value > current.value + EPSILON {
                return Err(DbError("Inventory deduction exceeds available units".into()));
            }
            Ok(InventoryQuantity::Unit(brewdio_core::beerjson_types::UnitType {
                unit: current.unit,
                value: (current.value - requested.value).max(0.0),
            }))
        }
        _ => Err(DbError("Inventory quantity types do not match".into())),
    }
}

fn add_quantity(
    current: &InventoryQuantity,
    restored: &InventoryQuantity,
) -> Result<InventoryQuantity, DbError> {
    match (current, restored) {
        (InventoryQuantity::Mass(current), InventoryQuantity::Mass(restored)) => {
            let total_grams = brewdio_core::units::mass_to_grams(current)
                + brewdio_core::units::mass_to_grams(restored);
            let value = match current.unit {
                MassUnitType::Mg => total_grams * 1000.0,
                MassUnitType::G => total_grams,
                MassUnitType::Kg => total_grams / 1000.0,
                MassUnitType::Lb => total_grams / 453.592,
                MassUnitType::Oz => total_grams / 28.3495,
            };
            Ok(InventoryQuantity::Mass(brewdio_core::beerjson_types::MassType {
                unit: current.unit,
                value,
            }))
        }
        (InventoryQuantity::Volume(current), InventoryQuantity::Volume(restored)) => {
            let total_ml = brewdio_core::units::volume_to_milliliters(current)
                + brewdio_core::units::volume_to_milliliters(restored);
            let value = match current.unit {
                VolumeUnitType::Ml => total_ml,
                VolumeUnitType::L => total_ml / 1000.0,
                VolumeUnitType::Tsp => total_ml / 4.92892,
                VolumeUnitType::Tbsp => total_ml / 14.7868,
                VolumeUnitType::Floz => total_ml / 29.5735,
                VolumeUnitType::Cup => total_ml / 236.588,
                VolumeUnitType::Pt => total_ml / 473.176,
                VolumeUnitType::Qt => total_ml / 946.353,
                VolumeUnitType::Gal => total_ml / 3785.41,
                VolumeUnitType::Bbl => total_ml / 117347.77,
                VolumeUnitType::Ifloz => total_ml / 28.4131,
                VolumeUnitType::Ipt => total_ml / 568.261,
                VolumeUnitType::Iqt => total_ml / 1136.52,
                VolumeUnitType::Igal => total_ml / 4546.09,
                VolumeUnitType::Ibbl => total_ml / 163659.24,
            };
            Ok(InventoryQuantity::Volume(
                brewdio_core::beerjson_types::VolumeType {
                    unit: current.unit,
                    value,
                },
            ))
        }
        (InventoryQuantity::Unit(current), InventoryQuantity::Unit(restored)) => {
            if current.unit != restored.unit {
                return Err(DbError("Inventory unit types do not match".into()));
            }
            Ok(InventoryQuantity::Unit(brewdio_core::beerjson_types::UnitType {
                unit: current.unit,
                value: current.value + restored.value,
            }))
        }
        _ => Err(DbError("Inventory quantity types do not match".into())),
    }
}

pub fn create_batch_with_inventory(
    conn: &(impl Connection + ?Sized),
    name: &str,
    recipe_id: &str,
    data: BatchData,
    plan: InventoryDeductionPlan,
) -> Result<BatchRow, DbError> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = create_batch_with_inventory_in_transaction(
        conn,
        name,
        recipe_id,
        data,
        plan,
    );

    match result {
        Ok(row) => {
            conn.execute_batch("COMMIT;")?;
            Ok(row)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

/// Create a batch and apply its inventory plan inside an existing transaction.
///
/// The caller is responsible for starting, committing, and rolling back the
/// transaction. This is used when batch creation must be atomic with additional
/// records such as an integration idempotency key.
pub fn create_batch_with_inventory_in_transaction(
    conn: &(impl Connection + ?Sized),
    name: &str,
    recipe_id: &str,
    mut data: BatchData,
    plan: InventoryDeductionPlan,
) -> Result<BatchRow, DbError> {
    let mut applied = Vec::new();
    for request in &plan.deductions {
        let mut item = crate::inventory::get_inventory_item(conn, &request.inventory_item_id)?
            .ok_or_else(|| {
                DbError(format!(
                    "Inventory item not found: {}",
                    request.inventory_item_id
                ))
            })?;
        let before = item.quantity.clone();
        let after = subtract_quantity(&before, &request.quantity)?;
        item.quantity = after.clone();
        item.updated_at = plan.updated_at.clone();
        crate::inventory::update_inventory_item(conn, &item.id, &item)?;
        applied.push(InventoryDeduction {
            inventory_item_id: item.id.clone(),
            ingredient_name: item.name().to_string(),
            quantity: request.quantity.clone(),
            before,
            after,
        });
    }

    data.inventory_deductions = applied;
    data.inventory_shortages = plan.shortages;
    let data_json = serde_json::to_string(&data).map_err(|e| DbError(e.to_string()))?;
    create_batch(conn, name, recipe_id, &data_json)
}

pub fn get_batch_row(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<Option<BatchRow>, DbError> {
    conn.query_one(
        "SELECT id, name, recipe_id, data, am_data, is_deleted, is_dirty FROM batch WHERE id = ?1",
        &[Value::Text(id)],
        row_from_query,
    )
}

pub fn list_batch_rows(conn: &(impl Connection + ?Sized)) -> Result<Vec<BatchRow>, DbError> {
    conn.query_map(
        "SELECT id, name, recipe_id, data, am_data, is_deleted, is_dirty FROM batch WHERE is_deleted = FALSE",
        &[],
        row_from_query,
    )
}

/// List all non-deleted batches as typed `Batch` structs.
pub fn list_batches(conn: &(impl Connection + ?Sized)) -> Result<Vec<Batch>, DbError> {
    list_batch_rows(conn)?
        .into_iter()
        .map(|r| r.to_batch())
        .collect()
}

/// Get a batch by ID as a typed `Batch` struct.
pub fn get_batch(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<Option<Batch>, DbError> {
    get_batch_row(conn, id)?
        .filter(|r| !r.is_deleted)
        .map(|r| r.to_batch())
        .transpose()
}

pub fn update_batch(
    conn: &(impl Connection + ?Sized),
    id: &str,
    name: &str,
    data: &str,
) -> Result<(), DbError> {
    let existing = get_batch_row(conn, id)?;
    let existing_am = existing.as_ref().map(|r| r.am_data.as_slice());

    let parsed_data: BatchData =
        serde_json::from_str(data).map_err(|e| DbError(e.to_string()))?;
    let doc = BatchDocument {
        id: id.to_string(),
        name: name.to_string(),
        recipe_id: existing.as_ref().map(|r| r.recipe_id.clone()).unwrap_or_default(),
        data: parsed_data,
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, existing_am).map_err(|e| DbError(e))?;

    conn.execute(
        "UPDATE batch SET name = ?1, data = ?2, am_data = ?3, is_dirty = TRUE WHERE id = ?4",
        &[Value::Text(name), Value::Text(data), Value::Blob(&am_data), Value::Text(id)],
    )
}

pub fn delete_batch(conn: &(impl Connection + ?Sized), id: &str) -> Result<(), DbError> {
    let existing = get_batch_row(conn, id)?;
    crate::traits::set_deleted(conn, existing, id, true)
}

pub fn delete_batch_with_inventory(
    conn: &(impl Connection + ?Sized),
    id: &str,
    updated_at: &str,
) -> Result<bool, DbError> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        let existing = get_batch_row(conn, id)?
            .ok_or_else(|| DbError(format!("Batch not found: {id}")))?;
        if existing.is_deleted {
            return Ok(false);
        }

        let data = existing.to_data().map_err(|e| DbError(e.to_string()))?;
        for deduction in &data.inventory_deductions {
            let row = crate::inventory::get_inventory_item_row(
                conn,
                &deduction.inventory_item_id,
            )?
            .ok_or_else(|| {
                DbError(format!(
                    "Inventory item not found: {}",
                    deduction.inventory_item_id
                ))
            })?;
            let mut item = row.to_item().map_err(|e| DbError(e.to_string()))?;
            item.quantity = add_quantity(&item.quantity, &deduction.quantity)?;
            item.updated_at = updated_at.to_string();
            crate::inventory::update_inventory_item(conn, &item.id, &item)?;
        }

        delete_batch(conn, id)?;
        Ok(!data.inventory_deductions.is_empty())
    })();

    match result {
        Ok(restored_inventory) => {
            conn.execute_batch("COMMIT;")?;
            Ok(restored_inventory)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

pub fn create_batch_from_recipe(
    conn: &(impl Connection + ?Sized),
    name: &str,
    recipe_id: &str,
    recipe: &RecipeType,
    equipment: &EquipmentType,
    equipment_profile_id: &str,
) -> Result<BatchRow, DbError> {
    let now = current_time_millis() as u64;
    let data = BatchData {
        equipment_id: equipment_profile_id.to_string(),
        recipe: recipe.clone(),
        equipment: equipment.clone(),
        brew_date: now,
        notes: None,
        created_at: now,
        updated_at: now,
        inventory_deductions: Vec::new(),
        inventory_shortages: Vec::new(),
    };
    let json = serde_json::to_string(&data).map_err(|e| DbError(e.to_string()))?;
    create_batch(conn, name, recipe_id, &json)
}

pub fn count_batches_for_recipe(
    conn: &(impl Connection + ?Sized),
    recipe_id: &str,
) -> Result<usize, DbError> {
    let ids = conn.query_map(
        "SELECT id FROM batch WHERE recipe_id = ?1",
        &[Value::Text(recipe_id)],
        |row| row.get_text(0),
    )?;
    Ok(ids.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::beerjson_types::{MassType, MassUnitType};
    use brewdio_core::inventory::{
        InventoryIngredient, InventoryItem, InventorySource,
    };

    fn test_conn() -> rusqlite::Connection {
        crate::connection_native::open(":memory:").unwrap()
    }

    fn sample_batch_data_json() -> String {
        serde_json::to_string(&BatchData {
            equipment_id: "kettle-1".to_string(),
            recipe: serde_json::from_str(r#"{
                "name": "Test IPA", "type": "all grain", "author": "",
                "batch_size": { "unit": "l", "value": 20.0 },
                "efficiency": { "brewhouse": { "unit": "%", "value": 72.0 } },
                "ingredients": { "fermentable_additions": [], "hop_additions": [] }
            }"#).unwrap(),
            equipment: brewdio_core::data::equipment()[0].equipment.clone(),
            brew_date: 1000,
            notes: Some("test".to_string()),
            created_at: 1000,
            updated_at: 1000,
            inventory_deductions: Vec::new(),
            inventory_shortages: Vec::new(),
        }).unwrap()
    }

    #[derive(autosurgeon::Reconcile)]
    struct LegacyBatchData {
        equipment_id: String,
        recipe: RecipeType,
        equipment: EquipmentType,
        brew_date: u64,
        notes: Option<String>,
        created_at: u64,
        updated_at: u64,
    }

    #[derive(autosurgeon::Reconcile)]
    struct LegacyBatchDocument {
        id: String,
        name: String,
        recipe_id: String,
        data: LegacyBatchData,
        is_deleted: bool,
    }

    #[test]
    fn batch_crud() {
        let conn = test_conn();
        let data = sample_batch_data_json();

        // Create
        let row = create_batch(&conn, "Batch 1", "recipe-123", &data).unwrap();
        assert_eq!(row.name, "Batch 1");
        assert!(!row.is_deleted);
        assert!(row.is_dirty);
        assert!(!row.am_data.is_empty(), "am_data should be populated on create");

        // Get
        let fetched = get_batch_row(&conn, &row.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Batch 1");
        assert_eq!(fetched.recipe_id, "recipe-123");
        assert!(fetched.is_dirty);
        assert!(!fetched.am_data.is_empty());

        // List
        let batches = list_batch_rows(&conn).unwrap();
        assert_eq!(batches.len(), 1);

        // Update
        update_batch(&conn, &row.id, "Updated Batch", &data).unwrap();
        let fetched = get_batch_row(&conn, &row.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Updated Batch");
        assert!(!fetched.am_data.is_empty(), "am_data should be populated on update");

        // Soft-delete
        delete_batch(&conn, &row.id).unwrap();
        let batches = list_batch_rows(&conn).unwrap();
        assert_eq!(batches.len(), 0);

        // Still exists
        let fetched = get_batch_row(&conn, &row.id).unwrap().unwrap();
        assert!(fetched.is_deleted);
        assert!(fetched.is_dirty);
        assert!(!fetched.am_data.is_empty(), "am_data should be populated on delete");
    }

    #[test]
    fn batch_creation_deducts_inventory_atomically() {
        let conn = test_conn();
        let inventory_item = InventoryItem {
            id: String::new(),
            ingredient: InventoryIngredient::Fermentable(
                brewdio_core::data::fermentables()[0].clone(),
            ),
            source: InventorySource::BuiltIn,
            quantity: InventoryQuantity::Mass(MassType {
                unit: MassUnitType::Kg,
                value: 5.0,
            }),
            low_stock_threshold: None,
            lot_number: None,
            best_before: None,
            location: None,
            notes: None,
            created_at: "2026-11-01T10:00:00Z".into(),
            updated_at: "2026-11-01T10:00:00Z".into(),
        };
        let inventory_row =
            crate::inventory::create_inventory_item(&conn, &inventory_item).unwrap();
        let data: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let plan = InventoryDeductionPlan {
            deductions: vec![InventoryDeductionRequest {
                inventory_item_id: inventory_row.id.clone(),
                quantity: InventoryQuantity::Mass(MassType {
                    unit: MassUnitType::G,
                    value: 2000.0,
                }),
            }],
            shortages: Vec::new(),
            updated_at: "2026-11-01T11:00:00Z".into(),
        };

        let batch = create_batch_with_inventory(&conn, "Batch", "recipe-1", data, plan)
            .unwrap();
        let remaining = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        match remaining.quantity {
            InventoryQuantity::Mass(value) => assert!((value.value - 3.0).abs() < 0.0001),
            _ => panic!("expected mass inventory"),
        }
        let stored = get_batch(&conn, &batch.id).unwrap().unwrap();
        assert_eq!(stored.data.inventory_deductions.len(), 1);

        let data: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let overdraw = InventoryDeductionPlan {
            deductions: vec![InventoryDeductionRequest {
                inventory_item_id: inventory_row.id.clone(),
                quantity: InventoryQuantity::Mass(MassType {
                    unit: MassUnitType::Kg,
                    value: 4.0,
                }),
            }],
            shortages: Vec::new(),
            updated_at: "2026-11-01T12:00:00Z".into(),
        };
        assert!(create_batch_with_inventory(&conn, "Invalid", "recipe-1", data, overdraw)
            .is_err());
        assert_eq!(list_batches(&conn).unwrap().len(), 1);
        let remaining = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        match remaining.quantity {
            InventoryQuantity::Mass(value) => assert!((value.value - 3.0).abs() < 0.0001),
            _ => panic!("expected mass inventory"),
        }
    }

    #[test]
    fn batch_deletion_restores_inventory_once_and_preserves_later_changes() {
        let conn = test_conn();
        let inventory_row = crate::inventory::create_inventory_item(
            &conn,
            &InventoryItem {
                id: String::new(),
                ingredient: InventoryIngredient::Fermentable(
                    brewdio_core::data::fermentables()[0].clone(),
                ),
                source: InventorySource::BuiltIn,
                quantity: InventoryQuantity::Mass(MassType {
                    unit: MassUnitType::Kg,
                    value: 5.0,
                }),
                low_stock_threshold: None,
                lot_number: None,
                best_before: None,
                location: None,
                notes: None,
                created_at: "2026-11-01T10:00:00Z".into(),
                updated_at: "2026-11-01T10:00:00Z".into(),
            },
        )
        .unwrap();
        let data: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let batch = create_batch_with_inventory(
            &conn,
            "Batch",
            "recipe-1",
            data,
            InventoryDeductionPlan {
                deductions: vec![InventoryDeductionRequest {
                    inventory_item_id: inventory_row.id.clone(),
                    quantity: InventoryQuantity::Mass(MassType {
                        unit: MassUnitType::G,
                        value: 2000.0,
                    }),
                }],
                shortages: Vec::new(),
                updated_at: "2026-11-01T11:00:00Z".into(),
            },
        )
        .unwrap();

        let mut item = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        item.quantity = InventoryQuantity::Mass(MassType {
            unit: MassUnitType::Kg,
            value: 4.0,
        });
        crate::inventory::update_inventory_item(&conn, &item.id, &item).unwrap();

        assert!(delete_batch_with_inventory(
            &conn,
            &batch.id,
            "2026-11-01T12:00:00Z"
        )
        .unwrap());
        let restored = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        match restored.quantity {
            InventoryQuantity::Mass(value) => assert!((value.value - 6.0).abs() < 0.0001),
            _ => panic!("expected mass inventory"),
        }
        assert_eq!(restored.updated_at, "2026-11-01T12:00:00Z");
        assert!(get_batch(&conn, &batch.id).unwrap().is_none());

        assert!(!delete_batch_with_inventory(
            &conn,
            &batch.id,
            "2026-11-01T13:00:00Z"
        )
        .unwrap());
        let restored = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        match restored.quantity {
            InventoryQuantity::Mass(value) => assert!((value.value - 6.0).abs() < 0.0001),
            _ => panic!("expected mass inventory"),
        }
    }

    #[test]
    fn batch_deletion_restores_a_soft_deleted_inventory_item() {
        let conn = test_conn();
        let inventory_row = crate::inventory::create_inventory_item(
            &conn,
            &InventoryItem {
                id: String::new(),
                ingredient: InventoryIngredient::Fermentable(
                    brewdio_core::data::fermentables()[0].clone(),
                ),
                source: InventorySource::BuiltIn,
                quantity: InventoryQuantity::Mass(MassType {
                    unit: MassUnitType::Kg,
                    value: 5.0,
                }),
                low_stock_threshold: None,
                lot_number: None,
                best_before: None,
                location: None,
                notes: None,
                created_at: "2026-11-01T10:00:00Z".into(),
                updated_at: "2026-11-01T10:00:00Z".into(),
            },
        )
        .unwrap();
        let data: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let batch = create_batch_with_inventory(
            &conn,
            "Batch",
            "recipe-1",
            data,
            InventoryDeductionPlan {
                deductions: vec![InventoryDeductionRequest {
                    inventory_item_id: inventory_row.id.clone(),
                    quantity: InventoryQuantity::Mass(MassType {
                        unit: MassUnitType::Kg,
                        value: 2.0,
                    }),
                }],
                shortages: Vec::new(),
                updated_at: "2026-11-01T11:00:00Z".into(),
            },
        )
        .unwrap();
        crate::inventory::delete_inventory_item(&conn, &inventory_row.id).unwrap();
        assert!(crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .is_none());

        assert!(delete_batch_with_inventory(
            &conn,
            &batch.id,
            "2026-11-01T12:00:00Z"
        )
        .unwrap());
        let restored = crate::inventory::get_inventory_item(&conn, &inventory_row.id)
            .unwrap()
            .unwrap();
        match restored.quantity {
            InventoryQuantity::Mass(value) => assert!((value.value - 5.0).abs() < 0.0001),
            _ => panic!("expected mass inventory"),
        }
    }

    #[test]
    fn batch_deletion_rolls_back_when_inventory_item_is_missing() {
        let conn = test_conn();
        let inventory_row = crate::inventory::create_inventory_item(
            &conn,
            &InventoryItem {
                id: String::new(),
                ingredient: InventoryIngredient::Fermentable(
                    brewdio_core::data::fermentables()[0].clone(),
                ),
                source: InventorySource::BuiltIn,
                quantity: InventoryQuantity::Mass(MassType {
                    unit: MassUnitType::Kg,
                    value: 5.0,
                }),
                low_stock_threshold: None,
                lot_number: None,
                best_before: None,
                location: None,
                notes: None,
                created_at: "2026-11-01T10:00:00Z".into(),
                updated_at: "2026-11-01T10:00:00Z".into(),
            },
        )
        .unwrap();
        let data: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let batch = create_batch_with_inventory(
            &conn,
            "Batch",
            "recipe-1",
            data,
            InventoryDeductionPlan {
                deductions: vec![InventoryDeductionRequest {
                    inventory_item_id: inventory_row.id.clone(),
                    quantity: InventoryQuantity::Mass(MassType {
                        unit: MassUnitType::Kg,
                        value: 2.0,
                    }),
                }],
                shortages: Vec::new(),
                updated_at: "2026-11-01T11:00:00Z".into(),
            },
        )
        .unwrap();
        conn.execute(
            "DELETE FROM inventory_item WHERE id = ?1",
            rusqlite::params![inventory_row.id],
        )
        .unwrap();

        assert!(delete_batch_with_inventory(
            &conn,
            &batch.id,
            "2026-11-01T12:00:00Z"
        )
        .is_err());
        assert!(get_batch(&conn, &batch.id).unwrap().is_some());
    }

    #[test]
    fn batch_deletion_without_inventory_deductions_deletes_normally() {
        let conn = test_conn();
        let row = create_batch(&conn, "Batch", "recipe-1", &sample_batch_data_json()).unwrap();
        assert!(!delete_batch_with_inventory(
            &conn,
            &row.id,
            "2026-11-01T12:00:00Z"
        )
        .unwrap());
        assert!(get_batch(&conn, &row.id).unwrap().is_none());
    }

    #[test]
    fn hydrates_legacy_batch_without_inventory_history() {
        let current: BatchData = serde_json::from_str(&sample_batch_data_json()).unwrap();
        let legacy = LegacyBatchDocument {
            id: "legacy-batch".into(),
            name: "Legacy".into(),
            recipe_id: "recipe-1".into(),
            data: LegacyBatchData {
                equipment_id: current.equipment_id,
                recipe: current.recipe,
                equipment: current.equipment,
                brew_date: current.brew_date,
                notes: current.notes,
                created_at: current.created_at,
                updated_at: current.updated_at,
            },
            is_deleted: false,
        };
        let bytes = reconcile_to_automerge(&legacy, None).unwrap();
        let hydrated: BatchDocument =
            crate::automerge::hydrate_from_automerge(&bytes).unwrap();
        assert!(hydrated.data.inventory_deductions.is_empty());
        assert!(hydrated.data.inventory_shortages.is_empty());
    }

    #[test]
    fn create_batch_from_recipe_roundtrip() {
        let conn = test_conn();
        let profile = &brewdio_core::data::equipment()[0];
        let recipe = brewdio_core::beerjson_types::RecipeType {
            name: "Test IPA".to_string(),
            author: String::new(),
            type_: brewdio_core::beerjson_types::RecipeTypeType::AllGrain,
            batch_size: brewdio_core::beerjson_types::VolumeType {
                unit: brewdio_core::beerjson_types::VolumeUnitType::L,
                value: 20.0,
            },
            efficiency: brewdio_core::beerjson_types::EfficiencyType {
                brewhouse: brewdio_core::beerjson_types::PercentType {
                    unit: brewdio_core::beerjson_types::PercentUnitType::X,
                    value: 72.0,
                },
                conversion: None,
                lauter: None,
                mash: None,
            },
            ingredients: brewdio_core::beerjson_types::IngredientsType {
                fermentable_additions: Vec::new(),
                hop_additions: Vec::new(),
                culture_additions: Vec::new(),
                miscellaneous_additions: Vec::new(),
                water_additions: Vec::new(),
            },
            alcohol_by_volume: None,
            apparent_attenuation: None,
            beer_p_h: None,
            boil: None,
            calories_per_pint: None,
            carbonation: None,
            coauthor: None,
            color_estimate: None,
            created: None,
            fermentation: None,
            final_gravity: None,
            ibu_estimate: None,
            mash: None,
            notes: None,
            original_gravity: None,
            packaging: None,
            style: None,
            taste: None,
        };

        let row = create_batch_from_recipe(&conn, "Batch #1", "recipe-1", &recipe, &profile.equipment, &profile.id).unwrap();
        assert_eq!(row.name, "Batch #1");

        let data = row.to_data().unwrap();
        assert_eq!(data.recipe.name, "Test IPA");
        assert_eq!(data.equipment_id, profile.id);
        assert!(data.brew_date > 0);
    }
}
