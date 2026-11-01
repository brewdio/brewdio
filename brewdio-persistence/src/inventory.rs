use brewdio_core::inventory::InventoryItem;

use crate::automerge::{new_ulid, reconcile_to_automerge};
use crate::connection::{Connection, DbError, Value};
use crate::protocol::DocType;
use crate::traits::{SyncDocument, SyncRow};

pub struct InventoryItemRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub data: String,
    pub am_data: Vec<u8>,
    pub is_deleted: bool,
    pub is_dirty: bool,
}

#[derive(
    Clone,
    Debug,
    serde::Serialize,
    serde::Deserialize,
    autosurgeon::Reconcile,
    autosurgeon::Hydrate,
)]
pub struct InventoryItemDocument {
    pub id: String,
    pub item: InventoryItem,
    pub is_deleted: bool,
}

impl InventoryItemRow {
    pub fn to_item(&self) -> Result<InventoryItem, serde_json::Error> {
        serde_json::from_str(&self.data)
    }

    pub fn to_document(&self) -> Result<InventoryItemDocument, serde_json::Error> {
        Ok(InventoryItemDocument {
            id: self.id.clone(),
            item: self.to_item()?,
            is_deleted: self.is_deleted,
        })
    }
}

impl SyncDocument for InventoryItemDocument {
    fn id(&self) -> &str {
        &self.id
    }

    fn is_deleted(&self) -> bool {
        self.is_deleted
    }

    fn set_is_deleted(&mut self, deleted: bool) {
        self.is_deleted = deleted;
    }
}

impl SyncRow for InventoryItemRow {
    type Document = InventoryItemDocument;

    fn doc_type() -> DocType {
        DocType::InventoryItem
    }

    fn id(&self) -> &str {
        &self.id
    }

    fn am_data(&self) -> &[u8] {
        &self.am_data
    }

    fn into_document(&self) -> Result<Self::Document, DbError> {
        self.to_document().map_err(|e| DbError(e.to_string()))
    }
}

fn row_from_query(row: &dyn crate::connection::Row) -> InventoryItemRow {
    InventoryItemRow {
        id: row.get_text(0),
        name: row.get_text(1),
        kind: row.get_text(2),
        data: row.get_text(3),
        am_data: row.get_blob(4),
        is_deleted: row.get_bool(5),
        is_dirty: row.get_bool(6),
    }
}

pub fn create_inventory_item(
    conn: &(impl Connection + ?Sized),
    item: &InventoryItem,
) -> Result<InventoryItemRow, DbError> {
    let mut item = item.clone();
    item.id = if item.id.is_empty() {
        new_ulid()
    } else {
        item.id
    };

    let name = item.name().to_string();
    let kind = item.kind().to_string();
    let data = serde_json::to_string(&item).map_err(|e| DbError(e.to_string()))?;
    let doc = InventoryItemDocument {
        id: item.id.clone(),
        item,
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, None).map_err(DbError)?;

    conn.execute(
        "INSERT INTO inventory_item (id, name, kind, data, am_data) VALUES (?1, ?2, ?3, ?4, ?5)",
        &[
            Value::Text(&doc.id),
            Value::Text(&name),
            Value::Text(&kind),
            Value::Text(&data),
            Value::Blob(&am_data),
        ],
    )?;

    Ok(InventoryItemRow {
        id: doc.id,
        name,
        kind,
        data,
        am_data,
        is_deleted: false,
        is_dirty: true,
    })
}

pub fn get_inventory_item_row(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<Option<InventoryItemRow>, DbError> {
    conn.query_one(
        "SELECT id, name, kind, data, am_data, is_deleted, is_dirty FROM inventory_item WHERE id = ?1",
        &[Value::Text(id)],
        row_from_query,
    )
}

pub fn list_inventory_item_rows(
    conn: &(impl Connection + ?Sized),
) -> Result<Vec<InventoryItemRow>, DbError> {
    conn.query_map(
        "SELECT id, name, kind, data, am_data, is_deleted, is_dirty FROM inventory_item WHERE is_deleted = FALSE ORDER BY name",
        &[],
        row_from_query,
    )
}

pub fn get_inventory_item(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<Option<InventoryItem>, DbError> {
    get_inventory_item_row(conn, id)?
        .filter(|row| !row.is_deleted)
        .map(|row| row.to_item().map_err(|e| DbError(e.to_string())))
        .transpose()
}

pub fn list_inventory_items(
    conn: &(impl Connection + ?Sized),
) -> Result<Vec<InventoryItem>, DbError> {
    list_inventory_item_rows(conn)?
        .into_iter()
        .map(|row| row.to_item().map_err(|e| DbError(e.to_string())))
        .collect()
}

pub fn update_inventory_item(
    conn: &(impl Connection + ?Sized),
    id: &str,
    item: &InventoryItem,
) -> Result<(), DbError> {
    let existing = get_inventory_item_row(conn, id)?
        .ok_or_else(|| DbError(format!("Inventory item not found: {id}")))?;

    let mut item = item.clone();
    item.id = id.to_string();
    let name = item.name().to_string();
    let kind = item.kind().to_string();
    let data = serde_json::to_string(&item).map_err(|e| DbError(e.to_string()))?;
    let doc = InventoryItemDocument {
        id: id.to_string(),
        item,
        is_deleted: false,
    };
    let am_data = reconcile_to_automerge(&doc, Some(&existing.am_data)).map_err(DbError)?;

    conn.execute(
        "UPDATE inventory_item SET name = ?1, kind = ?2, data = ?3, am_data = ?4, is_deleted = FALSE, is_dirty = TRUE WHERE id = ?5",
        &[
            Value::Text(&name),
            Value::Text(&kind),
            Value::Text(&data),
            Value::Blob(&am_data),
            Value::Text(id),
        ],
    )
}

pub fn delete_inventory_item(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<(), DbError> {
    let existing = get_inventory_item_row(conn, id)?;
    crate::traits::set_deleted(conn, existing, id, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::beerjson_types::{MassType, MassUnitType};
    use brewdio_core::inventory::{
        InventoryIngredient, InventoryQuantity, InventorySource,
    };

    fn test_conn() -> rusqlite::Connection {
        crate::connection_native::open(":memory:").unwrap()
    }

    fn sample_item() -> InventoryItem {
        InventoryItem {
            id: String::new(),
            ingredient: InventoryIngredient::Fermentable(
                brewdio_core::data::fermentables()[0].clone(),
            ),
            source: InventorySource::BuiltIn,
            quantity: InventoryQuantity::Mass(MassType {
                unit: MassUnitType::Kg,
                value: 5.0,
            }),
            low_stock_threshold: Some(InventoryQuantity::Mass(MassType {
                unit: MassUnitType::Kg,
                value: 1.0,
            })),
            lot_number: Some("LOT-1".to_string()),
            best_before: Some("2027-01-01".to_string()),
            location: Some("Dry store".to_string()),
            notes: None,
            created_at: "2026-11-01T10:00:00Z".to_string(),
            updated_at: "2026-11-01T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn inventory_crud_and_dirty_tracking() {
        let conn = test_conn();
        let row = create_inventory_item(&conn, &sample_item()).unwrap();
        assert!(!row.id.is_empty());
        assert_eq!(row.kind, "fermentable");
        assert!(row.is_dirty);

        let mut item = get_inventory_item(&conn, &row.id).unwrap().unwrap();
        assert_eq!(item.id, row.id);
        assert_eq!(item.name(), row.name);
        item.location = Some("Shelf 2".to_string());
        update_inventory_item(&conn, &row.id, &item).unwrap();
        assert_eq!(
            get_inventory_item(&conn, &row.id)
                .unwrap()
                .unwrap()
                .location
                .as_deref(),
            Some("Shelf 2")
        );

        let dirty = crate::db::list_dirty_docs(&conn).unwrap();
        assert!(dirty
            .iter()
            .any(|(kind, id)| *kind == DocType::InventoryItem && id == &row.id));

        delete_inventory_item(&conn, &row.id).unwrap();
        assert!(get_inventory_item(&conn, &row.id).unwrap().is_none());
        assert!(list_inventory_items(&conn).unwrap().is_empty());
        assert!(get_inventory_item_row(&conn, &row.id)
            .unwrap()
            .unwrap()
            .is_deleted);
    }

    #[test]
    fn automerge_roundtrip() {
        let item = sample_item();
        let doc = InventoryItemDocument {
            id: "inventory-1".to_string(),
            item,
            is_deleted: false,
        };
        let bytes = reconcile_to_automerge(&doc, None).unwrap();
        let hydrated: InventoryItemDocument =
            crate::automerge::hydrate_from_automerge(&bytes).unwrap();
        assert_eq!(hydrated.id, "inventory-1");
        assert!(!hydrated.is_deleted);
    }
}
