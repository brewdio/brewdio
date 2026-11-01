use brewdio_persistence::connection::{Connection, DbError, Value};

/// Server-only migration: adds user table and user_id columns to data tables.
/// Runs after the shared migrations from brewdio-persistence.
/// Uses a separate version pragma (user_version is taken by shared migrations).
const SERVER_MIGRATIONS: &[&str] = &[
    // SV0 → SV1: Users table + user_id on data tables
    r#"
    CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        google_id TEXT UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE recipe ADD COLUMN user_id TEXT REFERENCES user(id);
    ALTER TABLE batch ADD COLUMN user_id TEXT REFERENCES user(id);
    ALTER TABLE settings ADD COLUMN user_id TEXT REFERENCES user(id);
    ALTER TABLE equipment_profile ADD COLUMN user_id TEXT REFERENCES user(id);

    CREATE INDEX idx_recipe_user_id ON recipe(user_id);
    CREATE INDEX idx_batch_user_id ON batch(user_id);
    CREATE INDEX idx_settings_user_id ON settings(user_id);
    CREATE INDEX idx_equipment_profile_user_id ON equipment_profile(user_id);
    "#,
    // SV1 → SV2: Associate inventory items with users
    r#"
    ALTER TABLE inventory_item ADD COLUMN user_id TEXT REFERENCES user(id);
    CREATE INDEX idx_inventory_item_user_id ON inventory_item(user_id);
    "#,
];

/// Run server-only migrations. Uses application_id pragma to track version
/// independently from the shared user_version pragma.
pub fn run_server_migrations(conn: &(impl Connection + ?Sized)) -> Result<(), DbError> {
    let version: i32 = conn
        .query_one("PRAGMA application_id", &[], |row| {
            row.get_text(0).parse().unwrap_or(0)
        })?
        .unwrap_or(0);

    let target = SERVER_MIGRATIONS.len() as i32;
    for i in version..target {
        conn.execute_batch(SERVER_MIGRATIONS[i as usize])?;
    }

    if version < target {
        conn.execute_batch(&format!("PRAGMA application_id = {};", target))?;
    }
    Ok(())
}

// --- User CRUD ---

pub struct UserRow {
    pub id: String,
    pub email: String,
    pub password_hash: Option<String>,
    pub google_id: Option<String>,
    pub display_name: String,
    pub is_admin: bool,
}

pub fn create_user(
    conn: &(impl Connection + ?Sized),
    id: &str,
    email: &str,
    password_hash: Option<&str>,
    google_id: Option<&str>,
    display_name: &str,
    is_admin: bool,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO user (id, email, password_hash, google_id, display_name, is_admin) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        &[
            Value::Text(id),
            Value::Text(email),
            Value::OptionalText(password_hash),
            Value::OptionalText(google_id),
            Value::Text(display_name),
            Value::Bool(is_admin),
        ],
    )
}

pub fn get_user_by_email(
    conn: &(impl Connection + ?Sized),
    email: &str,
) -> Result<Option<UserRow>, DbError> {
    conn.query_one(
        "SELECT id, email, password_hash, google_id, display_name, is_admin FROM user WHERE email = ?1",
        &[Value::Text(email)],
        |row| UserRow {
            id: row.get_text(0),
            email: row.get_text(1),
            password_hash: row.get_optional_text(2),
            google_id: row.get_optional_text(3),
            display_name: row.get_text(4),
            is_admin: row.get_bool(5),
        },
    )
}

pub fn get_user_by_id(
    conn: &(impl Connection + ?Sized),
    id: &str,
) -> Result<Option<UserRow>, DbError> {
    conn.query_one(
        "SELECT id, email, password_hash, google_id, display_name, is_admin FROM user WHERE id = ?1",
        &[Value::Text(id)],
        |row| UserRow {
            id: row.get_text(0),
            email: row.get_text(1),
            password_hash: row.get_optional_text(2),
            google_id: row.get_optional_text(3),
            display_name: row.get_text(4),
            is_admin: row.get_bool(5),
        },
    )
}

pub fn get_user_by_google_id(
    conn: &(impl Connection + ?Sized),
    google_id: &str,
) -> Result<Option<UserRow>, DbError> {
    conn.query_one(
        "SELECT id, email, password_hash, google_id, display_name, is_admin FROM user WHERE google_id = ?1",
        &[Value::Text(google_id)],
        |row| UserRow {
            id: row.get_text(0),
            email: row.get_text(1),
            password_hash: row.get_optional_text(2),
            google_id: row.get_optional_text(3),
            display_name: row.get_text(4),
            is_admin: row.get_bool(5),
        },
    )
}

/// Upsert admin user: create if not exists, or update password_hash and is_admin if exists.
pub fn upsert_admin(
    conn: &(impl Connection + ?Sized),
    id: &str,
    email: &str,
    password_hash: &str,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO user (id, email, password_hash, display_name, is_admin)
         VALUES (?1, ?2, ?3, 'Admin', TRUE)
         ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, is_admin = TRUE, updated_at = datetime('now')",
        &[
            Value::Text(id),
            Value::Text(email),
            Value::Text(password_hash),
        ],
    )
}

/// Claim all unowned data when the supplied user is the only registered user.
/// This safely migrates data created before authentication was enabled without
/// guessing ownership on a multi-user server.
pub fn claim_unowned_data_if_only_user(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
) -> Result<bool, DbError> {
    let user_count = conn
        .query_one("SELECT COUNT(*) FROM user", &[], |row| {
            row.get_text(0).parse::<usize>().unwrap_or(0)
        })?
        .unwrap_or(0);

    if user_count != 1 {
        return Ok(false);
    }

    claim_unowned_data(conn, user_id)?;
    Ok(true)
}

/// Claim all unowned data (user_id IS NULL) for a given user.
pub fn claim_unowned_data(
    conn: &(impl Connection + ?Sized),
    user_id: &str,
) -> Result<(), DbError> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| {
        for table in &[
            "recipe",
            "batch",
            "settings",
            "equipment_profile",
            "inventory_item",
        ] {
            conn.execute(
                &format!("UPDATE {} SET user_id = ?1 WHERE user_id IS NULL", table),
                &[Value::Text(user_id)],
            )?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => conn.execute_batch("COMMIT;"),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brewdio_core::beerjson_types::RecipeType;
    use brewdio_persistence::{connection_native, db as persistence_db};

    fn sample_recipe() -> RecipeType {
        serde_json::from_str(
            r#"{
                "name": "Ownership Test",
                "type": "all grain",
                "author": "Tester",
                "batch_size": { "unit": "l", "value": 20.0 },
                "efficiency": { "brewhouse": { "unit": "%", "value": 72.0 } },
                "ingredients": { "fermentable_additions": [], "hop_additions": [] }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn only_user_claims_unowned_data() {
        let conn = connection_native::open(":memory:").unwrap();
        run_server_migrations(&conn).unwrap();
        let recipe = persistence_db::create_recipe(
            &conn,
            "Ownership Test",
            &sample_recipe(),
            None,
            None,
        )
        .unwrap();
        create_user(&conn, "user-1", "one@example.com", None, None, "", false).unwrap();

        assert!(claim_unowned_data_if_only_user(&conn, "user-1").unwrap());
        let owner: String = conn
            .query_row(
                "SELECT user_id FROM recipe WHERE id = ?1",
                rusqlite::params![recipe.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, "user-1");
    }

    #[test]
    fn multiple_users_do_not_claim_ambiguous_data() {
        let conn = connection_native::open(":memory:").unwrap();
        run_server_migrations(&conn).unwrap();
        let recipe = persistence_db::create_recipe(
            &conn,
            "Ownership Test",
            &sample_recipe(),
            None,
            None,
        )
        .unwrap();
        create_user(&conn, "user-1", "one@example.com", None, None, "", false).unwrap();
        create_user(&conn, "user-2", "two@example.com", None, None, "", false).unwrap();

        assert!(!claim_unowned_data_if_only_user(&conn, "user-1").unwrap());
        let owner: Option<String> = conn
            .query_row(
                "SELECT user_id FROM recipe WHERE id = ?1",
                rusqlite::params![recipe.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(owner.is_none());
    }
}
