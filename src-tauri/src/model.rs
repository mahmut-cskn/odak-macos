use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub done: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recurrence {
    pub frequency: String,
    pub weekdays: Vec<u32>,
    pub month_day: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub label: String,
    pub color: String,
    pub notes: String,
    pub status: String,
    pub completed_at: Option<i64>,
    pub estimate_min: Option<u32>,
    pub scheduled_date: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub due_at: Option<i64>,
    pub recurrence_rule: Option<Recurrence>,
    pub series_id: Option<String>,
    pub subtasks: Vec<Subtask>,
    pub created_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub id: String,
    pub task_id: Option<String>,
    pub r#type: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub planned_min: u32,
    pub actual_min: f64,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimerState {
    pub task_id: Option<String>,
    pub phase: String,
    pub paused_phase: Option<String>,
    pub started_at: Option<i64>,
    pub paused_at: Option<i64>,
    pub paused_accumulated_ms: i64,
    pub work_min: u32,
    pub break_min: u32,
    pub planned_min: u32,
    pub break_ready: bool,
}
impl Default for TimerState {
    fn default() -> Self {
        Self {
            task_id: None,
            phase: "idle".into(),
            paused_phase: None,
            started_at: None,
            paused_at: None,
            paused_accumulated_ms: 0,
            work_min: 45,
            break_min: 15,
            planned_min: 45,
            break_ready: false,
        }
    }
}
impl TimerState {
    pub fn remaining_ms(&self, now: i64) -> i64 {
        if self.phase == "idle" {
            return 0;
        }
        (self.planned_min as i64 * 60_000
            - (self.paused_at.unwrap_or(now)
                - self.started_at.unwrap_or(now)
                - self.paused_accumulated_ms)
                .max(0))
        .max(0)
    }
    pub fn begin(&mut self, task: Option<String>, phase: &str, minutes: u32, now: i64) {
        self.task_id = task;
        self.phase = phase.into();
        self.started_at = Some(now);
        self.paused_at = None;
        self.paused_phase = None;
        self.paused_accumulated_ms = 0;
        self.planned_min = minutes;
        self.break_ready = false;
    }
    pub fn pause(&mut self, now: i64) -> Result<(), String> {
        if self.phase != "work" && self.phase != "break" {
            return Err("Çalışan bir sayaç yok.".into());
        }
        self.paused_phase = Some(self.phase.clone());
        self.phase = "paused".into();
        self.paused_at = Some(now);
        Ok(())
    }
    pub fn resume(&mut self, now: i64) -> Result<(), String> {
        if self.phase != "paused" {
            return Err("Sayaç duraklatılmamış.".into());
        }
        self.paused_accumulated_ms += (now - self.paused_at.unwrap_or(now)).max(0);
        self.phase = self.paused_phase.take().unwrap_or("work".into());
        self.paused_at = None;
        Ok(())
    }
    pub fn cancel(&mut self) {
        let (work, rest) = (self.work_min, self.break_min);
        *self = Self::default();
        self.work_min = work;
        self.break_min = rest;
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub default_work_min: u32,
    pub default_break_min: u32,
    pub sound_enabled: bool,
    pub sound_volume: f32,
    pub quiet_mode: bool,
    pub notify_lead_min: u32,
    pub quick_add_shortcut: String,
    pub launch_at_login: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            default_work_min: 45,
            default_break_min: 15,
            sound_enabled: true,
            sound_volume: 0.5,
            quiet_mode: false,
            notify_lead_min: 15,
            quick_add_shortcut: "CmdOrCtrl+Shift+K".into(),
            launch_at_login: true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Data {
    pub tasks: Vec<Task>,
    pub sessions: Vec<Session>,
    pub timer: TimerState,
    pub settings: Settings,
    pub notified: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub data: Data,
    pub remaining_ms: i64,
    pub database_path: String,
    pub service_error: Option<String>,
}

pub fn validate_settings(s: &Settings) -> Result<(), String> {
    if !(1..=90).contains(&s.default_work_min) || !(1..=30).contains(&s.default_break_min) {
        return Err("Çalışma 1–90, mola 1–30 dakika olmalı.".into());
    }
    if !s.sound_volume.is_finite()
        || !(0.0..=1.0).contains(&s.sound_volume)
        || s.notify_lead_min > 1440
        || s.quick_add_shortcut.is_empty()
    {
        return Err("Ayarlar geçersiz.".into());
    }
    Ok(())
}
pub fn validate_task(t: &Task) -> Result<(), String> {
    if t.id.is_empty()
        || t.title.trim().is_empty()
        || t.title.len() > 1000
        || !["active", "completed"].contains(&t.status.as_str())
    {
        return Err("Görev başlığı veya durumu geçersiz.".into());
    }
    if (t.status == "completed") != t.completed_at.is_some() {
        return Err("Tamamlama durumu geçersiz.".into());
    }
    if let Some(d) = &t.scheduled_date {
        NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| "Görev tarihi geçersiz.")?;
    }
    if t.start_at.is_some() != t.end_at.is_some()
        || t.start_at.zip(t.end_at).is_some_and(|(a, b)| b <= a)
    {
        return Err("Bitiş saati başlangıçtan sonra olmalı.".into());
    }
    if let Some(r) = &t.recurrence_rule {
        if !["daily", "weekly", "monthly"].contains(&r.frequency.as_str())
            || r.weekdays.iter().any(|d| *d > 6)
            || r.month_day < 1
            || r.month_day > 31
            || (r.frequency == "weekly" && r.weekdays.is_empty())
            || t.scheduled_date.is_none()
        {
            return Err("Tekrar kuralı geçersiz.".into());
        }
    }
    Ok(())
}
pub fn occurs(t: &Task, date: NaiveDate) -> bool {
    let Some(r) = &t.recurrence_rule else {
        return false;
    };
    let Some(start) = t
        .scheduled_date
        .as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
    else {
        return false;
    };
    date >= start
        && match r.frequency.as_str() {
            "daily" => true,
            "weekly" => r.weekdays.contains(&date.weekday().num_days_from_sunday()),
            "monthly" => date.day() == r.month_day,
            _ => false,
        }
}
fn shift_time(value: Option<i64>, date: NaiveDate) -> Option<i64> {
    let original = Local.timestamp_millis_opt(value?).single()?;
    let time = date.and_time(original.time());
    // Resolve an ambiguous local time to its earliest occurrence; skip nonexistent DST times.
    Local
        .from_local_datetime(&time)
        .earliest()
        .map(|d| d.timestamp_millis())
}
pub fn materialize(data: &mut Data, date: NaiveDate) -> bool {
    let templates: Vec<Task> = data
        .tasks
        .iter()
        .filter(|t| t.recurrence_rule.is_some() && t.series_id.is_none())
        .cloned()
        .collect();
    let mut changed = false;
    for template in templates {
        if !occurs(&template, date) {
            continue;
        }
        let id = format!("{}@{}", template.id, date);
        if data.tasks.iter().any(|t| t.id == id) {
            continue;
        }
        let mut instance = template.clone();
        instance.id = id;
        instance.series_id = Some(template.id);
        instance.recurrence_rule = None;
        instance.status = "active".into();
        instance.completed_at = None;
        instance.scheduled_date = Some(date.to_string());
        instance.start_at = shift_time(template.start_at, date);
        instance.end_at = template
            .end_at
            .zip(template.start_at)
            .and_then(|(end, start)| instance.start_at.map(|v| v + end - start));
        instance.due_at = shift_time(template.due_at, date);
        instance.subtasks.iter_mut().for_each(|s| s.done = false);
        data.tasks.push(instance);
        changed = true;
    }
    changed
}
pub fn finish_due(data: &mut Data, now: i64) -> Vec<String> {
    let mut finished = vec![];
    for _ in 0..2 {
        let timer = &data.timer;
        if !["work", "break"].contains(&timer.phase.as_str()) || timer.remaining_ms(now) > 0 {
            break;
        }
        let phase = timer.phase.clone();
        let ended = timer.started_at.unwrap_or(now)
            + timer.paused_accumulated_ms
            + timer.planned_min as i64 * 60_000;
        let label = timer
            .task_id
            .as_ref()
            .and_then(|id| data.tasks.iter().find(|t| &t.id == id))
            .map(|t| t.label.clone())
            .unwrap_or_else(|| "Serbest".into());
        data.sessions.push(Session {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: timer.task_id.clone(),
            r#type: phase.clone(),
            started_at: timer.started_at.unwrap_or(now),
            ended_at: ended,
            planned_min: timer.planned_min,
            actual_min: timer.planned_min as f64,
            label,
        });
        if phase == "work" {
            data.timer.begin(
                data.timer.task_id.clone(),
                "break",
                data.timer.break_min,
                ended,
            );
        } else {
            data.timer.phase = "idle".into();
            data.timer.started_at = None;
            data.timer.break_ready = true;
        }
        finished.push(phase);
    }
    finished
}
pub fn reminder_horizon(data: &mut Data, now: DateTime<Local>) -> bool {
    let mut changed = false;
    for offset in 0..=2 {
        changed |= materialize(data, now.date_naive() + Duration::days(offset));
    }
    changed
}
#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> Task {
        serde_json::from_value(serde_json::json!({"id":"task","title":"Task","label":"İş","color":"#438470","notes":"","status":"active","completedAt":null,"estimateMin":null,"scheduledDate":"2026-10-01","startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":null,"seriesId":null,"subtasks":[],"createdAt":0})).unwrap()
    }
    #[test]
    fn pause_restart_and_cancel_credit_nothing() {
        let mut d = Data::default();
        d.timer.begin(Some("task".into()), "work", 45, 1000);
        d.timer.pause(61000).unwrap();
        let encoded = serde_json::to_string(&d).unwrap();
        let mut d: Data = serde_json::from_str(&encoded).unwrap();
        assert_eq!(d.timer.remaining_ms(9_000_000), 44 * 60000);
        d.timer.resume(9_000_000).unwrap();
        assert_eq!(d.timer.remaining_ms(9_060_000), 43 * 60000);
        d.timer.cancel();
        assert!(d.sessions.is_empty());
        assert_eq!(d.timer.phase, "idle");
    }
    #[test]
    fn finish_records_work_without_completing_task() {
        let mut d = Data::default();
        d.tasks.push(task());
        d.timer.begin(Some("task".into()), "work", 1, 0);
        assert_eq!(finish_due(&mut d, 60000), vec!["work"]);
        assert_eq!(d.sessions.len(), 1);
        assert_eq!(d.tasks[0].status, "active");
        assert_eq!(d.timer.phase, "break");
        assert!(finish_due(&mut d, 60001).is_empty());
    }
    #[test]
    fn closed_app_catches_up_both_phases_once() {
        let mut d = Data::default();
        d.timer.break_min = 1;
        d.timer.begin(None, "work", 1, 0);
        assert_eq!(finish_due(&mut d, 180000), vec!["work", "break"]);
        assert_eq!(d.sessions.len(), 2);
        assert!(d.timer.break_ready);
        assert!(finish_due(&mut d, 180001).is_empty());
    }
    #[test]
    fn recurrence_instances_are_independent_and_idempotent() {
        let mut d = Data::default();
        let mut t = task();
        t.recurrence_rule = Some(Recurrence {
            frequency: "daily".into(),
            weekdays: vec![],
            month_day: 1,
        });
        d.tasks.push(t);
        let day = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        assert!(materialize(&mut d, day));
        assert!(!materialize(&mut d, day));
        d.tasks[1].status = "completed".into();
        assert!(materialize(&mut d, day + Duration::days(1)));
        assert_eq!(d.tasks[0].status, "active");
        assert_eq!(d.tasks[2].status, "active");
    }
    #[test]
    fn month_does_not_overflow() {
        let mut t = task();
        t.recurrence_rule = Some(Recurrence {
            frequency: "monthly".into(),
            weekdays: vec![],
            month_day: 31,
        });
        assert!(!occurs(&t, NaiveDate::from_ymd_opt(2026, 11, 30).unwrap()));
        assert!(occurs(&t, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap()));
    }
    #[test]
    fn limits_are_enforced() {
        let mut s = Settings::default();
        s.default_work_min = 91;
        assert!(validate_settings(&s).is_err());
        s.default_work_min = 90;
        s.default_break_min = 30;
        assert!(validate_settings(&s).is_ok());
    }
}
