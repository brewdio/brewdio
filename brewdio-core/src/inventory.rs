use crate::beerjson_types::{
    CultureInformation, FermentableType, HopVarietyBase, MassType, UnitType, VolumeType,
};

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum InventoryIngredient {
    Fermentable(FermentableType),
    Hop(HopVarietyBase),
    Culture(CultureInformation),
}

impl InventoryIngredient {
    pub fn name(&self) -> &str {
        match self {
            Self::Fermentable(value) => &value.name,
            Self::Hop(value) => &value.name,
            Self::Culture(value) => &value.name,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Fermentable(_) => "fermentable",
            Self::Hop(_) => "hop",
            Self::Culture(_) => "culture",
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum InventoryQuantity {
    Mass(MassType),
    Volume(VolumeType),
    Unit(UnitType),
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(rename_all = "snake_case")]
pub enum InventorySource {
    BuiltIn,
    Custom,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub ingredient: InventoryIngredient,
    pub source: InventorySource,
    pub quantity: InventoryQuantity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low_stock_threshold: Option<InventoryQuantity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lot_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(rename_all = "camelCase")]
pub struct InventoryDeduction {
    pub inventory_item_id: String,
    pub ingredient_name: String,
    pub quantity: InventoryQuantity,
    pub before: InventoryQuantity,
    pub after: InventoryQuantity,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[cfg_attr(feature = "crdt", derive(autosurgeon::Hydrate, autosurgeon::Reconcile))]
#[serde(rename_all = "camelCase")]
pub struct InventoryShortage {
    pub ingredient_name: String,
    pub required: InventoryQuantity,
    pub missing: InventoryQuantity,
}

impl InventoryItem {
    pub fn name(&self) -> &str {
        self.ingredient.name()
    }

    pub fn kind(&self) -> &'static str {
        self.ingredient.kind()
    }
}
