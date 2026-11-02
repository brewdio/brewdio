use std::fmt;

/// Versioned migrations. Each entry is run once, in order, tracked by PRAGMA user_version.
const MIGRATIONS: &[&str] = &[
    // V0 → V1: Initial schema
    r#"
    CREATE TABLE IF NOT EXISTS recipe (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        recipe TEXT NOT NULL,
        am_data BLOB NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_dirty BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS sync_state (
        recipe_id TEXT NOT NULL,
        peer_id TEXT NOT NULL DEFAULT 'server',
        state BLOB NOT NULL,
        PRIMARY KEY (recipe_id, peer_id),
        FOREIGN KEY (recipe_id) REFERENCES recipe(id)
    );

    CREATE TABLE IF NOT EXISTS batch (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        recipe_id TEXT NOT NULL,
        data TEXT NOT NULL,
        am_data BLOB NOT NULL DEFAULT X'',
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_dirty BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
        data TEXT NOT NULL,
        am_data BLOB NOT NULL DEFAULT X'',
        is_dirty BOOLEAN NOT NULL DEFAULT TRUE
    );
    "#,
    // V1 → V2: Add equipment to recipes
    "ALTER TABLE recipe ADD COLUMN equipment TEXT;",
    // V2 → V3: Add equipment_profile table and recipe equipment_id column
    r#"
    CREATE TABLE IF NOT EXISTS equipment_profile (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        efficiency TEXT NOT NULL,
        am_data BLOB NOT NULL DEFAULT X'',
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_dirty BOOLEAN NOT NULL DEFAULT TRUE
    );

    ALTER TABLE recipe ADD COLUMN equipment_id TEXT;
    "#,
    // V3 → V4: Generalize sync_state for all doc types
    r#"
    DROP TABLE IF EXISTS sync_state;
    CREATE TABLE sync_state (
        doc_type TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        peer_id TEXT NOT NULL DEFAULT 'server',
        state BLOB NOT NULL,
        PRIMARY KEY (doc_type, doc_id, peer_id)
    );
    "#,
    // V4 → V5: Add synced inventory items
    r#"
    CREATE TABLE IF NOT EXISTS inventory_item (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        am_data BLOB NOT NULL DEFAULT X'',
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        is_dirty BOOLEAN NOT NULL DEFAULT TRUE
    );
    "#,
];

/// The current schema version, derived from the number of migrations applied.
pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

/// Run all pending migrations and update PRAGMA user_version.
pub fn run_migrations(conn: &(impl Connection + ?Sized)) -> Result<(), DbError> {
    let version: i32 = conn
        .query_one("PRAGMA user_version", &[], |row| {
            row.get_text(0).parse().unwrap_or(0)
        })?
        .unwrap_or(0);

    let target = MIGRATIONS.len() as i32;
    for i in version..target {
        conn.execute_batch(MIGRATIONS[i as usize])?;
    }

    if version < target {
        conn.execute_batch(&format!("PRAGMA user_version = {};", target))?;
    }
    Ok(())
}

/// Parameter value for binding to SQL statements.
pub enum Value<'a> {
    Text(&'a str),
    OptionalText(Option<&'a str>),
    Blob(&'a [u8]),
    Int(i32),
    Bool(bool),
}

/// Trait for reading column values from a result row.
pub trait Row {
    fn get_text(&self, idx: usize) -> String;
    fn get_optional_text(&self, idx: usize) -> Option<String>;
    fn get_blob(&self, idx: usize) -> Vec<u8>;
    fn get_bool(&self, idx: usize) -> bool;
}

/// Unified database error type.
#[derive(Debug)]
pub struct DbError(pub String);

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for DbError {}

#[cfg(feature = "native")]
impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError(e.to_string())
    }
}

/// Abstraction over SQLite connection backends.
pub trait Connection {
    fn execute(&self, sql: &str, params: &[Value]) -> Result<(), DbError>;
    fn execute_batch(&self, sql: &str) -> Result<(), DbError>;
    fn query_map<T, F>(&self, sql: &str, params: &[Value], f: F) -> Result<Vec<T>, DbError>
    where
        F: FnMut(&dyn Row) -> T;
    fn query_one<T, F>(&self, sql: &str, params: &[Value], f: F) -> Result<Option<T>, DbError>
    where
        F: FnMut(&dyn Row) -> T,
    {
        let mut results = self.query_map(sql, params, f)?;
        Ok(results.pop())
    }
}

impl<T: Connection> Connection for std::sync::Mutex<T> {
    fn execute(&self, sql: &str, params: &[Value]) -> Result<(), DbError> {
        self.lock()
            .unwrap_or_else(|e| e.into_inner())
            .execute(sql, params)
    }
    fn execute_batch(&self, sql: &str) -> Result<(), DbError> {
        self.lock()
            .unwrap_or_else(|e| e.into_inner())
            .execute_batch(sql)
    }
    fn query_map<T2, F>(&self, sql: &str, params: &[Value], f: F) -> Result<Vec<T2>, DbError>
    where
        F: FnMut(&dyn Row) -> T2,
    {
        self.lock()
            .unwrap_or_else(|e| e.into_inner())
            .query_map(sql, params, f)
    }
}
