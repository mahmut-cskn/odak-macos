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
    pub labels: Vec<crate::labels::Label>,
    pub priorities: std::collections::BTreeMap<String, u8>,
    pub task_durations: std::collections::BTreeMap<String, u32>,
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
    if t.color.len() != 7
        || !t.color.starts_with('#')
        || !t.color.bytes().skip(1).all(|c| c.is_ascii_hexdigit())
        || t.title.contains('\0')
        || t.label.len() > 250
        || t.notes.len() > 100_000
        || t.estimate_min.is_some_and(|v| v == 0 || v > 100_000)
    {
        return Err("Görev rengi, metni veya tahmini süresi geçersiz.".into());
    }
    for timestamp in [
        Some(t.created_at),
        t.completed_at,
        t.start_at,
        t.end_at,
        t.due_at,
    ]
    .into_iter()
    .flatten()
    {
        if !(0..=253_402_214_400_000).contains(&timestamp) {
            return Err("Görev zamanı geçersiz.".into());
        }
    }
    let mut subtasks = std::collections::HashSet::new();
    for subtask in &t.subtasks {
        if subtask.id.is_empty()
            || !subtasks.insert(&subtask.id)
            || subtask.title.trim().is_empty()
            || subtask.title.len() > 1000
        {
            return Err("Alt görev kaydı geçersiz.".into());
        }
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
    if let Some(start) = t.start_at {
        if t.scheduled_date.as_deref()
            != Local
                .timestamp_millis_opt(start)
                .single()
                .map(|d| d.date_naive().to_string())
                .as_deref()
        {
            return Err("Saat aralığı seçili günle eşleşmiyor.".into());
        }
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
pub fn validate_label_change(task: &Task, previous: Option<&Task>) -> Result<(), String> {
    if task.label.trim().is_empty()
        && previous.is_none_or(|old| old.label != task.label || !old.label.trim().is_empty())
    {
        return Err("Etiket zorunlu; bir etiket seçin veya yazın.".into());
    }
    Ok(())
}
// Rebuild only unstarted future instances when a series changes.
pub fn prune_future_instances(data: &mut Data, series: &str, today: NaiveDate) -> Vec<NaiveDate> {
    let mut removed = vec![];
    let started: std::collections::HashSet<String> = data
        .sessions
        .iter()
        .filter_map(|s| s.task_id.clone())
        .collect();
    data.tasks.retain(|task| {
        let date = task
            .scheduled_date
            .as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
        let remove = task.series_id.as_deref() == Some(series)
            && task.status == "active"
            && date.is_some_and(|d| d >= today)
            && !started.contains(&task.id)
            && data.timer.task_id.as_deref() != Some(task.id.as_str());
        if remove {
            removed.push(date.unwrap());
        }
        !remove
    });
    removed
}
pub fn upsert_task(data: &mut Data, task: Task, today: NaiveDate) {
    let previous = data.tasks.iter().find(|t| t.id == task.id);
    let dates = if previous.is_some_and(|t| t.recurrence_rule.is_some()) {
        prune_future_instances(data, &task.id, today)
    } else {
        vec![]
    };
    // A user edit affects only the selected task; the catalog supplies defaults.
    // Never recolor historical or unrelated tasks as a side effect.
    if let Some(existing) = data.tasks.iter_mut().find(|t| t.id == task.id) {
        *existing = task;
    } else {
        data.tasks.push(task);
    }
    for date in dates {
        materialize(data, date);
    }
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
        data.tasks.push(recurrence_instance(&template, date));
        changed = true;
    }
    changed
}
fn recurrence_instance(template: &Task, date: NaiveDate) -> Task {
    let mut instance = template.clone();
    instance.id = format!("{}@{}", template.id, date);
    instance.series_id = Some(template.id.clone());
    instance.recurrence_rule = None;
    instance.status = "active".into();
    instance.completed_at = None;
    instance.scheduled_date = Some(date.to_string());
    instance.start_at = shift_time(template.start_at, date);
    instance.end_at = template
        .end_at
        .zip(template.start_at)
        .and_then(|(end, start)| instance.start_at.map(|value| value + end - start));
    instance.due_at = shift_time(template.due_at, date);
    instance
        .subtasks
        .iter_mut()
        .for_each(|subtask| subtask.done = false);
    instance
}
/// Materialize only the explicitly selected lazy occurrence when its focus session starts.
pub fn prepare_focus_start(data: &mut Data, id: &str, today: NaiveDate) -> Result<(), String> {
    if data.tasks.iter().any(|task| task.id == id) {
        return validate_focus_start(data, id, today);
    }
    let (series, day) = id.rsplit_once('@').ok_or("Görev bulunamadı.")?;
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| "Geçersiz tarih.")?;
    let template = data
        .tasks
        .iter()
        .find(|task| {
            task.id == series
                && task.status == "active"
                && task.recurrence_rule.is_some()
                && task.series_id.is_none()
        })
        .ok_or("Tekrarlayan görev bulunamadı.")?;
    if date < today || !occurs(template, date) {
        return Err("Bu tekrar gününde odak başlatılamaz.".into());
    }
    let instance = recurrence_instance(template, date);
    data.tasks.push(instance);
    Ok(())
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
/// Explicit completion credits elapsed work once, excluding pauses, then stops the timer.
pub fn finish_task_session(
    data: &mut Data,
    task_id: &str,
    expected_started_at: Option<i64>,
    now: i64,
) -> Result<(), String> {
    let timer = &data.timer;
    if timer.task_id.as_deref() != Some(task_id) || (timer.phase == "idle" && !timer.break_ready) {
        return Err("Bitirilecek oturum değişti. Güncel oturumu kontrol edin.".into());
    }
    let break_phase = timer.phase == "break" || timer.paused_phase.as_deref() == Some("break");
    let last = data.sessions.last();
    let follows_work = break_phase
        && last.is_some_and(|session| {
            session.r#type == "work"
                && session.task_id.as_deref() == Some(task_id)
                && Some(session.started_at) == expected_started_at
                && Some(session.ended_at) == timer.started_at
        });
    let follows_break = timer.phase == "idle"
        && timer.break_ready
        && last.is_some_and(|session| {
            session.r#type == "break"
                && session.task_id.as_deref() == Some(task_id)
                && (Some(session.started_at) == expected_started_at
                    || data.sessions.iter().rev().nth(1).is_some_and(|work| {
                        work.r#type == "work"
                            && work.task_id.as_deref() == Some(task_id)
                            && Some(work.started_at) == expected_started_at
                            && work.ended_at == session.started_at
                    }))
        });
    if timer.started_at != expected_started_at && !follows_work && !follows_break {
        return Err("Bitirilecek oturum değişti. Güncel oturumu kontrol edin.".into());
    }
    let task_index = data
        .tasks
        .iter()
        .position(|t| t.id == task_id && t.recurrence_rule.is_none())
        .ok_or("Görev bulunamadı.")?;
    // A deadline may have passed while confirmation was open. Normal completion already
    // credits full work; the following break must never credit it a second time.
    finish_due(data, now);
    if data.timer.phase == "work" || data.timer.paused_phase.as_deref() == Some("work") {
        let elapsed_ms = data.timer.planned_min as i64 * 60_000 - data.timer.remaining_ms(now);
        data.sessions.push(Session {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: Some(task_id.into()),
            r#type: "work".into(),
            started_at: data.timer.started_at.unwrap_or(now),
            ended_at: now,
            planned_min: data.timer.planned_min,
            actual_min: elapsed_ms as f64 / 60_000.0,
            label: data.tasks[task_index].label.clone(),
        });
    }
    let task = &mut data.tasks[task_index];
    task.status = "completed".into();
    task.completed_at = Some(task.completed_at.unwrap_or(now));
    data.timer.cancel();
    Ok(())
}
pub fn reminder_horizon(data: &mut Data, now: DateTime<Local>) -> bool {
    let mut changed = false;
    for offset in 0..=2 {
        changed |= materialize(data, now.date_naive() + Duration::days(offset));
    }
    changed
}
/// Title-only editing never changes the running timer, placement, label or series.
pub fn rename_task(data: &mut Data, id: &str, title: &str) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 250 || title.contains('\0') {
        return Err("Görev başlığı 1–250 karakter olmalı.".into());
    }
    let task = data
        .tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or("Görev bulunamadı.")?;
    task.title = title.into();
    Ok(())
}
pub fn validate_focus_task(data: &Data, id: &str) -> Result<(), String> {
    if !data.tasks.iter().any(|t| {
        t.id == id
            && t.status == "active"
            && t.recurrence_rule.is_none()
            && !t.title.trim().is_empty()
    }) {
        return Err("Adı olan aktif bir görev seçin.".into());
    }
    Ok(())
}

pub fn validate_planning_change(
    task: &Task,
    previous: Option<&Task>,
    now: DateTime<Local>,
) -> Result<(), String> {
    let today = now.date_naive().to_string();
    if task
        .scheduled_date
        .as_ref()
        .is_some_and(|date| date < &today)
        && previous.is_none_or(|old| old.scheduled_date != task.scheduled_date)
    {
        return Err("Geçmiş bir güne görev planlanamaz. Bugünü veya ileri bir günü seçin.".into());
    }
    let minute = now.timestamp_millis() / 60_000 * 60_000;
    for (value, old) in [
        (task.start_at, previous.and_then(|p| p.start_at)),
        (task.end_at, previous.and_then(|p| p.end_at)),
        (task.due_at, previous.and_then(|p| p.due_at)),
    ] {
        if value.is_some_and(|time| time < minute) && (previous.is_none() || value != old) {
            return Err("Geçmiş bir saate yeni görev planlanamaz.".into());
        }
    }
    Ok(())
}
pub fn validate_focus_start(data: &Data, id: &str, today: NaiveDate) -> Result<(), String> {
    validate_focus_task(data, id)?;
    let task = data.tasks.iter().find(|t| t.id == id).unwrap();
    let date = task.scheduled_date.clone().or_else(|| {
        task.due_at.and_then(|ms| {
            Local
                .timestamp_millis_opt(ms)
                .single()
                .map(|d| d.date_naive().to_string())
        })
    });
    if date.is_some_and(|date| date < today.to_string()) {
        return Err("Geçmiş günün görevinde pomodoro başlatılamaz. Görevi bugüne veya ileri bir güne taşıyın.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> Task {
        serde_json::from_value(serde_json::json!({"id":"task","title":"Task","label":"İş","color":"#438470","notes":"","status":"active","completedAt":null,"estimateMin":null,"scheduledDate":"2026-10-01","startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":null,"seriesId":null,"subtasks":[],"createdAt":0})).unwrap()
    }
    #[test]
    fn lazy_focus_start_creates_only_selected_occurrence_and_preserves_live_data() {
        let mut data = Data::default();
        let mut template = task();
        template.id = "monthly".into();
        template.scheduled_date = Some("2026-10-07".into());
        template.recurrence_rule = Some(Recurrence {
            frequency: "monthly".into(),
            weekdays: vec![],
            month_day: 7,
        });
        data.tasks.push(template);
        data.tasks.push(task());
        data.timer.begin(Some("task".into()), "work", 45, 1000);
        let before = serde_json::to_value(&data).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 9).unwrap();
        prepare_focus_start(&mut data, "monthly@2026-11-07", today).unwrap();
        assert_eq!(data.tasks.len(), 3);
        assert_eq!(data.tasks[2].series_id.as_deref(), Some("monthly"));
        assert_eq!(data.tasks[2].scheduled_date.as_deref(), Some("2026-11-07"));
        validate_task(&data.tasks[2]).unwrap();
        assert_eq!(serde_json::to_value(&data.timer).unwrap(), before["timer"]);
        assert_eq!(
            serde_json::to_value(&data.tasks[..2]).unwrap(),
            before["tasks"]
        );
        assert_eq!(
            serde_json::to_value(&data.sessions).unwrap(),
            before["sessions"]
        );
        prepare_focus_start(&mut data, "monthly@2026-11-07", today).unwrap();
        assert_eq!(data.tasks.len(), 3);
    }
    #[test]
    fn lazy_focus_start_rejects_past_invalid_and_missing_series_without_writes() {
        let mut data = Data::default();
        let mut template = task();
        template.recurrence_rule = Some(Recurrence {
            frequency: "monthly".into(),
            weekdays: vec![],
            month_day: 1,
        });
        data.tasks.push(template);
        let before = serde_json::to_value(&data).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 9).unwrap();
        for id in [
            "task@2026-10-01",
            "task@2026-11-02",
            "task@bad-date",
            "missing@2026-11-01",
        ] {
            assert!(prepare_focus_start(&mut data, id, today).is_err());
            assert_eq!(serde_json::to_value(&data).unwrap(), before);
        }
    }
    #[test]
    fn lazy_focus_start_never_recreates_a_completed_occurrence() {
        let mut data = Data::default();
        let mut completed = task();
        completed.id = "series@2026-11-01".into();
        completed.series_id = Some("series".into());
        completed.scheduled_date = Some("2026-11-01".into());
        completed.status = "completed".into();
        completed.completed_at = Some(1000);
        data.tasks.push(completed);
        let before = serde_json::to_value(&data).unwrap();
        assert!(prepare_focus_start(
            &mut data,
            "series@2026-11-01",
            NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
        )
        .is_err());
        assert_eq!(serde_json::to_value(&data).unwrap(), before);
    }
    #[test]
    fn early_finish_records_elapsed_work_completes_task_and_is_not_repeatable() {
        let mut data = Data::default();
        data.tasks.push(task());
        data.timer.begin(Some("task".into()), "work", 45, 1000);
        finish_task_session(&mut data, "task", Some(1000), 15 * 60000 + 1000).unwrap();
        assert_eq!(data.tasks[0].status, "completed");
        assert_eq!(data.tasks[0].completed_at, Some(901000));
        assert_eq!(data.sessions.len(), 1);
        assert_eq!(data.sessions[0].actual_min, 15.0);
        assert_eq!(data.sessions[0].planned_min, 45);
        assert_eq!(data.sessions[0].label, "İş");
        assert_eq!(data.timer.phase, "idle");
        assert!(!data.timer.break_ready);
        let saved = serde_json::to_value(&data).unwrap();
        assert!(finish_task_session(&mut data, "task", Some(1000), 1000000).is_err());
        assert_eq!(serde_json::to_value(&data).unwrap(), saved);
    }
    #[test]
    fn early_finish_excludes_current_and_previous_pauses() {
        let mut data = Data::default();
        data.tasks.push(task());
        data.timer.begin(Some("task".into()), "work", 45, 0);
        data.timer.pause(5 * 60000).unwrap();
        data.timer.resume(15 * 60000).unwrap();
        data.timer.pause(20 * 60000).unwrap();
        finish_task_session(&mut data, "task", Some(0), 40 * 60000).unwrap();
        assert_eq!(data.sessions[0].actual_min, 10.0);
        assert_eq!(data.sessions[0].ended_at, 40 * 60000);
    }
    #[test]
    fn break_cancel_keeps_task_active_but_explicit_finish_completes_without_extra_work() {
        let mut data = Data::default();
        data.tasks.push(task());
        data.timer.begin(Some("task".into()), "work", 1, 0);
        finish_due(&mut data, 60000);
        let mut cancelled = data.clone();
        cancelled.timer.cancel();
        assert_eq!(cancelled.tasks[0].status, "active");
        assert_eq!(cancelled.sessions.len(), 1);
        finish_task_session(&mut data, "task", Some(60000), 90000).unwrap();
        assert_eq!(data.tasks[0].status, "completed");
        assert_eq!(data.sessions.len(), 1);
        assert_eq!(data.sessions[0].actual_min, 1.0);
        assert_eq!(data.timer.phase, "idle");
    }
    #[test]
    fn finish_confirmation_crossing_deadlines_never_double_credits_work() {
        for tick_before in [false, true] {
            let mut data = Data::default();
            data.tasks.push(task());
            data.timer.break_min = 1;
            data.timer.begin(Some("task".into()), "work", 1, 0);
            if tick_before {
                finish_due(&mut data, 120000);
            }
            finish_task_session(&mut data, "task", Some(0), 120000).unwrap();
            assert_eq!(data.tasks[0].status, "completed");
            assert_eq!(
                data.sessions.iter().filter(|s| s.r#type == "work").count(),
                1
            );
            assert_eq!(
                data.sessions
                    .iter()
                    .filter(|s| s.r#type == "work")
                    .map(|s| s.actual_min)
                    .sum::<f64>(),
                1.0
            );
        }
    }
    #[test]
    fn stale_finish_rejects_a_replacement_session_without_changing_data() {
        let mut data = Data::default();
        data.tasks.push(task());
        data.timer.begin(Some("task".into()), "work", 45, 1000);
        let saved = serde_json::to_value(&data).unwrap();
        assert!(finish_task_session(&mut data, "task", Some(0), 2000).is_err());
        assert_eq!(serde_json::to_value(&data).unwrap(), saved);
    }
    #[test]
    fn new_labels_are_required_while_unchanged_legacy_blank_labels_remain_valid() {
        let mut old = task();
        old.label.clear();
        assert!(validate_task(&old).is_ok());
        assert!(validate_label_change(&old, None).is_err());
        assert!(validate_label_change(&old, Some(&old)).is_ok());
        let mut cleared = task();
        cleared.label = "  ".into();
        assert!(validate_label_change(&cleared, Some(&task())).is_err());
        assert!(validate_label_change(&task(), None).is_ok());
    }
    #[test]
    fn past_planning_is_blocked_without_rewriting_existing_history() {
        let now = Local
            .with_ymd_and_hms(2026, 10, 8, 14, 30, 30)
            .single()
            .unwrap();
        let old = task();
        assert!(validate_planning_change(&old, None, now).is_err());
        assert!(validate_planning_change(&old, Some(&old), now).is_ok());
        let mut changed = old.clone();
        changed.scheduled_date = Some("2026-10-07".into());
        assert!(validate_planning_change(&changed, Some(&old), now).is_err());
        changed.scheduled_date = Some("2026-10-08".into());
        assert!(validate_planning_change(&changed, Some(&old), now).is_ok());
        changed.start_at = Some(now.timestamp_millis() - 120000);
        assert!(validate_planning_change(&changed, Some(&old), now).is_err());
        changed.start_at = Some(now.timestamp_millis() + 120000);
        assert!(validate_planning_change(&changed, Some(&old), now).is_ok());
    }
    #[test]
    fn focus_allows_today_future_and_undated_but_rejects_past_day() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        let mut data = Data::default();
        data.tasks.push(task());
        assert!(validate_focus_start(&data, "task", today).is_err());
        for day in [Some("2026-10-08".into()), Some("2026-10-09".into()), None] {
            data.tasks[0].scheduled_date = day;
            assert!(validate_focus_start(&data, "task", today).is_ok());
        }
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
        let mut s = Settings {
            default_work_min: 91,
            ..Settings::default()
        };
        assert!(validate_settings(&s).is_err());
        s.default_work_min = 90;
        s.default_break_min = 30;
        assert!(validate_settings(&s).is_ok());
    }
    #[test]
    fn series_edit_rebuilds_future_but_keeps_completed_history() {
        let mut d = Data::default();
        let mut t = task();
        t.recurrence_rule = Some(Recurrence {
            frequency: "daily".into(),
            weekdays: vec![],
            month_day: 1,
        });
        d.tasks.push(t.clone());
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        materialize(&mut d, today);
        materialize(&mut d, today + Duration::days(1));
        d.tasks[1].status = "completed".into();
        d.tasks[1].completed_at = Some(1);
        t.title = "Updated series".into();
        upsert_task(&mut d, t, today);
        assert_eq!(
            d.tasks
                .iter()
                .find(|t| t.scheduled_date.as_deref() == Some("2026-10-08"))
                .unwrap()
                .title,
            "Task"
        );
        assert_eq!(
            d.tasks
                .iter()
                .find(|t| t.scheduled_date.as_deref() == Some("2026-10-09"))
                .unwrap()
                .title,
            "Updated series"
        );
    }
    #[test]
    fn deleting_series_prunes_only_unstarted_future_instances() {
        let mut d = Data::default();
        let mut t = task();
        t.recurrence_rule = Some(Recurrence {
            frequency: "daily".into(),
            weekdays: vec![],
            month_day: 1,
        });
        d.tasks.push(t);
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        materialize(&mut d, today - Duration::days(1));
        materialize(&mut d, today);
        materialize(&mut d, today + Duration::days(1));
        d.timer.task_id = Some("task@2026-10-08".into());
        let removed = prune_future_instances(&mut d, "task", today);
        assert_eq!(removed, vec![today + Duration::days(1)]);
        assert!(d.tasks.iter().any(|t| t.id == "task@2026-10-07"));
        assert!(d.tasks.iter().any(|t| t.id == "task@2026-10-08"));
    }
    #[test]
    fn label_color_edit_preserves_unrelated_tasks() {
        let mut d = Data::default();
        let a = task();
        let mut b = task();
        b.id = "second".into();
        d.tasks = vec![a.clone(), b.clone()];
        let untouched = serde_json::to_value(&b).unwrap();
        let mut changed = a;
        changed.color = "#d28567".into();
        upsert_task(&mut d, changed, Local::now().date_naive());
        assert_eq!(serde_json::to_value(&d.tasks[1]).unwrap(), untouched);
    }
    #[test]
    fn title_edit_preserves_live_timer_and_all_other_task_fields() {
        let mut d = Data::default();
        d.tasks.push(task());
        d.timer.begin(Some("task".into()), "work", 45, 12345);
        d.timer.pause(23456).unwrap();
        let before = serde_json::to_value(&d).unwrap();
        rename_task(&mut d, "task", "Renamed").unwrap();
        let mut after = serde_json::to_value(&d).unwrap();
        after["tasks"][0]["title"] = before["tasks"][0]["title"].clone();
        assert_eq!(before, after);
        assert!(rename_task(&mut d, "task", "  ").is_err());
    }
    #[test]
    fn legacy_free_timer_finishes_but_new_focus_requires_named_active_task() {
        let mut d = Data::default();
        d.timer.begin(None, "work", 1, 0);
        assert_eq!(finish_due(&mut d, 60000), vec!["work"]);
        assert_eq!(d.sessions.len(), 1);
        assert!(d.sessions[0].task_id.is_none());
        assert!(validate_focus_task(&d, "").is_err());
        d.tasks.push(task());
        assert!(validate_focus_task(&d, "task").is_ok());
        d.tasks[0].status = "completed".into();
        assert!(validate_focus_task(&d, "task").is_err());
    }
}
