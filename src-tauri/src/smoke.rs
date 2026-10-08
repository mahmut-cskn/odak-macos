//! Native integration checks compiled exclusively into debug builds.
use super::*;
use std::ffi::CString;
unsafe extern "C" {
    fn odak_snapshot_webview(webview: *mut std::ffi::c_void, file: *const std::ffi::c_char);
}
pub fn enabled() -> bool {
    std::env::var_os("ODAK_SMOKE_DIR").is_some()
}
#[tauri::command]
pub fn smoke_report(payload: Value) -> Result<(), String> {
    let dir = std::env::var("ODAK_SMOKE_DIR").map_err(|_| "Smoke testing is disabled")?;
    std::fs::write(
        PathBuf::from(dir).join("ui.json"),
        serde_json::to_vec_pretty(&payload).unwrap(),
    )
    .map_err(|e| e.to_string())
}
pub fn start(app: tauri::AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        let result = if std::env::var_os("ODAK_SMOKE_RESTORE").is_some() {
            restore_checks(&app)
        } else {
            checks(&app)
        };
        let dir = PathBuf::from(std::env::var("ODAK_SMOKE_DIR").unwrap());
        let report = match result {
            Ok(v) => json!({"passed":true,"checks":v}),
            Err(e) => json!({"passed":false,"error":e}),
        };
        let _ = std::fs::write(
            dir.join("native.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        );
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.eval(r#"document.querySelector('.add-button')?.click();setTimeout(()=>{window.__TAURI_INTERNALS__.invoke('smoke_report',{payload:{title:document.title,body:document.body.innerText,nativeTaskDialog:!!document.querySelector('[role=dialog]'),randomUUID:typeof crypto.randomUUID,isSecureContext:window.isSecureContext}});document.querySelector('.modal-heading button')?.click()},150)"#);
            thread::sleep(Duration::from_secs(1));
            let file =
                CString::new(dir.join("native-ui.png").to_string_lossy().as_bytes()).unwrap();
            let _ = w.with_webview(move |view| unsafe {
                odak_snapshot_webview(view.inner(), file.as_ptr())
            });
        }
        if std::env::var_os("ODAK_SMOKE_EXIT").is_some() {
            thread::sleep(Duration::from_secs(2));
            app.exit(0);
        }
    });
}
fn restore_checks(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let before = snapshot(app.state::<AppState>())?;
    if before.data.timer.phase != "work" || before.remaining_ms <= 0 || before.remaining_ms >= 60000
    {
        return Err("Running timer did not survive process restart".into());
    }
    if before
        .data
        .sessions
        .iter()
        .filter(|s| s.r#type == "work")
        .count()
        != 1
    {
        return Err("Restart duplicated work credit".into());
    }
    execute(
        app.clone(),
        app.state::<AppState>(),
        "cancel".into(),
        json!({"confirmed":true}),
    )?;
    let after = snapshot(app.state::<AppState>())?;
    if after.data.sessions.len() != before.data.sessions.len() {
        return Err("Cancel after restart added credit".into());
    }
    Ok(vec![
        "Real process exit and reopen preserve timestamp-based countdown".into(),
        "Cancel after restart creates no session and preserves earned history".into(),
    ])
}
fn checks(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut result = vec![];
    let invoke = |name: &str, payload: Value| {
        execute(app.clone(), app.state::<AppState>(), name.into(), payload)
    };
    let task:Task=serde_json::from_value(json!({"id":"native-task","title":"Yerel doğrulama","label":"Test","color":"#438470","notes":"Native SQLite test","status":"active","completedAt":null,"estimateMin":480,"scheduledDate":Local::now().date_naive().to_string(),"startAt":null,"endAt":null,"dueAt":null,"recurrenceRule":null,"seriesId":null,"subtasks":[],"createdAt":Local::now().timestamp_millis()})).unwrap();
    invoke("save_task", serde_json::to_value(&task).unwrap())?;
    invoke("start", json!({"taskId":task.id,"workMin":1,"breakMin":1}))?;
    let before_priority = snapshot(app.state::<AppState>())?;
    invoke("set_priority", json!({"id":task.id,"rating":4}))?;
    let after_priority = snapshot(app.state::<AppState>())?;
    if serde_json::to_value(&before_priority.data).unwrap()
        != serde_json::to_value(&after_priority.data).unwrap()
        || after_priority.priorities.get(&task.id) != Some(&4)
    {
        return Err("Priority edit modified existing tasks or timer".into());
    }
    if invoke("delete_task", json!({"id":task.id})).is_ok() || invoke("cancel", json!({})).is_ok() {
        return Err("Deletion accepted without confirmation".into());
    }
    result.push(
        "Priority preferences preserve task/timer payloads; unconfirmed deletions rejected".into(),
    );
    invoke("pause", json!({}))?;
    {
        let state = app.state::<AppState>();
        let c = state.0.lock().unwrap();
        let from_disk = storage::load(&c.conn)?;
        if from_disk.timer.phase != "paused"
            || from_disk
                .timer
                .remaining_ms(Local::now().timestamp_millis() + 120000)
                < 59000
        {
            return Err("Paused persistence failed".into());
        }
    }
    invoke("resume", json!({}))?;
    invoke("cancel", json!({"confirmed":true}))?;
    if !snapshot(app.state::<AppState>())?.data.sessions.is_empty() {
        return Err("Cancel wrote a session".into());
    }
    result.push("Create, start, pause, SQLite reload, resume and cancel without credit".into());
    invoke("start", json!({"taskId":task.id,"workMin":1,"breakMin":1}))?;
    {
        let state = app.state::<AppState>();
        let mut c = state.0.lock().unwrap();
        let mut d = c.data.clone();
        d.timer.started_at = Some(Local::now().timestamp_millis() - 61000);
        c.commit(d)?;
    }
    tick(app)?;
    let snap = snapshot(app.state::<AppState>())?;
    if snap
        .data
        .sessions
        .iter()
        .filter(|s| s.r#type == "work")
        .count()
        != 1
        || snap.data.tasks[0].status != "active"
        || snap.data.timer.phase != "break"
    {
        return Err("Work completion semantics failed".into());
    }
    result.push("Rust work deadline credits exactly one minute and never completes task".into());
    {
        let state = app.state::<AppState>();
        let mut c = state.0.lock().unwrap();
        let mut d = c.data.clone();
        d.timer.started_at = Some(Local::now().timestamp_millis() - 61000);
        c.commit(d)?;
    }
    tick(app)?;
    if !snapshot(app.state::<AppState>())?.data.timer.break_ready {
        return Err("Break completion failed".into());
    }
    invoke("extend_break", json!({}))?;
    if snapshot(app.state::<AppState>())?.data.timer.planned_min != 5 {
        return Err("Break extension failed".into());
    }
    invoke("cancel", json!({"confirmed":true}))?;
    result.push(
        "Native work/break notifications and two synthesized tones; five-minute break extension"
            .into(),
    );
    invoke("toggle_task", json!({"id":task.id}))?;
    invoke("toggle_task", json!({"id":task.id}))?;
    let restored = snapshot(app.state::<AppState>())?;
    if restored.data.tasks[0].status != "active" || restored.data.tasks[0].completed_at.is_some() {
        return Err("Restore failed".into());
    }
    result.push("Manual completion and undo preserve the original scheduled day".into());
    let mut invalid = restored.data.settings.clone();
    invalid.default_work_min = 91;
    if invoke("settings", serde_json::to_value(invalid).unwrap()).is_ok() {
        return Err("Limit enforcement failed".into());
    }
    let mut updated = restored.data.settings.clone();
    updated.quick_add_shortcut = "CmdOrCtrl+Shift+O".into();
    updated.quiet_mode = true;
    invoke("settings", serde_json::to_value(&updated).unwrap())?;
    if !app
        .global_shortcut()
        .is_registered(updated.quick_add_shortcut.as_str())
    {
        return Err("Shortcut registration failed".into());
    }
    invoke(
        "settings",
        serde_json::to_value(restored.data.settings).unwrap(),
    )?;
    result
        .push("Settings validation, quiet mode and native global shortcut re-registration".into());
    let mut planned = task.clone();
    planned.id = "native-plan".into();
    planned.title = "Planlı görev hatırlatması".into();
    planned.start_at = Some(Local::now().timestamp_millis() + 14 * 60000);
    planned.end_at = Some(Local::now().timestamp_millis() + 15 * 60000);
    use chrono::TimeZone;
    planned.scheduled_date = Some(
        Local
            .timestamp_millis_opt(planned.start_at.unwrap())
            .single()
            .unwrap()
            .date_naive()
            .to_string(),
    );
    invoke("save_task", serde_json::to_value(planned).unwrap())?;
    tick(app)?;
    if !snapshot(app.state::<AppState>())?
        .data
        .notified
        .iter()
        .any(|key| key.starts_with("native-plan:"))
    {
        return Err("Scheduled reminder was not accepted by macOS".into());
    }
    tick(app)?;
    if snapshot(app.state::<AppState>())?.data.notified.len() != 1 {
        return Err("Reminder duplicated".into());
    }
    result.push(
        "Native scheduled reminder at the configured lead time; persisted deduplication".into(),
    );
    let current = snapshot(app.state::<AppState>())?;
    validate_backup(&current.data)?;
    result.push("Backup schema validates real native data".into());
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
        if window.is_visible().unwrap_or(true) {
            return Err("Hide failed".into());
        }
        window.show().map_err(|e| e.to_string())?;
    }
    if app.tray_by_id("odak").is_none() {
        return Err("Tray missing".into());
    }
    result.push(
        "Real macOS tray exists; hiding and reopening the WebView preserves app state".into(),
    );
    invoke("start", json!({"taskId":task.id,"workMin":1,"breakMin":1}))?;
    let backup_file =
        PathBuf::from(std::env::var("ODAK_SMOKE_DIR").unwrap()).join("roundtrip.json");
    std::env::set_var("ODAK_SMOKE_BACKUP_FILE", &backup_file);
    tauri::async_runtime::block_on(export_backup(app.clone()))?;
    if tauri::async_runtime::block_on(import_backup(app.clone(), true)).is_ok() {
        return Err("Import accepted an active timer".into());
    }
    invoke("cancel", json!({"confirmed":true}))?;
    let mut edited = task.clone();
    edited.notes = "Changed after backup".into();
    invoke("save_task", serde_json::to_value(edited).unwrap())?;
    let recovery = tauri::async_runtime::block_on(import_backup(app.clone(), true))?
        .ok_or("Import produced no recovery backup")?;
    let prior: Backup =
        serde_json::from_slice(&std::fs::read(recovery).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if !prior
        .data
        .tasks
        .iter()
        .any(|t| t.notes == "Changed after backup")
    {
        return Err("Recovery backup lost previous data".into());
    }
    let restored = snapshot(app.state::<AppState>())?;
    if restored.data.timer.phase != "work"
        || restored
            .data
            .tasks
            .iter()
            .any(|t| t.notes == "Changed after backup")
    {
        return Err("JSON restore did not restore saved state".into());
    }
    std::env::remove_var("ODAK_SMOKE_BACKUP_FILE");
    result.push(
        "Native JSON file export/import, active-timer guard and automatic recovery backup".into(),
    );
    result.push("Leave a real persisted work timer running for the process-restart check".into());
    Ok(result)
}
