//! Task-specific work lengths without changing existing task or timer records.
use crate::model::Task;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io::Write, path::Path};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Durations(pub BTreeMap<String, u32>);

pub fn validate_input(value: Option<&Value>, required: bool) -> Result<Option<u32>, String> {
    match value {
        None if !required => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|minutes| (1..=90).contains(minutes))
            .map(|minutes| Some(minutes as u32))
            .ok_or_else(|| "Pomodoro süresi zorunlu; 1–90 arasında tam dakika girin.".into()),
        None => Err("Pomodoro süresi zorunlu; 1–90 arasında tam dakika girin.".into()),
    }
}

impl Durations {
    pub fn validate(&self) -> Result<(), String> {
        if self.0.values().any(|minutes| !(1..=90).contains(minutes)) {
            return Err("Pomodoro süresi 1–90 dakika arasında olmalı.".into());
        }
        Ok(())
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let store: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                store.validate()?;
                Ok(store)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn for_task(&self, task: &Task, fallback: u32) -> u32 {
        self.0
            .get(&task.id)
            .or_else(|| task.series_id.as_ref().and_then(|id| self.0.get(id)))
            .copied()
            .unwrap_or(fallback)
    }
    pub fn for_export(&self, tasks: &[Task]) -> Self {
        Self(
            self.0
                .iter()
                .filter(|(id, _)| {
                    tasks
                        .iter()
                        .any(|t| &t.id == *id || t.series_id.as_ref() == Some(*id))
                })
                .map(|(id, minutes)| (id.clone(), *minutes))
                .collect(),
        )
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
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
    use serde_json::json;
    #[test]
    fn series_duration_is_inherited_until_instance_override_without_task_changes() {
        let task: Task = serde_json::from_value(json!({"id":"instance","title":"Task","label":"","color":"#438470","notes":"","status":"active","completedAt":null,"estimateMin":480,"scheduledDate":null,"startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":null,"seriesId":"series","subtasks":[],"createdAt":0})).unwrap();
        let before = serde_json::to_value(&task).unwrap();
        let mut durations = Durations::default();
        assert_eq!(durations.for_task(&task, 45), 45);
        durations.0.insert("series".into(), 30);
        assert_eq!(durations.for_task(&task, 45), 30);
        durations.0.insert("instance".into(), 20);
        assert_eq!(durations.for_task(&task, 45), 20);
        assert_eq!(serde_json::to_value(&task).unwrap(), before);
        assert_eq!(durations.for_export(&[task]).0.len(), 2);
    }
    #[test]
    fn requires_new_task_duration_and_accepts_legacy_edits_without_it() {
        assert!(validate_input(None, true).is_err());
        assert_eq!(validate_input(None, false).unwrap(), None);
        for value in [json!(null), json!(0), json!(91), json!(1.5), json!("30")] {
            assert!(validate_input(Some(&value), true).is_err());
        }
        for minutes in [1, 30, 90] {
            assert_eq!(
                validate_input(Some(&json!(minutes)), true).unwrap(),
                Some(minutes)
            );
        }
    }
    #[test]
    fn missing_preferences_stay_empty_and_saved_lengths_survive_restart() {
        let dir = std::env::temp_dir().join(format!("odak-duration-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("task-durations.json");
        let mut durations = Durations::load(&path).unwrap();
        assert!(!path.exists());
        assert!(durations.0.is_empty());
        durations.0.insert("new-task".into(), 30);
        durations.save(&path).unwrap();
        assert_eq!(Durations::load(&path).unwrap().0["new-task"], 30);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
