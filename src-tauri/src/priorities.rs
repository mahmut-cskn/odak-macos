//! Optional priorities are independent of existing task payloads and SQLite schema.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::Path};
#[derive(Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Priorities(pub BTreeMap<String, u8>);
impl Priorities {
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
        std::fs::rename(temp, path).map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
