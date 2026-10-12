use crate::model::*;
use rusqlite::{params, Connection};
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, payload TEXT NOT NULL); PRAGMA user_version=1;").map_err(|e|e.to_string())?;
    Ok(conn)
}
pub fn load(conn: &Connection) -> Result<Data, String> {
    fn rows<T: serde::de::DeserializeOwned>(
        conn: &Connection,
        table: &str,
    ) -> Result<Vec<T>, String> {
        let mut stmt = conn
            .prepare(&format!("SELECT payload FROM {table} ORDER BY rowid"))
            .map_err(|e| e.to_string())?;
        let items = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        items
            .map(|r| {
                r.map_err(|e| e.to_string())
                    .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            })
            .collect()
    }
    let mut data = Data {
        tasks: rows(conn, "tasks")?,
        sessions: rows(conn, "sessions")?,
        ..Data::default()
    };
    let mut stmt = conn
        .prepare("SELECT key,payload FROM meta")
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
    {
        let (key, payload) = row.map_err(|e| e.to_string())?;
        match key.as_str() {
            "timer" => data.timer = serde_json::from_str(&payload).map_err(|e| e.to_string())?,
            "settings" => {
                data.settings = serde_json::from_str(&payload).map_err(|e| e.to_string())?
            }
            "notified" => {
                data.notified = serde_json::from_str(&payload).map_err(|e| e.to_string())?
            }
            "suspendedWork" => {
                data.suspended_work = serde_json::from_str(&payload).map_err(|e| e.to_string())?
            }
            _ => (),
        }
    }
    Ok(data)
}
#[cfg(test)]
pub fn save(conn: &mut Connection, data: &Data) -> Result<(), String> {
    save_with_priorities(conn, data, None)
}
pub fn read_meta<T: serde::de::DeserializeOwned>(
    conn: &Connection,
    key: &str,
) -> Result<Option<T>, String> {
    use rusqlite::OptionalExtension;
    let value: Option<String> = conn
        .query_row("SELECT payload FROM meta WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()
}
pub fn save_priority_metadata(
    conn: &mut Connection,
    priorities: &crate::priorities::Priorities,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO meta(key,payload) VALUES('priorities',?1)",
        [serde_json::to_string(priorities).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn save_with_priorities(
    conn: &mut Connection,
    data: &Data,
    priorities: Option<&crate::priorities::Priorities>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("DELETE FROM tasks; DELETE FROM sessions;")
        .map_err(|e| e.to_string())?;
    for task in &data.tasks {
        tx.execute(
            "INSERT INTO tasks VALUES (?1,?2)",
            params![
                task.id,
                serde_json::to_string(task).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for session in &data.sessions {
        tx.execute(
            "INSERT INTO sessions VALUES (?1,?2)",
            params![
                session.id,
                serde_json::to_string(session).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for (key, payload) in [
        ("timer", serde_json::to_string(&data.timer)),
        ("settings", serde_json::to_string(&data.settings)),
        ("notified", serde_json::to_string(&data.notified)),
        ("suspendedWork", serde_json::to_string(&data.suspended_work)),
    ] {
        tx.execute(
            "INSERT OR REPLACE INTO meta VALUES (?1,?2)",
            params![key, payload.map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(priorities) = priorities {
        tx.execute(
            "INSERT OR REPLACE INTO meta(key,payload) VALUES('priorities',?1)",
            [serde_json::to_string(priorities).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sqlite_roundtrip_preserves_paused_timer_and_settings() {
        let mut c = open(Path::new(":memory:")).unwrap();
        let mut d = Data::default();
        d.timer.begin(None, "work", 45, 100);
        d.timer.pause(50100).unwrap();
        d.settings.quiet_mode = true;
        save(&mut c, &d).unwrap();
        let loaded = load(&c).unwrap();
        assert_eq!(loaded.timer.remaining_ms(100000), 2_650_000);
        assert!(loaded.settings.quiet_mode);
    }
}
