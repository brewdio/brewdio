pub const VERSION: &str = env!("BREWDIO_VERSION");

pub mod beerjson_types;
pub mod data;
pub mod equipment_profile;
pub mod inventory;
pub mod units;

pub mod abv;
pub mod carbonation;
pub mod color;
pub mod fg;
pub mod ibu;
pub mod og;
pub mod olfarve;
pub mod water;

#[macro_export]
macro_rules! brewing_model {
    ($item:item) => {
        #[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
        #[cfg_attr(feature = "wasm", derive(tsify::Tsify))]
        #[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
        $item
    };
}
