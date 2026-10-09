mod durations;
mod labels;
mod model;
mod notifications;
mod priorities;
#[cfg(debug_assertions)]
mod smoke;
mod sound;
mod storage;
use chrono::{Local, NaiveDate};
use model::*;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct Core {
    conn: Connection,
    data: Data,
    path: PathBuf,
    service_error: Option<String>,
    labels: labels::Catalog,
    priorities: priorities::Priorities,
    durations: durations::Durations,
}
impl Core {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            data: self.data.clone(),
            remaining_ms: self
                .data
                .timer
                .remaining_ms(Local::now().timestamp_millis()),
            database_path: self.path.to_string_lossy().into(),
            service_error: self.service_error.clone(),
            labels: self.labels.available(&self.data.tasks),
            priorities: self.priorities.0.clone(),
            task_durations: self.durations.0.clone(),
        }
    }
    fn commit(&mut self, next: Data) -> Result<(), String> {
        storage::save(&mut self.conn, &next)?;
        self.data = next;
        Ok(())
    }
    fn commit_with_durations(
        &mut self,
        next: Data,
        durations: Option<durations::Durations>,
    ) -> Result<(), String> {
        let Some(durations) = durations else {
            return self.commit(next);
        };
        let path = self.path.with_file_name("task-durations.json");
        durations.save(&path)?;
        if let Err(error) = self.commit(next) {
            self.durations
                .save(&path)
                .map_err(|rollback| format!("{error}; süre tercihi geri alınamadı: {rollback}"))?;
            return Err(error);
        }
        self.durations = durations;
        Ok(())
    }
}
struct AppState(Mutex<Core>);
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn synchronize_services(
    app: &tauri::AppHandle,
    old: Option<&Settings>,
    new: &Settings,
) -> Result<(), String> {
    let shortcut: Shortcut = new
        .quick_add_shortcut
        .parse()
        .map_err(|_| "Geçersiz kısayol. Örnek: CmdOrCtrl+Shift+K".to_string())?;
    if old.is_none_or(|s| s.quick_add_shortcut != new.quick_add_shortcut) {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| format!("Kısayol kaydedilemedi: {e}"))?;
        if let Some(old) = old {
            let _ = app
                .global_shortcut()
                .unregister(old.quick_add_shortcut.as_str());
        }
    }
    #[cfg(debug_assertions)]
    if smoke::enabled() {
        return Ok(());
    }
    let result = if new.launch_at_login {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|e| format!("Otomatik başlatma ayarlanamadı: {e}"))
}
#[tauri::command]
fn drive_backup_status() -> Value {
    let Some(home) = std::env::var_os("HOME") else {
        return json!({"configured": false});
    };
    let profile = PathBuf::from(home).join("Library/Application Support/Odak Backup");
    let state: Value = std::fs::read(profile.join("state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    json!({"configured": profile.join("config.json").exists(),
        "lastUploadedAt": state["last_uploaded_at"], "lastFilename": state["last_filename"]})
}
#[tauri::command]
fn request_notification_permission() {
    notifications::request_permission();
}
#[tauri::command]
fn snapshot(state: State<AppState>) -> Result<Snapshot, String> {
    let c = state.0.lock().map_err(|e| e.to_string())?;
    Ok(c.snapshot())
}
fn execute(
    app: tauri::AppHandle,
    state: State<AppState>,
    action: String,
    payload: Value,
) -> Result<Snapshot, String> {
    if matches!(
        action.as_str(),
        "delete_task" | "delete_label" | "cancel" | "finish"
    ) && payload["confirmed"].as_bool() != Some(true)
    {
        return Err("Bu işlem için önce onay verin.".into());
    }
    // OS services may marshal onto the main thread; never hold the database lock here.
    let incoming_settings = if action == "settings" {
        let settings: Settings =
            serde_json::from_value(payload.clone()).map_err(|e| e.to_string())?;
        validate_settings(&settings)?;
        let old = state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .data
            .settings
            .clone();
        synchronize_services(&app, Some(&old), &settings)?;
        Some(settings)
    } else {
        None
    };
    let mut core = state.0.lock().map_err(|e| e.to_string())?;
    if action == "finish" {
        let task_id = payload["taskId"].as_str().ok_or("Görev bulunamadı.")?;
        let stamp = payload.get("startedAt").ok_or("Oturum başlangıcı eksik.")?;
        if !stamp.is_null() && stamp.as_i64().is_none() {
            return Err("Oturum başlangıcı geçersiz.".into());
        }
        let mut next = core.data.clone();
        finish_task_session(
            &mut next,
            task_id,
            stamp.as_i64(),
            Local::now().timestamp_millis(),
        )?;
        core.commit(next)?;
        let snapshot = core.snapshot();
        drop(core);
        let _ = app.emit("data-changed", ());
        return Ok(snapshot);
    }
    if action == "set_priority" {
        let id = payload["id"].as_str().ok_or("Görev bulunamadı.")?;
        if !core.data.tasks.iter().any(|t| t.id == id) {
            return Err("Görev bulunamadı.".into());
        }
        let rating = payload["rating"]
            .as_u64()
            .filter(|r| (1..=5).contains(r))
            .ok_or("Öncelik 1–5 yıldız arasında olmalı.")?;
        let path = core.path.with_file_name("priorities.json");
        let mut priorities = priorities::Priorities::load(&path)?;
        priorities.set(id, rating as u8)?;
        priorities.save(&path)?;
        core.priorities = priorities;
        let snapshot = core.snapshot();
        drop(core);
        let _ = app.emit("data-changed", ());
        return Ok(snapshot);
    }
    // Past calendar reads never generate or persist new historical instances.
    if action == "ensure_day"
        && payload["date"]
            .as_str()
            .is_some_and(|date| date < Local::now().date_naive().to_string().as_str())
    {
        return Ok(core.snapshot());
    }
    // Catalog edits only touch labels.json, never task/session/timer rows.
    if action == "save_label" || action == "delete_label" {
        let name = payload["name"].as_str().ok_or("Etiket adı gerekli.")?;
        let path = core.path.with_file_name("labels.json");
        let mut catalog = labels::Catalog::load(&path)?;
        if action == "save_label" {
            catalog.add(
                name,
                payload["color"].as_str().ok_or("Etiket rengi gerekli.")?,
            )?;
        } else {
            catalog.remove(name);
        }
        catalog.save(&path)?;
        core.labels = catalog;
        let snapshot = core.snapshot();
        drop(core);
        let _ = app.emit("data-changed", ());
        return Ok(snapshot);
    }
    let mut next = core.data.clone();
    let mut pending_durations = None;
    let now = Local::now().timestamp_millis();
    // Apply any deadline before user actions; cancellation after a finished deadline cannot erase earned work.
    let finished = finish_due(&mut next, now);
    match action.as_str() {
        "save_task" => {
            let mut fields = payload;
            let duration = fields
                .as_object_mut()
                .ok_or("Görev geçersiz.")?
                .remove("pomodoroMin");
            let mut task: Task = serde_json::from_value(fields).map_err(|e| e.to_string())?;
            let is_new = !next.tasks.iter().any(|old| old.id == task.id);
            if let Some(minutes) = durations::validate_input(duration.as_ref(), is_new)? {
                let mut durations = core.durations.clone();
                durations.0.insert(task.id.clone(), minutes);
                pending_durations = Some(durations);
            }
            task.title = task.title.trim().into();
            let previous = next.tasks.iter().find(|old| old.id == task.id);
            validate_label_change(&task, previous)?;
            validate_task(&task)?;
            validate_planning_change(
                &task,
                next.tasks.iter().find(|old| old.id == task.id),
                Local::now(),
            )?;
            if core.labels.hidden.contains(&task.label) {
                let path = core.path.with_file_name("labels.json");
                let mut catalog = labels::Catalog::load(&path)?;
                catalog.add(&task.label, &task.color)?;
                catalog.save(&path)?;
                core.labels = catalog;
            }
            upsert_task(&mut next, task, Local::now().date_naive());
            reminder_horizon(&mut next, Local::now());
        }
        "rename_task" => {
            rename_task(
                &mut next,
                payload["id"].as_str().ok_or("Görev bulunamadı.")?,
                payload["title"].as_str().ok_or("Görev başlığı gerekli.")?,
            )?;
        }
        "toggle_task" => {
            let id = payload["id"].as_str().ok_or("Görev bulunamadı.")?;
            let t = next
                .tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("Görev bulunamadı.")?;
            if t.recurrence_rule.is_some() {
                return Err("Tekrar serisi yerine bir günün görevini tamamlayın.".into());
            }
            t.status = if t.status == "completed" {
                "active"
            } else {
                "completed"
            }
            .into();
            t.completed_at = if t.status == "completed" {
                Some(now)
            } else {
                None
            };
        }
        "delete_task" => {
            let id = payload["id"].as_str().ok_or("Görev bulunamadı.")?;
            if next.timer.phase != "idle" && next.timer.task_id.as_deref() == Some(id) {
                return Err("Önce bu görevin sayacını iptal edin.".into());
            }
            // Removing a series preserves completed and started history.
            prune_future_instances(&mut next, id, Local::now().date_naive());
            next.tasks.retain(|t| t.id != id);
        }
        "ensure_day" => {
            let date = NaiveDate::parse_from_str(
                payload["date"].as_str().ok_or("Geçersiz tarih.")?,
                "%Y-%m-%d",
            )
            .map_err(|_| "Geçersiz tarih.")?;
            materialize(&mut next, date);
        }
        "start" => {
            if next.timer.phase != "idle" {
                return Err("Önce çalışan sayacı durdurun.".into());
            }
            let work = payload["workMin"]
                .as_u64()
                .ok_or("Çalışma süresi geçersiz.")?;
            let rest = payload["breakMin"]
                .as_u64()
                .ok_or("Mola süresi geçersiz.")?;
            if !(1..=90).contains(&work) || !(1..=30).contains(&rest) {
                return Err("Çalışma 1–90, mola 1–30 dakika olmalı.".into());
            }
            let id = payload["taskId"]
                .as_str()
                .ok_or("Önce adı olan bir görev seçin.")?;
            validate_focus_start(&next, id, Local::now().date_naive())?;
            let task = Some(id.to_string());
            next.timer.work_min = work as u32;
            next.timer.break_min = rest as u32;
            next.timer.begin(task, "work", work as u32, now);
        }
        "pause" => next.timer.pause(now)?,
        "resume" => next.timer.resume(now)?,
        "cancel" => next.timer.cancel(),
        "continue_work" => {
            if !next.timer.break_ready || next.timer.phase != "idle" {
                return Err("Mola henüz bitmedi.".into());
            }
            let id = next
                .timer
                .task_id
                .as_deref()
                .ok_or("Yeni odak oturumu için bir görev seçin.")?;
            validate_focus_start(&next, id, Local::now().date_naive())?;
            let task = Some(id.to_string());
            let minutes = core.durations.for_task(
                next.tasks.iter().find(|t| t.id == id).unwrap(),
                next.timer.work_min,
            );
            next.timer.work_min = minutes;
            next.timer.begin(task, "work", minutes, now);
        }
        "extend_break" => {
            if !next.timer.break_ready || next.timer.phase != "idle" {
                return Err("Mola henüz bitmedi.".into());
            }
            next.timer
                .begin(next.timer.task_id.clone(), "break", 5, now);
        }
        "settings" => {
            next.settings = incoming_settings.unwrap();
            core.service_error = None;
        }
        "test_sound" => {
            if next.settings.sound_enabled && !next.settings.quiet_mode {
                sound::play(
                    payload["phase"].as_str().unwrap_or("work"),
                    next.settings.sound_volume,
                );
            }
        }
        _ => return Err("Bilinmeyen işlem.".into()),
    }
    core.commit_with_durations(next, pending_durations)?;
    let snapshot = core.snapshot();
    drop(core);
    for phase in finished {
        notify_finish(&app, &phase);
    }
    let _ = app.emit("data-changed", ());
    Ok(snapshot)
}
#[tauri::command]
async fn command(
    app: tauri::AppHandle,
    action: String,
    payload: Value,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute(app.clone(), app.state::<AppState>(), action, payload)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn notify_finish(app: &tauri::AppHandle, phase: &str) {
    let state = app.state::<AppState>();
    let settings = state.0.lock().unwrap().data.settings.clone();
    let (title, body) = if phase == "work" {
        (
            "Çalışma bitti",
            "Çalışma oturumun kaydedildi. Şimdi mola zamanı.",
        )
    } else {
        (
            "Mola bitti",
            "Odak’ı açıp Devam et veya 5 dk daha seçebilirsin.",
        )
    };
    if let Err(e) = notifications::send(title, body, false) {
        state.0.lock().unwrap().service_error = Some(format!("Bildirim gönderilemedi: {e}"));
    }
    if settings.sound_enabled && !settings.quiet_mode {
        sound::play(phase, settings.sound_volume);
    }
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Backup {
    format: String,
    version: u32,
    exported_at: i64,
    data: Data,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    task_durations: Option<durations::Durations>,
}
fn validate_backup(data: &Data) -> Result<(), String> {
    validate_settings(&data.settings)?;
    let mut ids = std::collections::HashSet::new();
    for task in &data.tasks {
        validate_task(task)?;
        if !ids.insert(task.id.clone()) {
            return Err("Yinelenen görev kimliği.".into());
        }
    }
    let mut sessions = std::collections::HashSet::new();
    for s in &data.sessions {
        if !sessions.insert(&s.id)
            || !["work", "break"].contains(&s.r#type.as_str())
            || s.planned_min < 1
            || s.planned_min > 90
            || !s.actual_min.is_finite()
            || s.actual_min < 0.0
            || s.actual_min > s.planned_min as f64
            || s.ended_at < s.started_at
        {
            return Err("Oturum kaydı geçersiz.".into());
        }
    }
    let t = &data.timer;
    if !["work", "break", "paused", "idle"].contains(&t.phase.as_str())
        || !(1..=90).contains(&t.work_min)
        || !(1..=30).contains(&t.break_min)
        || !(1..=90).contains(&t.planned_min)
        || t.paused_accumulated_ms < 0
    {
        return Err("Sayaç kaydı geçersiz.".into());
    }
    if t.phase != "idle" && t.started_at.is_none() {
        return Err("Sayaç başlangıcı eksik.".into());
    }
    if t.phase == "paused"
        && (t.paused_at.is_none() || !matches!(t.paused_phase.as_deref(), Some("work" | "break")))
    {
        return Err("Duraklama kaydı geçersiz.".into());
    }
    let effective_phase = if t.phase == "paused" {
        t.paused_phase.as_deref().unwrap_or("idle")
    } else {
        t.phase.as_str()
    };
    if effective_phase == "work" && t.planned_min > 90
        || effective_phase == "break" && t.planned_min > 30
    {
        return Err("Sayaç faz süresi geçersiz.".into());
    }
    if t.phase != "idle"
        && t.task_id
            .as_ref()
            .is_some_and(|id| !data.tasks.iter().any(|task| &task.id == id))
    {
        return Err("Sayaç görevi yedekte bulunamadı.".into());
    }
    for timestamp in [t.started_at, t.paused_at].into_iter().flatten() {
        if !(0..=253_402_214_400_000).contains(&timestamp) {
            return Err("Sayaç zamanı geçersiz.".into());
        }
    }
    if let (Some(started), Some(paused)) = (t.started_at, t.paused_at) {
        if paused < started || t.paused_accumulated_ms > paused - started {
            return Err("Duraklama zamanı geçersiz.".into());
        }
    }
    if t.paused_accumulated_ms > 253_402_214_400_000 {
        return Err("Duraklama birikimi geçersiz.".into());
    }
    Ok(())
}
fn choose_backup_file(save: bool) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if smoke::enabled() {
        if let Some(file) = std::env::var_os("ODAK_SMOKE_BACKUP_FILE") {
            return Some(PathBuf::from(file));
        }
    }
    let dialog = rfd::FileDialog::new().add_filter("JSON", &["json"]);
    if save {
        dialog
            .set_title("Odak yedeğini kaydet")
            .set_file_name("odak-yedek.json")
            .save_file()
    } else {
        dialog.set_title("Odak yedeğini geri yükle").pick_file()
    }
}
#[tauri::command]
async fn export_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = choose_backup_file(true) else {
            return Ok(None);
        };
        let state = app.state::<AppState>();
        let core = state.0.lock().map_err(|e| e.to_string())?;
        let backup = Backup {
            format: "odak-backup".into(),
            version: 1,
            exported_at: Local::now().timestamp_millis(),
            data: core.data.clone(),
            task_durations: Some(core.durations.for_export(&core.data.tasks)),
        };
        std::fs::write(
            &file,
            serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(Some(file.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_backup(app: tauri::AppHandle, confirmed: bool) -> Result<Option<String>, String> {
    if !confirmed {
        return Err("Mevcut verilerin değiştirilmesi için önce onay verin.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = choose_backup_file(false) else {
            return Ok(None);
        };
        if std::fs::metadata(&file).map_err(|e| e.to_string())?.len() > 50_000_000 {
            return Err("Yedek dosyası 50 MB sınırını aşıyor.".into());
        }
        let backup: Backup =
            serde_json::from_slice(&std::fs::read(&file).map_err(|e| e.to_string())?)
                .map_err(|_| "Yedek dosyası geçersiz.".to_string())?;
        if backup.format != "odak-backup" || backup.version != 1 {
            return Err("Desteklenmeyen yedek biçimi.".into());
        }
        validate_backup(&backup.data)?;
        if let Some(durations) = &backup.task_durations {
            durations.validate()?;
        }
        let state = app.state::<AppState>();
        let core = state.0.lock().map_err(|e| e.to_string())?;
        if core.data.timer.phase != "idle" {
            return Err("İçe aktarmadan önce sayacı iptal edin.".into());
        }
        let recovery = core
            .path
            .with_file_name(format!("recovery-{}.json", Local::now().timestamp_millis()));
        std::fs::write(
            &recovery,
            serde_json::to_vec_pretty(&Backup {
                format: "odak-backup".into(),
                version: 1,
                exported_at: Local::now().timestamp_millis(),
                data: core.data.clone(),
                task_durations: Some(core.durations.for_export(&core.data.tasks)),
            })
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let old_settings = core.data.settings.clone();
        drop(core);
        synchronize_services(&app, Some(&old_settings), &backup.data.settings)?;
        let mut core = state.0.lock().map_err(|e| e.to_string())?;
        if core.data.timer.phase != "idle" {
            drop(core);
            let _ = synchronize_services(&app, Some(&backup.data.settings), &old_settings);
            return Err("İçe aktarma sırasında sayaç başlatıldı. Önce sayacı iptal edin.".into());
        }
        core.commit_with_durations(backup.data, backup.task_durations)?;
        drop(core);
        let _ = app.emit("data-changed", ());
        Ok(Some(recovery.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn tick(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut core = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now();
    let ms = now.timestamp_millis();
    let mut next = core.data.clone();
    let mut changed = reminder_horizon(&mut next, now);
    let finished = finish_due(&mut next, ms);
    changed |= !finished.is_empty();
    let mut reminders = vec![];
    for task in &next.tasks {
        if task.status != "active" || task.recurrence_rule.is_some() {
            continue;
        }
        if let Some(start) = task.start_at {
            let key = format!("{}:{start}:{}", task.id, next.settings.notify_lead_min);
            if ms >= start - next.settings.notify_lead_min as i64 * 60_000
                && ms < task.end_at.unwrap_or(start + 60_000)
                && !next.notified.contains(&key)
            {
                let minutes = ((start - ms) as f64 / 60000.0).ceil().max(0.0) as i64;
                let body = if minutes > 0 {
                    format!(
                        "Programın var: \"{}\" {} dakika sonra başlayacak",
                        task.title, minutes
                    )
                } else {
                    format!("Programın başladı: \"{}\"", task.title)
                };
                reminders.push((key, body));
            }
        }
    }
    let quiet = next.settings.quiet_mode;
    let remaining = next.timer.remaining_ms(ms);
    let phase = next.timer.phase.clone();
    if changed {
        core.commit(next)?;
    }
    drop(core);
    // Mark only successfully delivered reminders, allowing retries after permission or service errors.
    for (key, body) in reminders {
        let result = notifications::send("Odak · Programın var", &body, !quiet);
        let mut c = state.0.lock().map_err(|e| e.to_string())?;
        match result {
            Ok(()) => {
                let mut d = c.data.clone();
                d.notified.push(key);
                c.commit(d)?;
            }
            Err(e) => c.service_error = Some(format!("Bildirim gönderilemedi: {e}")),
        }
    }
    if let Some(tray) = app.tray_by_id("odak") {
        let title = if phase == "idle" {
            String::new()
        } else {
            let seconds = (remaining + 999) / 1000;
            format!(
                "{}{:02}:{:02}",
                if phase == "paused" { "Ⅱ " } else { "" },
                seconds / 60,
                seconds % 60
            )
        };
        let _ = tray.set_title(Some(title));
    }
    for phase in finished {
        notify_finish(app, &phase);
    }
    if changed {
        let _ = app.emit("data-changed", ());
    }
    let _ = app.emit("timer-tick", json!({"remainingMs":remaining,"phase":phase}));
    Ok(())
}
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        snapshot,
        command,
        export_backup,
        import_backup,
        request_notification_permission,
        drive_backup_status,
        smoke::smoke_report
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        snapshot,
        command,
        export_backup,
        import_backup,
        request_notification_permission,
        drive_backup_status
    ]);
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(MacosLauncher::LaunchAgent)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("quick") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = app.emit_to("quick", "quick-open", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            notifications::request_permission();
            let dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let dir = if smoke::enabled() {
                PathBuf::from(std::env::var("ODAK_SMOKE_DIR").unwrap())
            } else {
                dir
            };
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("odak.sqlite3");
            let conn = storage::open(&path).map_err(std::io::Error::other)?;
            let data = storage::load(&conn).map_err(std::io::Error::other)?;
            let labels =
                labels::Catalog::load(&dir.join("labels.json")).map_err(std::io::Error::other)?;
            let priorities = priorities::Priorities::load(&dir.join("priorities.json"))
                .map_err(std::io::Error::other)?;
            let durations = durations::Durations::load(&dir.join("task-durations.json"))
                .map_err(std::io::Error::other)?;
            let service_error = synchronize_services(app.handle(), None, &data.settings).err();
            app.manage(AppState(Mutex::new(Core {
                conn,
                data,
                path,
                service_error,
                labels,
                priorities,
                durations,
            })));
            let open = MenuItem::with_id(app, "open", "Odak’ı aç", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "Hızlı görev ekle", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çık", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick, &quit])?;
            TrayIconBuilder::with_id("odak")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Odak · Odaklan, planla, tamamla")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quick" => {
                        if let Some(w) = app.get_webview_window("quick") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = app.emit_to("quick", "quick-open", ());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                show_main(app);
                            }
                        }
                    }
                })
                .build(app)?;
            #[cfg(debug_assertions)]
            if smoke::enabled() {
                smoke::start(app.handle().clone());
            }
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                if let Err(e) = tick(&handle) {
                    if let Some(state) = handle.try_state::<AppState>() {
                        if let Ok(mut c) = state.0.lock() {
                            c.service_error = Some(e);
                        }
                    }
                }
                thread::sleep(Duration::from_secs(1));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Odak başlatılamadı");
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    #[test]
    fn early_finished_work_survives_sqlite_and_json_backup_validation() {
        let mut data = Data::default();
        data.tasks.push(serde_json::from_value(json!({"id":"early","title":"Task","label":"İş","color":"#438470","notes":"Preserve","status":"active","completedAt":null,"estimateMin":120,"scheduledDate":null,"startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":null,"seriesId":null,"subtasks":[],"createdAt":0})).unwrap());
        data.timer.begin(Some("early".into()), "work", 45, 0);
        finish_task_session(&mut data, "early", Some(0), 750000).unwrap();
        validate_backup(&data).unwrap();
        let mut conn = storage::open(std::path::Path::new(":memory:")).unwrap();
        storage::save(&mut conn, &data).unwrap();
        let restored = storage::load(&conn).unwrap();
        assert_eq!(restored.tasks[0].status, "completed");
        assert_eq!(restored.tasks[0].notes, "Preserve");
        assert_eq!(restored.tasks[0].estimate_min, Some(120));
        assert_eq!(restored.sessions[0].actual_min, 12.5);
        assert_eq!(restored.timer.phase, "idle");
        let backup = Backup {
            format: "odak-backup".into(),
            version: 1,
            exported_at: 750000,
            data: restored,
            task_durations: None,
        };
        let decoded: Backup =
            serde_json::from_slice(&serde_json::to_vec(&backup).unwrap()).unwrap();
        validate_backup(&decoded.data).unwrap();
        assert_eq!(decoded.data.sessions[0].actual_min, 12.5);
    }
    #[test]
    fn duration_preference_edit_preserves_work_timer_and_rolls_back_on_database_failure() {
        let dir = std::env::temp_dir().join(format!("odak-commit-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("odak.sqlite3");
        let conn = storage::open(&path).unwrap();
        let mut data = Data::default();
        data.timer.begin(None, "work", 45, 1000);
        let mut core = Core {
            conn,
            data,
            path,
            service_error: None,
            labels: labels::Catalog::default(),
            priorities: priorities::Priorities::default(),
            durations: durations::Durations::default(),
        };
        core.commit(core.data.clone()).unwrap();
        let before = serde_json::to_value(&core.data).unwrap();
        let mut durations = durations::Durations::default();
        durations.0.insert("task".into(), 30);
        core.commit_with_durations(core.data.clone(), Some(durations.clone()))
            .unwrap();
        assert_eq!(
            serde_json::to_value(storage::load(&core.conn).unwrap()).unwrap(),
            before
        );
        core.conn.execute_batch("PRAGMA query_only=ON").unwrap();
        let mut failed = durations.clone();
        failed.0.insert("task".into(), 20);
        assert!(core
            .commit_with_durations(core.data.clone(), Some(failed))
            .is_err());
        assert_eq!(core.durations.0["task"], 30);
        assert_eq!(
            durations::Durations::load(&dir.join("task-durations.json"))
                .unwrap()
                .0["task"],
            30
        );
        assert_eq!(serde_json::to_value(&core.data).unwrap(), before);
        drop(core);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn duration_backup_roundtrip_and_legacy_backup_compatibility() {
        let legacy =
            json!({"format":"odak-backup","version":1,"exportedAt":1,"data":Data::default()});
        assert!(serde_json::from_value::<Backup>(legacy.clone())
            .unwrap()
            .task_durations
            .is_none());
        let mut current = legacy;
        current["taskDurations"] = json!({"new-task":30});
        let backup: Backup = serde_json::from_value(current).unwrap();
        let bytes = serde_json::to_vec(&backup).unwrap();
        let restored: Backup = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored.task_durations.unwrap().0["new-task"], 30);
    }
    #[test]
    fn json_backup_roundtrip_keeps_timer_sessions_and_settings() {
        let mut d = Data::default();
        d.timer.begin(None, "work", 45, 1000);
        d.timer.pause(61000).unwrap();
        d.settings.quiet_mode = true;
        let bytes = serde_json::to_vec(&Backup {
            format: "odak-backup".into(),
            version: 1,
            exported_at: 10,
            data: d,
            task_durations: None,
        })
        .unwrap();
        let decoded: Backup = serde_json::from_slice(&bytes).unwrap();
        validate_backup(&decoded.data).unwrap();
        assert_eq!(decoded.data.timer.remaining_ms(1000000), 44 * 60000);
        assert!(decoded.data.settings.quiet_mode);
        let mut db = storage::open(std::path::Path::new(":memory:")).unwrap();
        storage::save(&mut db, &decoded.data).unwrap();
        assert_eq!(storage::load(&db).unwrap().timer.phase, "paused");
    }
    #[test]
    fn import_rejects_invalid_phase_lengths_and_missing_task() {
        let mut d = Data::default();
        d.timer.begin(None, "break", 31, 1000);
        assert!(validate_backup(&d).is_err());
        d.timer.begin(Some("missing".into()), "work", 45, 1000);
        assert!(validate_backup(&d).is_err());
    }
    #[test]
    fn import_rejects_unknown_schema_and_impossible_pause() {
        assert!(serde_json::from_value::<Backup>(
            json!({"format":"odak-backup","version":1,"exportedAt":1,"data":{},"unknown":true})
        )
        .is_err());
        let mut d = Data::default();
        d.timer.begin(None, "work", 45, 1000);
        d.timer.pause(61000).unwrap();
        d.timer.paused_accumulated_ms = 62000;
        assert!(validate_backup(&d).is_err());
    }
}
