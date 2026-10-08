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
            _ => (),
        }
    }
    Ok(data)
}
pub fn save(conn: &mut Connection, data: &Data) -> Result<(), String> {
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
    ] {
        tx.execute(
            "INSERT OR REPLACE INTO meta VALUES (?1,?2)",
            params![key, payload.map_err(|e| e.to_string())?],
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
