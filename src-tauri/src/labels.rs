//! An independent label picker catalog. Existing task payloads are never migrated.
use crate::model::Task;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Label {
    pub name: String,
    pub color: String,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Catalog {
    pub labels: Vec<Label>,
    pub hidden: Vec<String>,
}
impl Catalog {
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn available(&self, tasks: &[Task]) -> Vec<Label> {
        let mut labels = BTreeMap::new();
        for t in tasks.iter().filter(|t| !t.label.is_empty()) {
            labels.entry(t.label.clone()).or_insert(t.color.clone());
        }
        for label in &self.labels {
            labels.insert(label.name.clone(), label.color.clone());
        }
        labels
            .into_iter()
            .filter(|(name, _)| !self.hidden.contains(name))
            .map(|(name, color)| Label { name, color })
            .collect()
    }
    pub fn add(&mut self, name: &str, color: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.len() > 250 || name.contains('\0') {
            return Err("Etiket adı boş veya çok uzun olamaz.".into());
        }
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Etiket rengi geçersiz.".into());
        }
        self.hidden.retain(|n| n != name);
        self.labels.retain(|l| l.name != name);
        self.labels.push(Label {
            name: name.into(),
            color: color.into(),
        });
        Ok(())
    }
    pub fn remove(&mut self, name: &str) {
        self.labels.retain(|l| l.name != name);
        if !self.hidden.iter().any(|n| n == name) {
            self.hidden.push(name.into());
        }
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
    fn deleting_a_label_preserves_every_task_and_can_be_recreated() {
        let mut catalog = Catalog::default();
        catalog.add("İş", "#438470").unwrap();
        catalog.remove("İş");
        assert!(catalog.available(&[]).is_empty());
        catalog.add("İş", "#8e78a5").unwrap();
        assert_eq!(catalog.available(&[])[0].color, "#8e78a5");
    }
    #[test]
    fn catalog_preferences_survive_restart() {
        let dir = std::env::temp_dir().join(format!("odak-label-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("labels.json");
        let mut catalog = Catalog::default();
        catalog.add("Araştırma", "#438470").unwrap();
        catalog.add("İş", "#8e78a5").unwrap();
        catalog.remove("İş");
        catalog.save(&path).unwrap();
        let loaded = Catalog::load(&path).unwrap();
        assert_eq!(
            loaded.available(&[]),
            vec![Label {
                name: "Araştırma".into(),
                color: "#438470".into()
            }]
        );
        assert_eq!(loaded.hidden, vec!["İş"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_invalid_catalog_entries() {
        let mut catalog = Catalog::default();
        assert!(catalog.add(" ", "#438470").is_err());
        assert!(catalog.add("Work", "red").is_err());
    }
}
