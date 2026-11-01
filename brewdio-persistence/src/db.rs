use brewdio_core::beerjson_types::{EquipmentType, RecipeType};

use crate::batch::{self, BatchDocument};
use crate::connection::{Connection, DbError, Value};
use crate::automerge::{extract_fields_from_automerge, new_ulid, reconcile_to_automerge};
use crate::equipment_profile::{self, EquipmentProfileDocument};
use crate::inventory::{self, InventoryItemDocument};
use crate::protocol::DocType;
use crate::recipe::{Recipe, RecipeDocument, RecipeRow};
use crate::settings::{self, SettingsDocument};
use crate::traits::{set_deleted, apply_remote_merge_generic, RemoteMergeable};

fn row_from_query(row: &dyn crate::connection::Row) -> RecipeRow {
    RecipeRow {
        id: row.get_text(0),
        name: row.get_text(1),
        recipe: row.get_text(2),
        equipment: row.get_optional_text(3),
        equipment_id: row.get_optional_text(4),
        am_data: row.get_blob(5),
        is_deleted: row.get_bool(6),
        is_dirty: row.get_bool(7),
    }
}

/// Create a new recipe and return its row.
pub fn create_recipe(
    conn: &(impl Connection + ?Sized),
    name: &str,
    recipe: &RecipeType,
    equipment: Option<&EquipmentType>,
    equipment_id: Option<&str>,
) -> Result<RecipeRow, DbError> {
    let id = new_ulid();
    let recipe_json = serde_json::to_string(recipe).expect("Failed to serialize recipe");
    let equipment_json = equipment.map(|eq| serde_json::to_string(eq).expect("Failed to serialize equipment"));

    let doc = RecipeDocument {
        id: id.clone(),
        name: name.to_string(),
        recipe: recipe.clone(),
        equipment: equipment.cloned(),
        equipment_id: equipment_id.map(|s| s.to_string()),
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, None).map_err(|e| DbError(e))?;

    conn.execute(
        "INSERT INTO recipe (id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        &[
            Value::Text(&id),
            Value::Text(name),
            Value::Text(&recipe_json),
            Value::OptionalText(equipment_json.as_deref()),
            Value::OptionalText(equipment_id),
            Value::Blob(&am_data),
            Value::Bool(false),
            Value::Bool(true),
        ],
    )?;

    Ok(RecipeRow {
        id,
        name: name.to_string(),
        recipe: recipe_json,
        equipment: equipment_json,
        equipment_id: equipment_id.map(|s| s.to_string()),
        am_data,
        is_deleted: false,
        is_dirty: true,
    })
}

/// Get a recipe row by ID (returns raw row with JSON strings and am_data).
pub fn get_recipe_row(conn: &(impl Connection + ?Sized), id: &str) -> Result<Option<RecipeRow>, DbError> {
    conn.query_one(
        "SELECT id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty FROM recipe WHERE id = ?1",
        &[Value::Text(id)],
        row_from_query,
    )
}

/// List all non-deleted recipe rows (returns raw rows with JSON strings).
pub fn list_recipe_rows(conn: &(impl Connection + ?Sized)) -> Result<Vec<RecipeRow>, DbError> {
    conn.query_map(
        "SELECT id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty FROM recipe WHERE is_deleted = FALSE",
        &[],
        row_from_query,
    )
}

/// Get a recipe by ID as a typed `Recipe` struct.
pub fn get_recipe(conn: &(impl Connection + ?Sized), id: &str) -> Result<Option<Recipe>, DbError> {
    get_recipe_row(conn, id)?
        .filter(|r| !r.is_deleted)
        .map(|r| r.to_recipe())
        .transpose()
}

/// List all non-deleted recipes as typed `Recipe` structs.
pub fn list_recipes(conn: &(impl Connection + ?Sized)) -> Result<Vec<Recipe>, DbError> {
    list_recipe_rows(conn)?
        .into_iter()
        .map(|r| r.to_recipe())
        .collect()
}

/// Update a recipe's name and content, re-reconciling into the existing Automerge document.
/// Equipment is preserved from the existing row (use `set_recipe_equipment` to change it).
pub fn update_recipe(
    conn: &(impl Connection + ?Sized),
    id: &str,
    name: &str,
    recipe: &RecipeType,
    equipment: Option<&EquipmentType>,
) -> Result<(), DbError> {
    log::info!(
        "[update_recipe] recipe={} name={:?} batch_size.value={}",
        id, name, recipe.batch_size.value
    );
    let recipe_json = serde_json::to_string(recipe).expect("Failed to serialize recipe");

    let existing = get_recipe_row(conn, id)?;
    let existing_am = existing.as_ref().map(|r| r.am_data.as_slice());

    // Preserve existing equipment when not explicitly provided
    let effective_equipment: Option<EquipmentType> = match equipment {
        Some(eq) => Some(eq.clone()),
        None => existing
            .as_ref()
            .and_then(|r| r.equipment.as_ref())
            .and_then(|json| serde_json::from_str(json).ok()),
    };
    let equipment_json = effective_equipment.as_ref().map(|eq| {
        serde_json::to_string(eq).expect("Failed to serialize equipment")
    });

    // Preserve existing equipment_id
    let equipment_id = existing.as_ref().and_then(|r| r.equipment_id.clone());

    let doc = RecipeDocument {
        id: id.to_string(),
        name: name.to_string(),
        recipe: recipe.clone(),
        equipment: effective_equipment,
        equipment_id: equipment_id.clone(),
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, existing_am).map_err(|e| DbError(e))?;

    conn.execute(
        "UPDATE recipe SET name = ?1, recipe = ?2, equipment = ?3, equipment_id = ?4, am_data = ?5, is_dirty = TRUE WHERE id = ?6",
        &[
            Value::Text(name),
            Value::Text(&recipe_json),
            Value::OptionalText(equipment_json.as_deref()),
            Value::OptionalText(equipment_id.as_deref()),
            Value::Blob(&am_data),
            Value::Text(id),
        ],
    )?;

    Ok(())
}

/// Set or clear a recipe's equipment profile without changing the recipe content.
pub fn set_recipe_equipment(
    conn: &(impl Connection + ?Sized),
    id: &str,
    equipment: Option<&EquipmentType>,
    equipment_id: Option<&str>,
) -> Result<(), DbError> {
    let existing = get_recipe_row(conn, id)?;
    let row = existing.ok_or_else(|| DbError(format!("Recipe {} not found", id)))?;
    let existing_am = row.am_data.as_slice();

    let recipe: RecipeType = serde_json::from_str(&row.recipe)
        .map_err(|e| DbError(e.to_string()))?;
    let equipment_json = equipment.map(|eq| {
        serde_json::to_string(eq).expect("Failed to serialize equipment")
    });

    let doc = RecipeDocument {
        id: id.to_string(),
        name: row.name.clone(),
        recipe,
        equipment: equipment.cloned(),
        equipment_id: equipment_id.map(|s| s.to_string()),
        is_deleted: row.is_deleted,
    };
    let am_data = reconcile_to_automerge(&doc, Some(existing_am)).map_err(|e| DbError(e))?;

    conn.execute(
        "UPDATE recipe SET equipment = ?1, equipment_id = ?2, am_data = ?3, is_dirty = TRUE WHERE id = ?4",
        &[
            Value::OptionalText(equipment_json.as_deref()),
            Value::OptionalText(equipment_id),
            Value::Blob(&am_data),
            Value::Text(id),
        ],
    )?;

    Ok(())
}

/// List all soft-deleted recipes.
pub fn list_deleted_recipes(conn: &(impl Connection + ?Sized)) -> Result<Vec<RecipeRow>, DbError> {
    conn.query_map(
        "SELECT id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty FROM recipe WHERE is_deleted = TRUE",
        &[],
        row_from_query,
    )
}

/// List all recipes (including deleted).
pub fn list_all_recipes(conn: &(impl Connection + ?Sized)) -> Result<Vec<RecipeRow>, DbError> {
    conn.query_map(
        "SELECT id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty FROM recipe",
        &[],
        row_from_query,
    )
}

/// Restore a soft-deleted recipe by setting `is_deleted = false`.
pub fn undelete_recipe(conn: &(impl Connection + ?Sized), id: &str) -> Result<(), DbError> {
    let existing = get_recipe_row(conn, id)?;
    set_deleted(conn, existing, id, false)
}

/// Soft-delete a recipe by setting `is_deleted = true`.
pub fn delete_recipe(conn: &(impl Connection + ?Sized), id: &str) -> Result<(), DbError> {
    let existing = get_recipe_row(conn, id)?;
    set_deleted(conn, existing, id, true)
}

// --- Sync-related functions ---

/// Get the stored Automerge sync state for a (doc_type, doc_id, peer) triple.
pub fn get_sync_state(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    doc_id: &str,
    peer_id: &str,
) -> Result<Option<Vec<u8>>, DbError> {
    conn.query_one(
        "SELECT state FROM sync_state WHERE doc_type = ?1 AND doc_id = ?2 AND peer_id = ?3",
        &[Value::Text(doc_type.table_name()), Value::Text(doc_id), Value::Text(peer_id)],
        |row| row.get_blob(0),
    )
}

/// Save (upsert) Automerge sync state for a (doc_type, doc_id, peer) triple.
pub fn save_sync_state(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    doc_id: &str,
    peer_id: &str,
    state: &[u8],
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO sync_state (doc_type, doc_id, peer_id, state) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (doc_type, doc_id, peer_id) DO UPDATE SET state = excluded.state",
        &[Value::Text(doc_type.table_name()), Value::Text(doc_id), Value::Text(peer_id), Value::Blob(state)],
    )
}

/// Clear all sync states for a given peer. Called at connection start to avoid
/// stale state from a previous session causing sync loops.
pub fn clear_sync_states_for_peer(conn: &(impl Connection + ?Sized), peer_id: &str) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM sync_state WHERE peer_id = ?1",
        &[Value::Text(peer_id)],
    )
}

// --- RemoteMergeable implementations ---

impl RemoteMergeable for RecipeDocument {
    fn apply_hydrated(
        conn: &(impl Connection + ?Sized),
        id: &str,
        doc: &Self,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        log::info!(
            "[apply_remote_merge] recipe={} hydration OK: name={:?} batch_size.value={} is_deleted={}",
            id, doc.name, doc.recipe.batch_size.value, doc.is_deleted
        );
        let recipe_json = serde_json::to_string(&doc.recipe).expect("Failed to serialize recipe");
        let equipment_json = doc.equipment.as_ref().map(|eq| {
            serde_json::to_string(eq).expect("Failed to serialize equipment")
        });
        if exists {
            conn.execute(
                "UPDATE recipe SET name = ?1, recipe = ?2, equipment = ?3, equipment_id = ?4, am_data = ?5, is_deleted = ?6 WHERE id = ?7",
                &[
                    Value::Text(&doc.name),
                    Value::Text(&recipe_json),
                    Value::OptionalText(equipment_json.as_deref()),
                    Value::OptionalText(doc.equipment_id.as_deref()),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                    Value::Text(id),
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO recipe (id, name, recipe, equipment, equipment_id, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, FALSE)",
                &[
                    Value::Text(id),
                    Value::Text(&doc.name),
                    Value::Text(&recipe_json),
                    Value::OptionalText(equipment_json.as_deref()),
                    Value::OptionalText(doc.equipment_id.as_deref()),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                ],
            )?;
        }
        Ok(())
    }

    fn apply_fallback(
        conn: &(impl Connection + ?Sized),
        id: &str,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        let (name, is_deleted) = extract_fields_from_automerge(am_data);
        if exists {
            conn.execute(
                "UPDATE recipe SET name = ?1, am_data = ?2, is_deleted = ?3 WHERE id = ?4",
                &[Value::Text(&name), Value::Blob(am_data), Value::Bool(is_deleted), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO recipe (id, name, recipe, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, FALSE)",
                &[Value::Text(id), Value::Text(&name), Value::Text("{}"), Value::Blob(am_data), Value::Bool(is_deleted)],
            )?;
        }
        Ok(())
    }
}

impl RemoteMergeable for BatchDocument {
    fn apply_hydrated(
        conn: &(impl Connection + ?Sized),
        id: &str,
        doc: &Self,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        let data_json =
            serde_json::to_string(&doc.data).expect("Failed to serialize batch data");
        if exists {
            conn.execute(
                "UPDATE batch SET name = ?1, data = ?2, am_data = ?3, is_deleted = ?4 WHERE id = ?5",
                &[
                    Value::Text(&doc.name),
                    Value::Text(&data_json),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                    Value::Text(id),
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO batch (id, name, recipe_id, data, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, FALSE)",
                &[
                    Value::Text(id),
                    Value::Text(&doc.name),
                    Value::Text(&doc.recipe_id),
                    Value::Text(&data_json),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                ],
            )?;
        }
        Ok(())
    }

    fn apply_fallback(
        conn: &(impl Connection + ?Sized),
        id: &str,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        if exists {
            conn.execute(
                "UPDATE batch SET am_data = ?1 WHERE id = ?2",
                &[Value::Blob(am_data), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO batch (id, name, recipe_id, data, am_data, is_deleted, is_dirty) VALUES (?1, '', '', '{}', ?2, FALSE, FALSE)",
                &[Value::Text(id), Value::Blob(am_data)],
            )?;
        }
        Ok(())
    }
}

impl RemoteMergeable for SettingsDocument {
    fn apply_hydrated(
        conn: &(impl Connection + ?Sized),
        id: &str,
        doc: &Self,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        let data_json = serde_json::to_string(doc).unwrap_or_else(|_| "{}".to_string());
        if exists {
            conn.execute(
                "UPDATE settings SET data = ?1, am_data = ?2 WHERE id = ?3",
                &[Value::Text(&data_json), Value::Blob(am_data), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO settings (id, data, am_data, is_dirty) VALUES (?1, ?2, ?3, FALSE)",
                &[Value::Text(id), Value::Text(&data_json), Value::Blob(am_data)],
            )?;
        }
        Ok(())
    }

    fn apply_fallback(
        conn: &(impl Connection + ?Sized),
        id: &str,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        // Try to preserve existing data column if we can't hydrate
        let data_str = if exists {
            if let Ok(Some(row)) = settings::get_settings(conn) {
                if row.data != "{}" {
                    row.data
                } else {
                    "{}".to_string()
                }
            } else {
                "{}".to_string()
            }
        } else {
            "{}".to_string()
        };
        if exists {
            conn.execute(
                "UPDATE settings SET data = ?1, am_data = ?2 WHERE id = ?3",
                &[Value::Text(&data_str), Value::Blob(am_data), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO settings (id, data, am_data, is_dirty) VALUES (?1, ?2, ?3, FALSE)",
                &[Value::Text(id), Value::Text(&data_str), Value::Blob(am_data)],
            )?;
        }
        Ok(())
    }
}

impl RemoteMergeable for EquipmentProfileDocument {
    fn apply_hydrated(
        conn: &(impl Connection + ?Sized),
        id: &str,
        doc: &Self,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        let data_json = serde_json::to_string(&doc.equipment).expect("Failed to serialize equipment");
        let efficiency_json = serde_json::to_string(&doc.efficiency).expect("Failed to serialize efficiency");
        if exists {
            conn.execute(
                "UPDATE equipment_profile SET name = ?1, data = ?2, efficiency = ?3, am_data = ?4, is_deleted = ?5 WHERE id = ?6",
                &[
                    Value::Text(&doc.name),
                    Value::Text(&data_json),
                    Value::Text(&efficiency_json),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                    Value::Text(id),
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO equipment_profile (id, name, data, efficiency, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, FALSE)",
                &[
                    Value::Text(id),
                    Value::Text(&doc.name),
                    Value::Text(&data_json),
                    Value::Text(&efficiency_json),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                ],
            )?;
        }
        Ok(())
    }

    fn apply_fallback(
        conn: &(impl Connection + ?Sized),
        id: &str,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        if exists {
            conn.execute(
                "UPDATE equipment_profile SET am_data = ?1 WHERE id = ?2",
                &[Value::Blob(am_data), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO equipment_profile (id, name, data, efficiency, am_data, is_deleted, is_dirty) VALUES (?1, '', '{}', '{}', ?2, FALSE, FALSE)",
                &[Value::Text(id), Value::Blob(am_data)],
            )?;
        }
        Ok(())
    }
}

impl RemoteMergeable for InventoryItemDocument {
    fn apply_hydrated(
        conn: &(impl Connection + ?Sized),
        id: &str,
        doc: &Self,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        let data = serde_json::to_string(&doc.item).map_err(|e| DbError(e.to_string()))?;
        let name = doc.item.name();
        let kind = doc.item.kind();
        if exists {
            conn.execute(
                "UPDATE inventory_item SET name = ?1, kind = ?2, data = ?3, am_data = ?4, is_deleted = ?5 WHERE id = ?6",
                &[
                    Value::Text(name),
                    Value::Text(kind),
                    Value::Text(&data),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                    Value::Text(id),
                ],
            )?;
        } else {
            conn.execute(
                "INSERT INTO inventory_item (id, name, kind, data, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, FALSE)",
                &[
                    Value::Text(id),
                    Value::Text(name),
                    Value::Text(kind),
                    Value::Text(&data),
                    Value::Blob(am_data),
                    Value::Bool(doc.is_deleted),
                ],
            )?;
        }
        Ok(())
    }

    fn apply_fallback(
        conn: &(impl Connection + ?Sized),
        id: &str,
        am_data: &[u8],
        exists: bool,
    ) -> Result<(), DbError> {
        if exists {
            conn.execute(
                "UPDATE inventory_item SET am_data = ?1 WHERE id = ?2",
                &[Value::Blob(am_data), Value::Text(id)],
            )?;
        } else {
            conn.execute(
                "INSERT INTO inventory_item (id, name, kind, data, am_data, is_deleted, is_dirty) VALUES (?1, '', '', '{}', ?2, FALSE, FALSE)",
                &[Value::Text(id), Value::Blob(am_data)],
            )?;
        }
        Ok(())
    }
}

// --- Generic sync dispatch functions ---

/// Get `am_data` for any document type by ID.
pub fn get_doc_am_data(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    id: &str,
) -> Result<Option<Vec<u8>>, DbError> {
    match doc_type {
        DocType::Recipe => get_recipe_row(conn, id).map(|r| r.map(|r| r.am_data)),
        DocType::Batch => batch::get_batch_row(conn, id).map(|r| r.map(|r| r.am_data)),
        DocType::Settings => settings::get_settings(conn).map(|r| {
            r.map(|r| r.am_data).filter(|am| !am.is_empty())
        }),
        DocType::EquipmentProfile => equipment_profile::get_equipment_profile_row(conn, id).map(|r| r.map(|r| r.am_data)),
        DocType::InventoryItem => inventory::get_inventory_item_row(conn, id).map(|r| r.map(|r| r.am_data)),
    }
}

/// Mark a document as dirty (needs sync) for any document type.
/// Used by the server to propagate changes received from one client to others.
pub fn mark_dirty_doc(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    id: &str,
) -> Result<(), DbError> {
    conn.execute(
        &format!("UPDATE {} SET is_dirty = TRUE WHERE id = ?1", doc_type.table_name()),
        &[Value::Text(id)],
    )
}

/// Clear the dirty flag for any document type.
pub fn clear_dirty_doc(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    id: &str,
) -> Result<(), DbError> {
    conn.execute(
        &format!("UPDATE {} SET is_dirty = FALSE WHERE id = ?1", doc_type.table_name()),
        &[Value::Text(id)],
    )
}

/// List all dirty documents across all types.
pub fn list_dirty_docs(
    conn: &(impl Connection + ?Sized),
) -> Result<Vec<(DocType, String)>, DbError> {
    let mut result = Vec::new();
    for &doc_type in DocType::ALL {
        let ids: Vec<String> = conn.query_map(
            &format!("SELECT id FROM {} WHERE is_dirty = TRUE", doc_type.table_name()),
            &[],
            |row| row.get_text(0),
        )?;
        for id in ids {
            result.push((doc_type, id));
        }
    }
    Ok(result)
}

/// List all document IDs for a given type (including deleted).
pub fn list_all_doc_ids(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
) -> Result<Vec<String>, DbError> {
    conn.query_map(
        &format!("SELECT id FROM {}", doc_type.table_name()),
        &[],
        |row| row.get_text(0),
    )
}

/// Apply a remotely-merged Automerge document, dispatching to the right type.
pub fn apply_remote_merge_doc(
    conn: &(impl Connection + ?Sized),
    doc_type: DocType,
    id: &str,
    am_data: &[u8],
) -> Result<(), DbError> {
    match doc_type {
        DocType::Recipe => {
            let exists = get_recipe_row(conn, id)?.is_some();
            apply_remote_merge_generic::<RecipeDocument>(conn, id, am_data, exists)
        }
        DocType::Batch => {
            let exists = batch::get_batch_row(conn, id)?.is_some();
            apply_remote_merge_generic::<BatchDocument>(conn, id, am_data, exists)
        }
        DocType::Settings => {
            let exists = settings::get_settings(conn)?.is_some();
            apply_remote_merge_generic::<SettingsDocument>(conn, id, am_data, exists)
        }
        DocType::EquipmentProfile => {
            let exists = equipment_profile::get_equipment_profile_row(conn, id)?.is_some();
            apply_remote_merge_generic::<EquipmentProfileDocument>(conn, id, am_data, exists)
        }
        DocType::InventoryItem => {
            let exists = inventory::get_inventory_item_row(conn, id)?.is_some();
            apply_remote_merge_generic::<InventoryItemDocument>(conn, id, am_data, exists)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::beerjson_types::RecipeType;

    fn test_conn() -> rusqlite::Connection {
        crate::connection_native::open(":memory:").unwrap()
    }

    fn sample_recipe() -> RecipeType {
        serde_json::from_str(
            r#"{
                "name": "DB Test IPA",
                "type": "all grain",
                "author": "Tester",
                "batch_size": { "unit": "l", "value": 20.0 },
                "efficiency": {
                    "brewhouse": { "unit": "%", "value": 72.0 }
                },
                "ingredients": {
                    "fermentable_additions": [{
                        "name": "Pale Malt",
                        "type": "grain",
                        "amount": { "unit": "kg", "value": 5.0 },
                        "color": { "unit": "SRM", "value": 2.0 },
                        "yield": { "fine_grind": { "unit": "%", "value": 80.0 } }
                    }],
                    "hop_additions": [{
                        "name": "Cascade",
                        "timing": {
                            "duration": { "unit": "min", "value": 60 },
                            "use": "add_to_boil"
                        },
                        "amount": { "unit": "g", "value": 30.0 },
                        "form": "pellet",
                        "alpha_acid": { "unit": "%", "value": 5.5 }
                    }]
                }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn crud_operations() {
        let conn = test_conn();

        // Create
        let row = create_recipe(&conn, "Test IPA", &sample_recipe(), None, None).unwrap();
        assert_eq!(row.name, "Test IPA");
        assert!(!row.id.is_empty());
        assert!(row.is_dirty);
        assert!(row.equipment.is_none());

        // Get (row)
        let fetched = get_recipe_row(&conn, &row.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Test IPA");
        assert!(fetched.is_dirty);
        assert!(fetched.equipment.is_none());

        // Get (typed)
        let typed = get_recipe(&conn, &row.id).unwrap().unwrap();
        assert_eq!(typed.name, "Test IPA");
        assert!(typed.equipment.is_none());

        // List
        let recipes = list_recipes(&conn).unwrap();
        assert_eq!(recipes.len(), 1);
        assert_eq!(recipes[0].name, "Test IPA");

        // Update
        let mut updated_recipe = sample_recipe();
        updated_recipe.name = "Updated IPA".to_string();
        update_recipe(&conn, &row.id, "Updated IPA", &updated_recipe, None).unwrap();
        let fetched = get_recipe_row(&conn, &row.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Updated IPA");
        assert!(fetched.is_dirty);

        // Soft-delete
        delete_recipe(&conn, &row.id).unwrap();
        let recipes = list_recipes(&conn).unwrap();
        assert_eq!(recipes.len(), 0);

        // Typed get returns None for deleted recipes
        let typed = get_recipe(&conn, &row.id).unwrap();
        assert!(typed.is_none());

        // Still exists in DB, just marked as deleted
        let fetched = get_recipe_row(&conn, &row.id).unwrap().unwrap();
        assert!(fetched.is_deleted);
        assert!(fetched.is_dirty);
    }

    #[test]
    fn crud_with_equipment() {
        let conn = test_conn();
        let profile = brewdio_core::data::equipment()[0].clone();

        // Create with equipment
        let row = create_recipe(&conn, "Equipped IPA", &sample_recipe(), Some(&profile.equipment), Some(&profile.id)).unwrap();
        assert!(row.equipment.is_some());
        assert_eq!(row.equipment_id.as_deref(), Some("default-setup"));

        // Get (typed)
        let typed = get_recipe(&conn, &row.id).unwrap().unwrap();
        assert_eq!(typed.equipment.as_ref().unwrap().name, "Default Setup");
        assert_eq!(typed.equipment_id.as_deref(), Some("default-setup"));

        // Update with different equipment
        let biab = &brewdio_core::data::equipment()[1];
        update_recipe(&conn, &row.id, "BIAB IPA", &sample_recipe(), Some(&biab.equipment)).unwrap();
        let typed = get_recipe(&conn, &row.id).unwrap().unwrap();
        assert_eq!(typed.equipment.as_ref().unwrap().name, "BIAB (No Sparge)");

        // Update without equipment preserves existing
        update_recipe(&conn, &row.id, "Still Equipped", &sample_recipe(), None).unwrap();
        let typed = get_recipe(&conn, &row.id).unwrap().unwrap();
        assert_eq!(typed.equipment.as_ref().unwrap().name, "BIAB (No Sparge)");

        // Explicitly remove equipment
        set_recipe_equipment(&conn, &row.id, None, None).unwrap();
        let typed = get_recipe(&conn, &row.id).unwrap().unwrap();
        assert!(typed.equipment.is_none());
        assert!(typed.equipment_id.is_none());
    }

    #[test]
    fn dirty_tracking() {
        let conn = test_conn();

        // Create sets dirty
        let row = create_recipe(&conn, "Dirty Test", &sample_recipe(), None, None).unwrap();
        let dirty = list_dirty_docs(&conn).unwrap();
        let recipe_dirty: Vec<_> = dirty.iter().filter(|(dt, _)| *dt == DocType::Recipe).collect();
        assert_eq!(recipe_dirty.len(), 1);

        // Clear dirty
        clear_dirty_doc(&conn, DocType::Recipe, &row.id).unwrap();
        let dirty = list_dirty_docs(&conn).unwrap();
        let recipe_dirty: Vec<_> = dirty.iter().filter(|(dt, _)| *dt == DocType::Recipe).collect();
        assert_eq!(recipe_dirty.len(), 0);

        // Update sets dirty again
        update_recipe(&conn, &row.id, "Still Dirty", &sample_recipe(), None).unwrap();
        let dirty = list_dirty_docs(&conn).unwrap();
        let recipe_dirty: Vec<_> = dirty.iter().filter(|(dt, _)| *dt == DocType::Recipe).collect();
        assert_eq!(recipe_dirty.len(), 1);
    }

    #[test]
    fn sync_state_crud() {
        let conn = test_conn();

        // No sync state initially
        let state = get_sync_state(&conn, DocType::Recipe, "some-id", "server").unwrap();
        assert!(state.is_none());

        // Save sync state
        let fake_state = vec![1, 2, 3, 4];
        save_sync_state(&conn, DocType::Recipe, "some-id", "server", &fake_state).unwrap();

        let state = get_sync_state(&conn, DocType::Recipe, "some-id", "server").unwrap().unwrap();
        assert_eq!(state, fake_state);

        // Upsert
        let updated_state = vec![5, 6, 7];
        save_sync_state(&conn, DocType::Recipe, "some-id", "server", &updated_state).unwrap();
        let state = get_sync_state(&conn, DocType::Recipe, "some-id", "server").unwrap().unwrap();
        assert_eq!(state, updated_state);

        // Different doc_type for same doc_id is independent
        let state = get_sync_state(&conn, DocType::Batch, "some-id", "server").unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn apply_remote_merge_new_recipe() {
        let conn = test_conn();

        // Create AM data for a recipe that doesn't exist locally
        let doc = RecipeDocument {
            id: "remote-id".to_string(),
            name: "Remote Beer".to_string(),
            recipe: sample_recipe(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();

        apply_remote_merge_doc(&conn, DocType::Recipe, "remote-id", &am_data).unwrap();

        let fetched = get_recipe_row(&conn, "remote-id").unwrap().unwrap();
        assert_eq!(fetched.name, "Remote Beer");
        assert!(!fetched.is_dirty); // came from server, not dirty
    }

    #[test]
    fn apply_remote_merge_existing_recipe() {
        let conn = test_conn();

        let row = create_recipe(&conn, "Local Beer", &sample_recipe(), None, None).unwrap();
        clear_dirty_doc(&conn, DocType::Recipe, &row.id).unwrap();

        // Simulate a remote merge with updated name
        let doc = RecipeDocument {
            id: row.id.clone(),
            name: "Merged Beer".to_string(),
            recipe: sample_recipe(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();

        apply_remote_merge_doc(&conn, DocType::Recipe, &row.id, &am_data).unwrap();

        let fetched = get_recipe_row(&conn, &row.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Merged Beer");
        assert!(!fetched.is_dirty); // remote merge doesn't set dirty
    }

    #[test]
    fn apply_remote_merge_with_equipment() {
        let conn = test_conn();
        let profile = brewdio_core::data::equipment()[0].clone();

        let doc = RecipeDocument {
            id: "remote-equip".to_string(),
            name: "Remote Equipped".to_string(),
            recipe: sample_recipe(),
            equipment: Some(profile.equipment.clone()),
            equipment_id: Some(profile.id.clone()),
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();

        apply_remote_merge_doc(&conn, DocType::Recipe, "remote-equip", &am_data).unwrap();

        let typed = get_recipe(&conn, "remote-equip").unwrap().unwrap();
        assert_eq!(typed.equipment.as_ref().unwrap().name, "Default Setup");
    }

    #[test]
    fn list_all_doc_ids_includes_deleted() {
        let conn = test_conn();

        let row1 = create_recipe(&conn, "Beer 1", &sample_recipe(), None, None).unwrap();
        let row2 = create_recipe(&conn, "Beer 2", &sample_recipe(), None, None).unwrap();
        delete_recipe(&conn, &row2.id).unwrap();

        let ids = list_all_doc_ids(&conn, DocType::Recipe).unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&row1.id));
        assert!(ids.contains(&row2.id));
    }

    #[test]
    fn migration_version_tracking() {
        let conn = test_conn();

        // Verify user_version was set
        let version: i32 = conn
            .prepare("PRAGMA user_version")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert!(version > 0, "user_version should be set after migrations");

        // Verify the equipment column exists by inserting a row with equipment
        let profile = brewdio_core::data::equipment()[0].clone();
        let row = create_recipe(&conn, "Migration Test", &sample_recipe(), Some(&profile.equipment), Some(&profile.id)).unwrap();
        assert!(row.equipment.is_some());
        assert_eq!(row.equipment_id.as_deref(), Some("default-setup"));
    }
}
