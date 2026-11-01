use serde::{Deserialize, Serialize};

/// Document type discriminator for the sync protocol.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DocType {
    Recipe,
    Batch,
    Settings,
    EquipmentProfile,
    InventoryItem,
}

impl DocType {
    pub fn table_name(&self) -> &'static str {
        match self {
            DocType::Recipe => "recipe",
            DocType::Batch => "batch",
            DocType::Settings => "settings",
            DocType::EquipmentProfile => "equipment_profile",
            DocType::InventoryItem => "inventory_item",
        }
    }

    pub const ALL: &[DocType] = &[
        DocType::Recipe,
        DocType::Batch,
        DocType::Settings,
        DocType::EquipmentProfile,
        DocType::InventoryItem,
    ];
}

/// Wire protocol messages for Automerge sync over WebSocket.
/// Serialized as JSON and sent as WebSocket text frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SyncMessage {
    /// Startup handshake — each side sends its document IDs per type.
    Hello {
        recipe_ids: Vec<String>,
        batch_ids: Vec<String>,
        settings_ids: Vec<String>,
        #[serde(default)]
        equipment_profile_ids: Vec<String>,
        #[serde(default)]
        inventory_item_ids: Vec<String>,
        #[serde(default)]
        schema_version: u32,
    },
    /// Server rejects a client due to version mismatch.
    Reject {
        reason: String,
        server_version: u32,
        client_version: u32,
    },
    /// Automerge sync message for a specific document.
    SyncDoc {
        doc_type: DocType,
        doc_id: String,
        data: Vec<u8>,
    },
    /// Full doc for a document the other side doesn't have.
    NewDoc {
        doc_type: DocType,
        doc_id: String,
        am_data: Vec<u8>,
    },
}
