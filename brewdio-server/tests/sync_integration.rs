use std::sync::{Arc, Mutex};

use tokio::net::TcpListener;
use tokio::time::{sleep, timeout, Duration};

use brewdio_core::beerjson_types::RecipeType;
use brewdio_persistence::automerge::reconcile_to_automerge;
use brewdio_persistence::batch;
use brewdio_persistence::recipe::RecipeDocument;
use brewdio_persistence::settings;
use brewdio_persistence::{connection_native, db, sync_worker};

use brewdio_server::auth::config::AuthConfig;
use brewdio_server::auth::jwt::encode_token;
use brewdio_server::auth::password::hash_password;
use brewdio_server::db as server_db;

fn sample_recipe() -> RecipeType {
    serde_json::from_str(
        r#"{
            "name": "Test IPA",
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

const TEST_JWT_SECRET: &str = "test-secret-for-integration-tests";
const TEST_USER_ID: &str = "test-user-001";
const TEST_USER_EMAIL: &str = "test@example.com";
const SECOND_USER_ID: &str = "test-user-002";
const SECOND_USER_EMAIL: &str = "other@example.com";

fn test_auth_config() -> AuthConfig {
    AuthConfig {
        jwt_secret: TEST_JWT_SECRET.to_string(),
        allow_signups: true,
        google_client_id: None,
        admin_email: None,
        admin_password: None,
        no_auth: false,
    }
}

fn jwt_for(user_id: &str, email: &str) -> String {
    let user = server_db::UserRow {
        id: user_id.to_string(),
        email: email.to_string(),
        password_hash: None,
        google_id: None,
        display_name: "Test User".to_string(),
        is_admin: true,
    };
    encode_token(&user, TEST_JWT_SECRET).unwrap()
}

fn test_jwt() -> String {
    jwt_for(TEST_USER_ID, TEST_USER_EMAIL)
}

/// Set up server connection with server-only migrations and test user.
fn setup_server_conn() -> Arc<Mutex<rusqlite::Connection>> {
    let conn = connection_native::open(":memory:").unwrap();
    server_db::run_server_migrations(&conn).unwrap();
    let hash = hash_password("testpass").unwrap();
    server_db::create_user(&conn, TEST_USER_ID, TEST_USER_EMAIL, Some(&hash), None, "Test User", true).unwrap();
    Arc::new(Mutex::new(conn))
}

#[tokio::test]
async fn client_to_server_sync() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    {
        let c = client_conn.lock().unwrap();
        db::create_recipe(&*c, "Client IPA", &sample_recipe(), None, None).unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    let recipes = timeout(Duration::from_secs(10), async {
        loop {
            let recipes = {
                let c = server_conn.lock().unwrap();
                db::list_recipes(&*c).unwrap()
            };
            if !recipes.is_empty() {
                return recipes;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for recipe to sync to server");

    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].name, "Client IPA");

    {
        let c = server_conn.lock().unwrap();
        let owner: String = c
            .query_row(
                "SELECT user_id FROM recipe WHERE id = ?1",
                rusqlite::params![recipes[0].id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, TEST_USER_ID);
    }

    // Also verify client-side recipe is still present
    {
        let c = client_conn.lock().unwrap();
        let client_recipes = db::list_recipes(&*c).unwrap();
        assert_eq!(client_recipes.len(), 1);
    }
}

#[tokio::test]
async fn server_to_client_sync() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    {
        let c = server_conn.lock().unwrap();
        db::create_recipe(&*c, "Server Stout", &sample_recipe(), None, None).unwrap();
        // Assign user_id to the recipe so it's visible to the authenticated user
        c.execute(
            "UPDATE recipe SET user_id = ?1 WHERE user_id IS NULL",
            rusqlite::params![TEST_USER_ID],
        ).unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    let recipes = timeout(Duration::from_secs(10), async {
        loop {
            let recipes = {
                let c = client_conn.lock().unwrap();
                db::list_recipes(&*c).unwrap()
            };
            if !recipes.is_empty() {
                return recipes;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for recipe to sync to client");

    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].name, "Server Stout");

    // Also verify server-side recipe is still present
    {
        let c = server_conn.lock().unwrap();
        let server_recipes = db::list_recipes(&*c).unwrap();
        assert_eq!(server_recipes.len(), 1);
    }
}

#[tokio::test]
async fn authenticated_user_only_receives_owned_documents() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    {
        let c = server_conn.lock().unwrap();
        server_db::create_user(
            &*c,
            SECOND_USER_ID,
            SECOND_USER_EMAIL,
            None,
            None,
            "Other User",
            false,
        )
        .unwrap();

        let own_recipe = db::create_recipe(
            &*c,
            "Owned IPA",
            &sample_recipe(),
            None,
            None,
        )
        .unwrap();
        let other_recipe = db::create_recipe(
            &*c,
            "Other Stout",
            &sample_recipe(),
            None,
            None,
        )
        .unwrap();
        c.execute(
            "UPDATE recipe SET user_id = ?1 WHERE id = ?2",
            rusqlite::params![TEST_USER_ID, own_recipe.id],
        )
        .unwrap();
        c.execute(
            "UPDATE recipe SET user_id = ?1 WHERE id = ?2",
            rusqlite::params![SECOND_USER_ID, other_recipe.id],
        )
        .unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    timeout(Duration::from_secs(10), async {
        loop {
            let recipes = {
                let c = client_conn.lock().unwrap();
                db::list_recipes(&*c).unwrap()
            };
            if recipes.len() == 1 {
                return;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for owned recipe to sync");

    sleep(Duration::from_millis(500)).await;
    let recipes = {
        let c = client_conn.lock().unwrap();
        db::list_recipes(&*c).unwrap()
    };
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].name, "Owned IPA");
}

#[tokio::test]
async fn authenticated_user_cannot_overwrite_another_users_document() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));
    let recipe_id = "protected-recipe";
    let recipe = sample_recipe();

    {
        let c = server_conn.lock().unwrap();
        server_db::create_user(
            &*c,
            SECOND_USER_ID,
            SECOND_USER_EMAIL,
            None,
            None,
            "Other User",
            false,
        )
        .unwrap();
        let doc = RecipeDocument {
            id: recipe_id.to_string(),
            name: "Protected Recipe".to_string(),
            recipe: recipe.clone(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();
        let recipe_json = serde_json::to_string(&recipe).unwrap();
        c.execute(
            "INSERT INTO recipe (id, name, recipe, am_data, is_deleted, is_dirty, user_id) VALUES (?1, ?2, ?3, ?4, FALSE, TRUE, ?5)",
            rusqlite::params![recipe_id, "Protected Recipe", recipe_json, am_data, TEST_USER_ID],
        )
        .unwrap();
    }

    {
        let c = client_conn.lock().unwrap();
        let doc = RecipeDocument {
            id: recipe_id.to_string(),
            name: "Unauthorized Change".to_string(),
            recipe: recipe.clone(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();
        let recipe_json = serde_json::to_string(&recipe).unwrap();
        c.execute(
            "INSERT INTO recipe (id, name, recipe, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, FALSE, TRUE)",
            rusqlite::params![recipe_id, "Unauthorized Change", recipe_json, am_data],
        )
        .unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(
        client_conn,
        url,
        Some(jwt_for(SECOND_USER_ID, SECOND_USER_EMAIL)),
        &handle,
    );

    sleep(Duration::from_secs(2)).await;
    let c = server_conn.lock().unwrap();
    let protected = db::get_recipe(&*c, recipe_id).unwrap().unwrap();
    assert_eq!(protected.name, "Protected Recipe");
    let owner: String = c
        .query_row(
            "SELECT user_id FROM recipe WHERE id = ?1",
            rusqlite::params![recipe_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(owner, TEST_USER_ID);
}

/// Both sides have the same recipe (same ID, independently created AM docs).
/// This exercises the SyncDoc path for shared recipes and verifies is_deleted
/// stays false through the merge.
#[tokio::test]
async fn shared_recipe_sync_preserves_is_deleted() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    let recipe_id = "shared-recipe-1";
    let recipe = sample_recipe();

    // Create the same recipe on both sides with the same ID but different AM docs (different actors)
    {
        let doc = RecipeDocument {
            id: recipe_id.to_string(),
            name: "Server Version".to_string(),
            recipe: recipe.clone(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();
        let recipe_json = serde_json::to_string(&recipe).unwrap();

        let c = server_conn.lock().unwrap();
        c.execute(
            "INSERT INTO recipe (id, name, recipe, am_data, is_deleted, is_dirty, user_id) VALUES (?1, ?2, ?3, ?4, FALSE, TRUE, ?5)",
            rusqlite::params![recipe_id, "Server Version", recipe_json, am_data, TEST_USER_ID],
        ).unwrap();
    }
    {
        let doc = RecipeDocument {
            id: recipe_id.to_string(),
            name: "Client Version".to_string(),
            recipe: recipe.clone(),
            equipment: None,
            equipment_id: None,
            is_deleted: false,
        };
        let am_data = reconcile_to_automerge(&doc, None).unwrap();
        let recipe_json = serde_json::to_string(&recipe).unwrap();

        let c = client_conn.lock().unwrap();
        c.execute(
            "INSERT INTO recipe (id, name, recipe, am_data, is_deleted, is_dirty) VALUES (?1, ?2, ?3, ?4, FALSE, TRUE)",
            rusqlite::params![recipe_id, "Client Version", recipe_json, am_data],
        ).unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    // Wait for sync to converge (names should match on both sides)
    timeout(Duration::from_secs(10), async {
        loop {
            let server_name = {
                let c = server_conn.lock().unwrap();
                db::get_recipe(&*c, recipe_id).unwrap().map(|r| r.name.clone())
            };
            let client_name = {
                let c = client_conn.lock().unwrap();
                db::get_recipe(&*c, recipe_id).unwrap().map(|r| r.name.clone())
            };
            if server_name == client_name {
                return;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for shared recipe to converge");

    // Verify both sides still have the recipe (list_recipes/get_recipe filter out soft-deleted)
    {
        let c = server_conn.lock().unwrap();
        assert!(db::get_recipe(&*c, recipe_id).unwrap().is_some(), "Server recipe should still exist after shared sync");
        assert_eq!(db::list_recipes(&*c).unwrap().len(), 1, "Server should still list 1 recipe");
    }
    {
        let c = client_conn.lock().unwrap();
        assert!(db::get_recipe(&*c, recipe_id).unwrap().is_some(), "Client recipe should still exist after shared sync");
        assert_eq!(db::list_recipes(&*c).unwrap().len(), 1, "Client should still list 1 recipe");
    }
}

#[tokio::test]
async fn batch_client_to_server_sync() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    // Create a batch on the client
    {
        let c = client_conn.lock().unwrap();
        let profile = &brewdio_core::data::equipment()[0];
        batch::create_batch_from_recipe(
            &*c,
            "Test Batch",
            "recipe-1",
            &sample_recipe(),
            &profile.equipment,
            &profile.id,
        )
        .unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    let batches = timeout(Duration::from_secs(10), async {
        loop {
            let batches = {
                let c = server_conn.lock().unwrap();
                batch::list_batches(&*c).unwrap()
            };
            if !batches.is_empty() {
                return batches;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for batch to sync to server");

    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].name, "Test Batch");
}

#[tokio::test]
async fn settings_client_to_server_sync() {
    let server_conn = setup_server_conn();
    let client_conn = Arc::new(Mutex::new(connection_native::open(":memory:").unwrap()));

    // Save settings on the client
    {
        let c = client_conn.lock().unwrap();
        let mut doc = settings::SettingsDocument::default();
        doc.vim_mode = true;
        settings::save_settings(&*c, &doc).unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = brewdio_server::start_server(listener, server_conn.clone(), test_auth_config());

    let url = format!("ws://{}/ws", addr);
    let handle = sync_worker::SyncHandle::new();
    let _client = sync_worker::spawn_sync(client_conn.clone(), url, Some(test_jwt()), &handle);

    let synced_settings = timeout(Duration::from_secs(10), async {
        loop {
            let s = {
                let c = server_conn.lock().unwrap();
                settings::get_settings(&*c).unwrap()
            };
            if let Some(row) = s {
                return row;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Timed out waiting for settings to sync to server");

    let synced_doc: serde_json::Value = serde_json::from_str(&synced_settings.data).unwrap();
    assert_eq!(synced_doc["vimMode"], serde_json::json!(true));
}
