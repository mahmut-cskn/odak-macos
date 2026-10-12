//! Optional priorities are independent of existing task payloads and SQLite schema.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::Path};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Priorities(pub BTreeMap<String, u8>);
impl Priorities {
    pub fn validate(&self) -> Result<(), String> {
        if self.0.values().any(|rating| !(1..=5).contains(rating)) {
            return Err("Öncelik 1–5 yıldız arasında olmalı.".into());
        }
        Ok(())
    }
    pub fn resolve_legacy_series(&mut self, tasks: &[crate::model::Task], today: &str) {
        let mut latest = BTreeMap::<String, (String, u8)>::new();
        for task in tasks {
            if let (Some(series), Some(date), Some(rating)) =
                (&task.series_id, &task.scheduled_date, self.0.get(&task.id))
            {
                if date.as_str() <= today
                    && tasks
                        .iter()
                        .any(|parent| &parent.id == series && crate::model::is_series(parent))
                    && latest.get(series).is_none_or(|(prior, _)| date >= prior)
                {
                    latest.insert(series.clone(), (date.clone(), *rating));
                }
            }
        }
        for (series, (_, rating)) in latest {
            self.0.insert(series, rating);
        }
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let store: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if store.0.values().any(|rating| !(1..=5).contains(rating)) {
                    return Err("Öncelik 1–5 yıldız arasında olmalı.".into());
                }
                Ok(store)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn set(&mut self, id: &str, rating: u8) -> Result<(), String> {
        if !(1..=5).contains(&rating) {
            return Err("Öncelik 1–5 yıldız arasında olmalı.".into());
        }
        self.0.insert(id.into(), rating);
        Ok(())
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let temp = path.with_extension("json.tmp");
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(temp, path).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            std::fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_daily_ratings_resolve_to_a_shared_series_without_removing_old_keys() {
        let mut p = Priorities::default();
        p.set("series", 2).unwrap();
        p.set("old", 4).unwrap();
        p.set("recent", 5).unwrap();
        let task = |id: &str, day: &str, series: Option<&str>, recurring: bool| {
            serde_json::from_value::<crate::model::Task>(serde_json::json!({"id":id,"title":"Task","label":"İş","color":"#438470","notes":"","status":"active","completedAt":null,"estimateMin":null,"scheduledDate":day,"startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":if recurring {serde_json::json!({"frequency":"daily","weekdays":[],"monthDay":1})} else {serde_json::Value::Null},"seriesId":series,"subtasks":[],"createdAt":0})).unwrap()
        };
        let tasks = vec![
            task("series", "2026-10-01", None, true),
            task("old", "2026-10-09", Some("series"), false),
            task("recent", "2026-10-12", Some("series"), false),
        ];
        p.resolve_legacy_series(&tasks, "2026-10-12");
        assert_eq!(p.0["series"], 5);
        assert_eq!(p.0["old"], 4);
        assert_eq!(p.0["recent"], 5);
    }
    #[test]
    fn sqlite_priority_metadata_survives_reopen_with_all_task_and_timer_rows_unchanged() {
        let dir = std::env::temp_dir().join(format!("odak-sql-priority-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("data.sqlite3");
        let mut conn = crate::storage::open(&file).unwrap();
        let data = crate::model::Data::default();
        crate::storage::save(&mut conn, &data).unwrap();
        let mut p = Priorities::default();
        p.set("series", 5).unwrap();
        crate::storage::save_priority_metadata(&mut conn, &p).unwrap();
        drop(conn);
        let conn = crate::storage::open(&file).unwrap();
        let saved: Priorities = crate::storage::read_meta(&conn, "priorities")
            .unwrap()
            .unwrap();
        assert_eq!(saved.0["series"], 5);
        assert_eq!(
            serde_json::to_value(crate::storage::load(&conn).unwrap()).unwrap(),
            serde_json::to_value(data).unwrap()
        );
        let changed = conn.total_changes();
        crate::storage::load(&conn).unwrap();
        let _: Option<Priorities> = crate::storage::read_meta(&conn, "priorities").unwrap();
        assert_eq!(conn.total_changes(), changed);
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn priority_survives_restart_and_rejects_out_of_range() {
        let dir = std::env::temp_dir().join(format!("odak-priority-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("priorities.json");
        let mut p = Priorities::default();
        p.set("old-task", 4).unwrap();
        assert!(p.set("old-task", 0).is_err());
        assert!(p.set("old-task", 6).is_err());
        p.save(&path).unwrap();
        assert_eq!(Priorities::load(&path).unwrap().0["old-task"], 4);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
