import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Leaf,
  List,
  Plus,
  Settings as SettingsIcon,
  BarChart3,
  Pencil,
  Star,
  LockKeyhole,
  Play,
  Pause,
  X,
  MoreHorizontal,
  RotateCcw,
  Volume2,
  Bell,
  Repeat,
  Trash2,
  ArrowRight,
  Sun,
  Download,
  Upload,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { action, call, load, subscribe } from "./api";
import DatabaseInspector from "./DatabaseInspector";
import {
  calendarPreview,
  dailyTrend,
  focusCandidates,
  recommendFocus,
  isSeries,
  taskKind,
  archivedOccurrence,
  todayAgenda,
  labelTotals,
  isPastTask,
  priorityFor,
  taskPomodoroMin,
  validatePomodoroMin,
  validatePlanningChange,
  cloneTask,
  newId,
  clock,
  dayKey,
  formatMinutes,
  formatElapsed,
  taskWorkSummary,
  localInput,
  newTask,
  parseDay,
  shiftDay,
  spent,
  stats,
  tasksForDay,
  timeString,
  validateTask,
  type Task,
  type Snapshot,
  type Settings,
  type LabelEntry,
  type Session,
} from "./domain";
type Confirmation = {
  title: string;
  message: string;
  action: () => Promise<boolean> | boolean;
  confirmLabel?: string;
  positive?: boolean;
};
type ConfirmRequest = (
  title: string,
  message: string,
  action: Confirmation["action"],
  options?: Pick<Confirmation, "confirmLabel" | "positive">,
) => void;
type Tab =
  | "today"
  | "list"
  | "calendar"
  | "completed"
  | "deadline"
  | "recurring"
  | "stats"
  | "settings"
  | "data";
const weekdays = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const fullDate = (date: string) =>
  parseDay(date).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

export default function App() {
  const quick = new URLSearchParams(location.search).has("quick");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [tab, setTab] = useState<Tab>("today"),
    [day, setDay] = useState(dayKey()),
    [month, setMonth] = useState(dayKey().slice(0, 7)),
    [filter, setFilter] = useState(""),
    [editor, setEditor] = useState<Task | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(0),
    [work, setWork] = useState(45),
    [rest, setRest] = useState(15),
    [busy, setBusy] = useState(false),
    [quickTitle, setQuickTitle] = useState("");
  const [focusTaskId, setFocusTaskId] = useState("");
  const [quickWork, setQuickWork] = useState<number | string>(45);
  const [quickLabel, setQuickLabel] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [prioritySort, setPrioritySort] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [statsDate, setStatsDate] = useState(dayKey());
  const [labelPeriod, setLabelPeriod] = useState<
    "day" | "today" | "week" | "fortnight"
  >("day");
  const requestDelete: ConfirmRequest = (
    title,
    message,
    action,
    options = {},
  ) => {
    setError("");
    setConfirmation({ title, message, action, ...options });
  };
  const quickRef = useRef<HTMLInputElement>(null);
  const apply = useCallback((s: Snapshot) => {
    setSnapshot(s);
    setRemaining(s.remainingMs);
  }, []);
  const reload = useCallback(async () => {
    try {
      apply(await load());
    } catch (e) {
      setError(String(e));
    }
  }, [apply]);
  const run = useCallback(
    async (name: string, payload: unknown = {}) => {
      setError("");
      setBusy(true);
      try {
        const s = await action(name, payload);
        apply(s);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );
  useEffect(() => {
    let active = true;
    const cleanups: (() => void)[] = [];
    reload();
    subscribe("data-changed", () => reload()).then((fn) =>
      active ? cleanups.push(fn) : fn(),
    );
    subscribe("timer-tick", (p: { remainingMs: number }) =>
      setRemaining(p.remainingMs),
    ).then((fn) => (active ? cleanups.push(fn) : fn()));
    subscribe("quick-open", () => {
      setQuickTitle("");
      setQuickLabel("");
      setTimeout(() => quickRef.current?.focus(), 50);
    }).then((fn) => (active ? cleanups.push(fn) : fn()));
    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
    };
  }, [reload]);
  const focusTasks = snapshot
    ? focusCandidates(
        snapshot.data.tasks,
        dayKey(),
        snapshot.data.suspendedWork,
      )
    : [];
  const lastWork = snapshot?.data.sessions
    .filter((session) => session.type === "work")
    .reduce<Session | undefined>(
      (latest, session) =>
        !latest || session.endedAt > latest.endedAt ? session : latest,
      undefined,
    );
  const suggestion = recommendFocus(
    focusTasks,
    snapshot?.priorities || {},
    dayKey(),
    lastWork && dayKey(new Date(lastWork.endedAt)) === dayKey()
      ? lastWork.taskId
      : null,
    snapshot?.data.suspendedWork,
  );
  const selectedFocusTask =
    focusTasks.find((task) => task.id === focusTaskId) || suggestion;
  useEffect(() => {
    if (lastWork)
      setFocusTaskId((selected) =>
        selected === lastWork.taskId ? "" : selected,
      );
  }, [lastWork?.id]);
  const chosenTask = selectedFocusTask;
  const chosenPending =
    selectedFocusTask && snapshot?.data.suspendedWork?.[selectedFocusTask.id];
  const chosenDuration =
    chosenTask && snapshot
      ? taskPomodoroMin(
          chosenTask,
          snapshot.taskDurations || {},
          snapshot.data.settings.defaultWorkMin,
        )
      : snapshot?.data.settings.defaultWorkMin;
  useEffect(() => {
    if (snapshot) {
      setWork(
        snapshot.data.timer.phase !== "idle"
          ? snapshot.data.timer.workMin
          : (chosenDuration ?? snapshot.data.settings.defaultWorkMin),
      );
      setRest(
        snapshot.data.timer.phase !== "idle" || snapshot.data.timer.breakReady
          ? snapshot.data.timer.breakMin
          : snapshot.data.settings.defaultBreakMin,
      );
    }
  }, [
    snapshot?.data.settings.defaultWorkMin,
    snapshot?.data.settings.defaultBreakMin,
    snapshot?.data.timer.phase,
    snapshot?.data.timer.breakReady,
    focusTaskId,
    chosenDuration,
  ]);
  useEffect(() => {
    if (snapshot) setQuickWork(snapshot.data.settings.defaultWorkMin);
  }, [snapshot?.data.settings.defaultWorkMin]);
  useEffect(() => {
    if (!quick && snapshot) {
      isPermissionGranted()
        .then((granted) => (granted ? null : requestPermission()))
        .catch(() => {});
    }
  }, [!!snapshot, quick]);
  useEffect(() => {
    if (
      !quick &&
      snapshot &&
      (tab === "today" || tab === "list" || tab === "calendar") &&
      !(tab === "calendar" && day < dayKey())
    )
      run("ensure_day", { date: tab === "calendar" ? day : dayKey() });
  }, [tab, day, !!snapshot, quick]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  const hideQuick = () =>
    getCurrentWindow()
      .hide()
      .catch(() => {});
  if (quick)
    return (
      <div className="quick-window">
        <div className="quick-heading">
          <Leaf size={18} />
          <strong>Hızlı görev ekle</strong>
          <button aria-label="Kapat" onClick={hideQuick}>
            <X size={16} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const t = newTask();
            t.title = quickTitle;
            t.kind = "list";
            t.label = quickLabel.trim();
            const validation =
              validatePomodoroMin(quickWork) || validateTask(t, true);
            if (validation) {
              setError(validation);
              return;
            }
            if (await run("save_task", { ...t, pomodoroMin: quickWork })) {
              setQuickTitle("");
              setQuickLabel("");
              setQuickWork(snapshot?.data.settings.defaultWorkMin || 45);
              await hideQuick();
            }
          }}
        >
          <div className="quick-task-fields">
            <input
              ref={quickRef}
              autoFocus
              placeholder="Aklındaki işi yaz…"
              aria-label="Görev başlığı"
              required
              maxLength={250}
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") hideQuick();
              }}
            />
            <div className="quick-options">
              <label className="quick-duration quick-label">
                Etiket · zorunlu
                <input
                  aria-label="Etiket"
                  list="quick-labels"
                  required
                  className="required-field"
                  placeholder="İş, okul, kişisel…"
                  value={quickLabel}
                  onChange={(e) => {
                    setQuickLabel(e.target.value);
                    setError("");
                  }}
                />
                <datalist id="quick-labels">
                  {snapshot?.labels?.map((label) => (
                    <option key={label.name} value={label.name} />
                  ))}
                </datalist>
              </label>
              <label className="quick-duration">
                Pomodoro · dk
                <input
                  aria-label="Pomodoro süresi"
                  type="number"
                  required
                  min="1"
                  max="90"
                  step="1"
                  className="required-field"
                  value={quickWork}
                  onChange={(e) =>
                    setQuickWork(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
              </label>
            </div>
          </div>
          <button className="primary" disabled={busy || !quickTitle.trim()}>
            <Plus size={17} />
            Ekle
          </button>
        </form>
        <small>
          Enter ile kaydet · Esc ile kapat · Tarihsiz listene eklenir
        </small>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (!snapshot)
    return (
      <div className="loading">
        <Leaf />
        <h2>Odak</h2>
        <p>{error || "Günün hazırlanıyor…"}</p>
        {error && <button onClick={reload}>Yeniden dene</button>}
      </div>
    );
  const { data } = snapshot,
    { timer } = data;
  const active = timer.phase !== "idle";
  const activeTask = data.tasks.find((t) => t.id === timer.taskId);
  const summary = stats(data.sessions);
  const labelStart =
    labelPeriod === "day"
      ? statsDate
      : labelPeriod === "week"
        ? summary.weekStart
        : labelPeriod === "fortnight"
          ? shiftDay(dayKey(), -13)
          : dayKey();
  const labelEnd = labelPeriod === "day" ? statsDate : dayKey();
  const distribution = labelTotals(data.sessions, labelStart, labelEnd);
  const distributionTotal = Object.values(distribution).reduce(
    (sum, minutes) => sum + minutes,
    0,
  );
  const catalog = snapshot.labels ?? [
    ...new Map(
      data.tasks
        .filter((t) => t.label)
        .map((t) => [t.label, { name: t.label, color: t.color }]),
    ).values(),
  ];
  const labels = catalog.map((l) => l.name).sort();
  const filterLabels = [
    ...new Set(data.tasks.map((t) => t.label).filter(Boolean)),
  ].sort();
  const priorities = snapshot.priorities || {};
  const taskDurations = snapshot.taskDurations || {};
  const calendarReadOnly = tab === "calendar" && day < dayKey();
  const resting = timer.phase === "break" || timer.pausedPhase === "break";
  const working = active && !resting;
  const timerTask = working
    ? activeTask
    : resting
      ? undefined
      : selectedFocusTask;
  const pickerTasks =
    working && activeTask
      ? [
          activeTask,
          ...focusTasks.filter(
            (task) =>
              task.id !== activeTask.id &&
              !(activeTask.seriesId && task.seriesId === activeTask.seriesId),
          ),
        ]
      : focusTasks;
  const checklistTask = working ? activeTask : selectedFocusTask;
  const detailTask = data.tasks.find((task) => task.id === detailTaskId);
  let tasks =
    tab === "today"
      ? todayAgenda(data.tasks, dayKey(), data.suspendedWork)
      : tab === "list"
        ? data.tasks.filter(
            (t) =>
              ((!t.scheduledDate && taskKind(t) === "list") ||
                !!data.suspendedWork?.[t.id]) &&
              !isSeries(t) &&
              t.status === "active" &&
              !archivedOccurrence(t, data.tasks),
          )
        : tab === "completed"
          ? data.tasks
              .filter(
                (t) =>
                  t.status === "completed" &&
                  !(
                    archivedOccurrence(t, data.tasks) &&
                    data.tasks.some(
                      (parent) =>
                        parent.id === t.seriesId &&
                        parent.status === "completed",
                    )
                  ),
              )
              .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
          : tab === "deadline"
            ? data.tasks.filter(
                (t) =>
                  taskKind(t) === "deadline" &&
                  t.status === "active" &&
                  !archivedOccurrence(t, data.tasks),
              )
            : tab === "recurring"
              ? []
              : tasksForDay(data.tasks, day);
  if (filter) tasks = tasks.filter((t) => t.label === filter);
  if (prioritySort && (tab === "today" || tab === "list"))
    tasks = [...tasks].sort(
      (a, b) => priorityFor(b, priorities) - priorityFor(a, priorities),
    );
  const add = () => {
    if (calendarReadOnly) return;
    setEditor({
      ...newTask(tab === "calendar" ? day : tab === "today" ? dayKey() : null),
      ...(tab === "deadline"
        ? { kind: "deadline" as const }
        : tab === "recurring"
          ? {
              kind: "recurring" as const,
              scheduledDate: dayKey(),
              recurrenceRule: {
                frequency: "weekly" as const,
                weekdays: [parseDay(dayKey()).getDay()],
                monthDay: parseDay(dayKey()).getDate(),
              },
            }
          : {}),
    });
  };
  const move = (task: Task, date: string | null) => {
    if (date && date < dayKey()) {
      setError("Geçmiş bir güne görev taşınamaz.");
      return;
    }
    return run("save_task", {
      ...task,
      scheduledDate: date,
      startAt: null,
      endAt: null,
    });
  };
  const start = (taskId: string, usePanel = false) => {
    const task =
      data.tasks.find((t) => t.id === taskId) ||
      focusTasks.find((t) => t.id === taskId);
    const minutes =
      usePanel || !task
        ? work
        : taskPomodoroMin(task, taskDurations, data.settings.defaultWorkMin);
    if (
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 90 ||
      !Number.isInteger(rest) ||
      rest < 1 ||
      rest > 30
    ) {
      setError("Çalışma 1–90, mola 1–30 dakika olmalı.");
      return;
    }
    if (active) {
      if (working && timer.taskId === taskId) return;
      requestDelete(
        "Başka göreve geçmek istiyor musun?",
        working
          ? `“${activeTask?.title || "Önceki iş"}” için ${formatElapsed(((timer.workBudgetMs ?? timer.plannedMin * 60000) - remaining) / 60000)} çalışıldı. ${clock(remaining)} kaldı. Onay anına kadar çalışılan süre grafiğe kaydedilir; kalan süre saklanır ve “${task?.title || "Yeni iş"}” başlar.`
          : `Mola kapanır ve “${task?.title || "Yeni iş"}” başlar. Önceki çalışma süresi korunur; görev kendiliğinden tamamlanmaz.`,
        async () => {
          const switched = await run("switch_task", {
            confirmed: true,
            fromTaskId: timer.taskId,
            startedAt: timer.startedAt,
            taskId,
            workMin: minutes,
            breakMin: rest,
          });
          if (switched) {
            setFocusTaskId(taskId);
            if (tab !== "today" && tab !== "list") setTab("today");
          }
          return switched;
        },
        { confirmLabel: "Tamam, göreve geç", positive: true },
      );
      return;
    }
    setFocusTaskId(taskId);
    return run("start", { taskId, workMin: minutes, breakMin: rest }).then(
      (started) => {
        if (started && tab !== "today" && tab !== "list") setTab("today");
        return started;
      },
    );
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">Odak</span>
        </div>
        <div className="header-right">
          <span className="local-tag">
            <i />
            Tamamen yerel
          </span>
          <button
            aria-label="İstatistik"
            className={tab === "stats" ? "selected" : ""}
            onClick={() => setTab("stats")}
          >
            <BarChart3 size={18} />
          </button>
          <button
            aria-label="Ayarlar"
            className={tab === "settings" ? "selected" : ""}
            onClick={() => setTab("settings")}
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>
      <nav className="tabs" aria-label="Ana menü">
        {(
          [
            ["today", "Bugün", Sun],
            ["list", "Liste", List],
            ["calendar", "Takvim", CalendarDays],
            ["deadline", "Son tarihli", Bell],
            ["recurring", "Tekrarlayan", Repeat],
            ["completed", "Tamamlanan", Check],
          ] as const
        ).map(([id, name, Icon]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {name}
            {id === "list" &&
              data.tasks.filter(
                (t) => !t.scheduledDate && t.status === "active",
              ).length > 0 && (
                <span className="tab-count">
                  {
                    data.tasks.filter(
                      (t) => !t.scheduledDate && t.status === "active",
                    ).length
                  }
                </span>
              )}
          </button>
        ))}
      </nav>
      <main>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button aria-label="Uyarıyı kapat" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {snapshot.serviceError && (
          <div className="alert">{snapshot.serviceError}</div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {tab !== "settings" && tab !== "stats" && tab !== "data" && (
          <>
            {(tab === "today" || tab === "list") && (
              <section
                className={`timer-card ${timer.phase === "break" || timer.pausedPhase === "break" ? "resting" : ""}`}
              >
                <div className="timer-top">
                  {timerTask ? (
                    <TimerTitle
                      task={timerTask}
                      busy={busy}
                      onRename={(title) =>
                        run("rename_task", { id: timerTask.id, title })
                      }
                    />
                  ) : (
                    <span className="timer-title">
                      {resting ? "Mola zamanı" : "Bir görev seç"}
                    </span>
                  )}
                  <span className="eyebrow timer-phase">
                    <span className="pulse-dot" />
                    {timer.phase === "paused"
                      ? "DURAKLATILDI"
                      : timer.phase === "break"
                        ? "MOLA ZAMANI"
                        : timer.breakReady
                          ? "MOLA BİTTİ"
                          : active
                            ? "ÇALIŞIYOR"
                            : "HAZIR"}
                  </span>
                </div>
                <div className="timer-body">
                  <div>
                    <div className="timer-number" aria-live="off">
                      {active
                        ? clock(remaining)
                        : timer.breakReady && !selectedFocusTask
                          ? "00:00"
                          : clock(chosenPending?.remainingMs ?? work * 60000)}
                    </div>
                  </div>
                  <div className="timer-controls">
                    {active ? (
                      <>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            run(timer.phase === "paused" ? "resume" : "pause")
                          }
                        >
                          {timer.phase === "paused" ? (
                            <Play size={16} />
                          ) : (
                            <Pause size={16} />
                          )}{" "}
                          {timer.phase === "paused" ? "Devam et" : "Duraklat"}
                        </button>
                        <div className="timer-secondary-actions">
                          {!resting && (
                            <button
                              className="cancel-btn"
                              disabled={busy}
                              onClick={() =>
                                requestDelete(
                                  "Bu oturumu iptal etmek istiyor musun?",
                                  "Şu anki oturum silinecek ve bu oturum için süre yazılmayacak. Önceden biten oturumlar korunur.",
                                  () => run("cancel", { confirmed: true }),
                                )
                              }
                            >
                              <X size={15} />
                              İptal et
                            </button>
                          )}
                          {activeTask && (
                            <button
                              className="finish-btn"
                              disabled={busy}
                              onClick={() =>
                                requestDelete(
                                  "Görevi bitirmek istiyor musun?",
                                  timer.phase === "break" ||
                                    timer.pausedPhase === "break"
                                    ? `“${activeTask.title}” tamamlananlara taşınır ve mola kapanır. Kaydedilmiş çalışma süresi korunur; mola odak süresine eklenmez.`
                                    : `“${activeTask.title}” tamamlananlara taşınır. Duraklamalar hariç gerçekten çalıştığın süre kaydedilir ve istatistiklere eklenir; sayaç kapanır.`,
                                  async () => {
                                    const finished = await run("finish", {
                                      taskId: timer.taskId,
                                      startedAt: timer.startedAt,
                                      confirmed: true,
                                    });
                                    if (finished)
                                      setFocusTaskId((selected) =>
                                        selected === timer.taskId
                                          ? ""
                                          : selected,
                                      );
                                    return finished;
                                  },
                                  {
                                    confirmLabel: "Evet, bitir",
                                    positive: true,
                                  },
                                )
                              }
                            >
                              <Check size={15} />
                              Bitir
                            </button>
                          )}
                        </div>
                      </>
                    ) : timer.breakReady ? (
                      <>
                        <button
                          className="primary"
                          disabled={busy || !selectedFocusTask}
                          onClick={() => {
                            if (selectedFocusTask)
                              start(selectedFocusTask.id, true);
                          }}
                        >
                          <Play size={16} />
                          Devam et
                        </button>
                        <button onClick={() => run("extend_break")}>
                          5 dk daha
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy || !selectedFocusTask}
                        onClick={() =>
                          selectedFocusTask && start(selectedFocusTask.id, true)
                        }
                      >
                        <Play size={16} />
                        Odaklanmaya başla
                      </button>
                    )}
                  </div>
                </div>
                <div className="focus-picker">
                  <select
                    aria-label="Odaklanılacak görev"
                    disabled={working || busy}
                    value={
                      (working ? activeTask?.id : selectedFocusTask?.id) || ""
                    }
                    onChange={(e) => setFocusTaskId(e.target.value)}
                  >
                    <option value="">Hangi işe odaklanacaksın?</option>
                    {pickerTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.label ? ` · ${t.label}` : ""}
                        {t.scheduledDate
                          ? ` · ${t.scheduledDate === dayKey() ? "Bugün" : parseDay(t.scheduledDate).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {checklistTask && checklistTask.subtasks.length > 0 && (
                  <FocusChecklist
                    task={checklistTask}
                    upcoming={resting}
                    disabled={
                      busy ||
                      checklistTask.status === "completed" ||
                      !data.tasks.some((task) => task.id === checklistTask.id)
                    }
                    preview={
                      !data.tasks.some((task) => task.id === checklistTask.id)
                    }
                    onChange={(id, done) =>
                      run("set_subtask", {
                        taskId: checklistTask.id,
                        subtaskId: id,
                        done,
                      })
                    }
                  />
                )}
                {!working && suggestion && (
                  <div
                    className="focus-suggestion"
                    aria-label="Sıradaki odak önerisi"
                  >
                    <Star size={14} />
                    <span>
                      Sıradaki odak:{" "}
                      <button
                        aria-label={`Önerilen görevi seç: ${suggestion.title}`}
                        onClick={() => setFocusTaskId(suggestion.id)}
                      >
                        {suggestion.title}
                      </button>
                    </span>
                    <span className="suggestion-priority">
                      {priorityFor(suggestion, priorities)
                        ? `${priorityFor(suggestion, priorities)} yıldız`
                        : "Öncelik verilmedi"}
                    </span>
                    <span>
                      {tasksForDay([suggestion], dayKey()).length
                        ? "Bugün"
                        : "Liste"}
                    </span>
                  </div>
                )}
                <div className="timer-footer">
                  <div className="duration-fields">
                    <label>
                      Çalışma{" "}
                      <input
                        aria-label="Çalışma süresi"
                        type="number"
                        min="1"
                        max="90"
                        value={work}
                        disabled={active || !!chosenPending}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setWork(n);
                          if (n < 1 || n > 90)
                            setError("Çalışma 1–90 dakika olmalı.");
                        }}
                      />{" "}
                      dk
                    </label>
                    <span className="duration-divider" />
                    <label>
                      Mola{" "}
                      <input
                        aria-label="Mola süresi"
                        type="number"
                        min="1"
                        max="30"
                        value={rest}
                        disabled={active}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setRest(n);
                          if (n < 1 || n > 30)
                            setError("Mola 1–30 dakika olmalı.");
                        }}
                      />{" "}
                      dk
                    </label>
                  </div>
                  <span>
                    <Clock size={13} />
                    {activeTask
                      ? `Toplam ${formatMinutes(spent(activeTask.id, data.sessions))}`
                      : `Bugün ${formatMinutes(summary.daily)}`}
                  </span>
                </div>
                {active && (
                  <div
                    className="timer-progress"
                    style={{
                      width: `${100 - Math.min(100, remaining / (timer.plannedMin * 600))}%`,
                    }}
                  />
                )}
              </section>
            )}
            <section className="task-section">
              <div className="section-title">
                <div>
                  <div className="eyebrow muted">
                    {tab === "today"
                      ? fullDate(dayKey()).toLocaleUpperCase("tr-TR")
                      : tab === "calendar"
                        ? "KENDİ RİTMİNDE PLANLA"
                        : tab === "completed"
                          ? "BİTİRDİKLERİN BİRİKİYOR"
                          : tab === "deadline"
                            ? "BİTİNCE YENİDEN GELMEZ"
                            : tab === "recurring"
                              ? "HER TEKRAR AYRI BİR İŞ"
                              : "AKLINDA KALMASIN"}
                  </div>
                  <h1>
                    {tab === "today"
                      ? "Bugünün gündemi"
                      : tab === "list"
                        ? "Görev listesi"
                        : tab === "completed"
                          ? "Tamamlanan görevler"
                          : tab === "deadline"
                            ? "Son tarihli işler"
                            : tab === "recurring"
                              ? "Tekrarlayan işler"
                              : "Takvim"}
                  </h1>
                </div>
                {!calendarReadOnly && (
                  <button className="add-button" onClick={add}>
                    <Plus size={16} />
                    Yeni görev
                  </button>
                )}
              </div>
              {tab === "calendar" && (
                <div className="calendar">
                  <div className="month-heading">
                    <button
                      aria-label="Önceki ay"
                      onClick={() => {
                        const d = parseDay(`${month}-01`);
                        d.setMonth(d.getMonth() - 1);
                        setMonth(dayKey(d).slice(0, 7));
                      }}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <strong>
                      {parseDay(`${month}-01`).toLocaleDateString("tr-TR", {
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    <button
                      aria-label="Sonraki ay"
                      onClick={() => {
                        const d = parseDay(`${month}-01`);
                        d.setMonth(d.getMonth() + 1);
                        setMonth(dayKey(d).slice(0, 7));
                      }}
                    >
                      <ChevronRight size={18} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setMonth(dayKey().slice(0, 7));
                        setDay(dayKey());
                      }}
                    >
                      Bugün
                    </button>
                  </div>
                  <div className="calendar-grid">
                    {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map(
                      (d) => (
                        <small key={d}>{d}</small>
                      ),
                    )}
                    {Array.from(
                      {
                        length:
                          ((parseDay(`${month}-01`).getDay() + 6) % 7) +
                          new Date(
                            Number(month.slice(0, 4)),
                            Number(month.slice(5)),
                            0,
                          ).getDate(),
                      },
                      (_, i) => {
                        const n =
                          i - ((parseDay(`${month}-01`).getDay() + 6) % 7) + 1;
                        if (n < 1) return <span key={i} />;
                        const date = `${month}-${String(n).padStart(2, "0")}`,
                          items = (
                            date < dayKey()
                              ? tasksForDay(data.tasks, date)
                              : calendarPreview(data.tasks, date)
                          ).filter((t) => !filter || t.label === filter);
                        return (
                          <button
                            key={date}
                            aria-label={date}
                            className={`${day === date ? "chosen" : ""} ${date === dayKey() ? "is-today" : ""}`}
                            onClick={() => setDay(date)}
                          >
                            {n}
                            <span className="day-dots">
                              {items.slice(0, 3).map((t) => (
                                <i key={t.id} style={{ background: t.color }} />
                              ))}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                  <div className="day-heading">
                    <strong>{fullDate(day)}</strong>
                    {!calendarReadOnly && (
                      <button
                        className="text-button"
                        onClick={() => setEditor(newTask(day))}
                      >
                        <Plus size={14} />
                        Bu güne görev ekle
                      </button>
                    )}
                    {calendarReadOnly && (
                      <span className="read-only-badge">
                        <LockKeyhole size={12} />
                        Geçmiş · salt okunur
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="list-toolbar">
                <span>
                  {tab === "recurring"
                    ? data.tasks.filter(isSeries).length
                    : tasks.length}{" "}
                  {tab === "recurring" ? "seri" : "görev"}
                  {tab === "calendar" ? " · tamamlananlar dahil" : ""}
                </span>
                <div className="list-filters">
                  {(tab === "today" || tab === "list") && (
                    <select
                      aria-label="Görev sıralaması"
                      value={prioritySort ? "priority" : "original"}
                      onChange={(e) =>
                        setPrioritySort(e.target.value === "priority")
                      }
                    >
                      <option value="original">Plan sırası</option>
                      <option value="priority">
                        Öncelik · yüksekten düşüğe
                      </option>
                    </select>
                  )}
                  <select
                    aria-label="Etiket filtresi"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">Tüm etiketler</option>
                    {filterLabels.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="task-list">
                {tasks.map((task) =>
                  task.status === "completed" ? (
                    <CompletedTaskCard
                      key={task.id}
                      task={task}
                      sessions={data.sessions}
                      allTasks={data.tasks}
                      priority={priorityFor(task, priorities)}
                      pomodoroMin={taskPomodoroMin(
                        task,
                        taskDurations,
                        data.settings.defaultWorkMin,
                      )}
                      busy={busy}
                      onDetail={() => setDetailTaskId(task.id)}
                      onRestore={
                        calendarReadOnly
                          ? undefined
                          : () => run("toggle_task", { id: task.id })
                      }
                    />
                  ) : (
                    <TaskRow
                      key={task.id}
                      task={task}
                      sessions={data.sessions}
                      allTasks={data.tasks}
                      readOnly={calendarReadOnly}
                      priority={priorityFor(task, priorities)}
                      onPriority={(rating) =>
                        run("set_priority", { id: task.id, rating })
                      }
                      canStart={
                        (!isPastTask(task) ||
                          !!data.suspendedWork?.[task.id]) &&
                        !(working && timer.taskId === task.id)
                      }
                      busy={busy}
                      selected={
                        selectedFocusTask?.id === task.id ||
                        (working && activeTask?.id === task.id)
                      }
                      onSelect={
                        tab === "today" || tab === "list" || tab === "deadline"
                          ? () => {
                              if (working) {
                                setNotice(
                                  "Görev değiştirmek için yeni işin ▶ düğmesine bas. Onayından sonra çalışılan süre kaydedilir ve kalan süre saklanır.",
                                );
                                return;
                              }
                              if (
                                isPastTask(task) &&
                                !data.suspendedWork?.[task.id]
                              ) {
                                setNotice(
                                  "Geçmiş günün görevi seçilemez. Önce bugüne veya ileri bir güne taşı.",
                                );
                                return;
                              }
                              setFocusTaskId(task.id);
                              if (tab === "deadline") setTab("today");
                              document
                                .querySelector(".timer-card")
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                            }
                          : undefined
                      }
                      onToggle={() =>
                        data.suspendedWork?.[task.id]
                          ? requestDelete(
                              "Bekleyen oturum kapatılıp görev tamamlansın mı?",
                              "Kalan oturum kapatılır; daha önce kaydedilmiş çalışma süresi korunur. Görevi geri açarsan yeni oturum normal süreden başlar.",
                              () =>
                                run("toggle_task", {
                                  id: task.id,
                                  confirmed: true,
                                }),
                              { positive: true, confirmLabel: "Evet, tamamla" },
                            )
                          : run("toggle_task", { id: task.id })
                      }
                      onEdit={() =>
                        setEditor(
                          cloneTask(
                            data.tasks.find(
                              (parent) =>
                                parent.id === task.seriesId && isSeries(parent),
                            ) || task,
                          ),
                        )
                      }
                      pendingMs={
                        working && timer.taskId === task.id
                          ? remaining
                          : data.suspendedWork?.[task.id]?.remainingMs
                      }
                      onStart={() => start(task.id)}
                      onMove={(date) => move(task, date)}
                      onSubtask={(id, done) =>
                        run("set_subtask", {
                          taskId: task.id,
                          subtaskId: id,
                          done,
                        })
                      }
                    />
                  ),
                )}
                {!tasks.length && tab !== "recurring" && (
                  <div className="empty-state">
                    <span>
                      <Leaf size={25} />
                    </span>
                    <h3>
                      {tab === "completed"
                        ? "İlk tamamladığın görev burada olacak"
                        : tab === "calendar"
                          ? "Bu gün sana açık"
                          : "Biraz yer aç, bir işe odaklan."}
                    </h3>
                    <p>
                      {tab === "completed"
                        ? "Görevi bitirdiğinde solundaki yuvarlağa bas."
                        : calendarReadOnly
                          ? "Bu günün kayıtları burada görünür; geçmişe yeni görev eklenmez."
                          : "Bir görev ekle; ne zaman yapacağına sen karar ver."}
                    </p>
                    {tab !== "completed" && !calendarReadOnly && (
                      <button className="text-button" onClick={add}>
                        <Plus size={15} />
                        İlk görevi ekle
                      </button>
                    )}
                  </div>
                )}
              </div>
              {tab === "completed" && (
                <SessionHistory
                  sessions={data.sessions}
                  tasks={data.tasks}
                  filter={filter}
                />
              )}
              {tab === "recurring" && (
                <div className="series-list">
                  <h3>
                    <Repeat size={15} />
                    Tekrarlayan görevler
                  </h3>
                  {data.tasks
                    .filter(
                      (t) => isSeries(t) && (!filter || t.label === filter),
                    )
                    .map((t) => (
                      <article className="series-row" key={t.id}>
                        <div>
                          <button
                            className="task-title"
                            onClick={() => setEditor(cloneTask(t))}
                          >
                            {t.title}
                          </button>
                          <div className="task-meta">
                            {t.label && (
                              <span
                                className="label-tag"
                                style={{ color: t.color }}
                              >
                                <i style={{ background: t.color }} />
                                {t.label}
                              </span>
                            )}
                            <span>
                              {t.recurrenceRule?.frequency === "daily"
                                ? "Her gün"
                                : t.recurrenceRule?.frequency === "weekly"
                                  ? "Her hafta"
                                  : "Her ay"}{" "}
                              · Düzenle
                            </span>
                            {!t.kind && t.dueAt && (
                              <span className="legacy-kind-badge">
                                Eski karma görev · türünü seç
                              </span>
                            )}
                          </div>
                        </div>
                        <PriorityStars
                          title={t.title}
                          value={priorityFor(t, priorities)}
                          disabled={busy}
                          onChange={(rating) =>
                            run("set_priority", { id: t.id, rating })
                          }
                        />
                      </article>
                    ))}
                </div>
              )}
            </section>
          </>
        )}
        {tab === "stats" && (
          <section className="stats-section">
            <div className="eyebrow muted">ZAMANININ İZİ</div>
            <h1>Odak istatistikleri</h1>
            <p className="muted">
              Kaydedilen gerçek çalışma süreleri sayılır; molalar dahil
              değildir.
            </p>
            <div className="stat-cards">
              <div>
                <small>Bugün</small>
                <strong>{formatMinutes(summary.daily)}</strong>
              </div>
              <div>
                <small>Bu hafta</small>
                <strong>{formatMinutes(summary.weekly)}</strong>
              </div>
              <div>
                <small>Toplam oturum</small>
                <strong>{summary.sessionCount}</strong>
              </div>
            </div>
            <h3>Bu haftanın ritmi</h3>
            <div className="week-chart">
              {Array.from({ length: 7 }, (_, i) => {
                const d = shiftDay(summary.weekStart, i),
                  min = summary.days[d] || 0;
                return (
                  <div key={d}>
                    <small>{formatMinutes(min)}</small>
                    <div className="bar-track">
                      <span
                        style={{
                          height: `${Math.max(2, (min / Math.max(60, ...Object.values(summary.days))) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>{weekdays[parseDay(d).getDay()]}</span>
                  </div>
                );
              })}
            </div>
            <FocusTrend
              sessions={data.sessions}
              selectedDate={statsDate}
              onSelect={(date) => {
                setStatsDate(date);
                setLabelPeriod("day");
              }}
            />
            <div className="label-distribution-heading">
              <h3>
                Etikete göre ·{" "}
                {labelPeriod === "day"
                  ? fullDate(statsDate)
                  : labelPeriod === "today"
                    ? "Bugün"
                    : labelPeriod === "week"
                      ? "Bu hafta"
                      : "Son 2 hafta"}
              </h3>
              <select
                aria-label="Etiket dağılımı dönemi"
                value={labelPeriod}
                onChange={(event) =>
                  setLabelPeriod(event.target.value as typeof labelPeriod)
                }
              >
                <option value="day">Seçilen gün</option>
                <option value="today">Bugün</option>
                <option value="week">Bu hafta</option>
                <option value="fortnight">Son 2 hafta</option>
              </select>
            </div>
            {Object.entries(distribution)
              .sort((a, b) => b[1] - a[1])
              .map(([label, min]) => (
                <div className="label-stat" key={label}>
                  <span>{label}</span>
                  <div>
                    <i
                      style={{
                        width: `${distributionTotal > 0 ? (min / distributionTotal) * 100 : 0}%`,
                        background:
                          data.tasks.find((t) => t.label === label)?.color ||
                          "#438470",
                      }}
                    />
                  </div>
                  <strong>{formatMinutes(min)}</strong>
                </div>
              ))}
            {!distributionTotal && (
              <p className="muted">
                İlk odak oturumundan sonra dağılım burada görünecek.
              </p>
            )}
          </section>
        )}
        {tab === "settings" && (
          <SettingsPanel
            settings={data.settings}
            databasePath={snapshot.databasePath}
            active={active}
            labels={catalog}
            onLabelSave={(name, color) => run("save_label", { name, color })}
            onLabelDelete={(name) =>
              requestDelete(
                "Etiketi silmek istiyor musun?",
                `“${name}” seçim listesinden kaldırılacak. Mevcut görevlerin etiketleri korunur.`,
                () => run("delete_label", { name, confirmed: true }),
              )
            }
            onSave={(s) => run("settings", s)}
            onSound={(phase) => run("test_sound", { phase })}
            onBackup={async (kind) => {
              const backup = async () => {
                try {
                  const result = await call<string | null>(
                    kind === "export" ? "export_backup" : "import_backup",
                    kind === "import" ? { confirmed: true } : undefined,
                  );
                  if (result) {
                    await reload();
                    setNotice(
                      kind === "export"
                        ? `Yedek kaydedildi: ${result}`
                        : `Yedek yüklendi. Önceki verilerin kurtarma kopyası: ${result}`,
                    );
                  }
                  return true;
                } catch (e) {
                  setError(String(e));
                  return false;
                }
              };
              if (kind === "import")
                requestDelete(
                  "Yedek mevcut verilerin yerini alsın mı?",
                  "Seçeceğin yedek mevcut görevlerin ve oturumların yerini alır. Önce kurtarma kopyası oluşturulur.",
                  backup,
                );
              else await backup();
            }}
          />
        )}
        {tab === "settings" && (
          <button className="database-open" onClick={() => setTab("data")}>
            <List size={16} />
            Veritabanını incele · salt okunur
          </button>
        )}
        {tab === "data" && (
          <DatabaseInspector onBack={() => setTab("settings")} />
        )}
      </main>
      <footer className="app-footer">
        <span>
          <Leaf size={12} />
          Bir seferde bir iş.
        </span>
        {!calendarReadOnly && tab !== "data" && (
          <button
            onClick={() => setEditor(newTask(tab === "calendar" ? day : null))}
          >
            <Plus size={13} />
            Hızlı ekle{" "}
            <kbd>
              {data.settings.quickAddShortcut
                .replace("CmdOrCtrl", "⌘")
                .replace("Shift", "⇧")
                .replaceAll("+", "")}
            </kbd>
          </button>
        )}
      </footer>
      {editor && (
        <TaskEditor
          initial={editor}
          labels={labels}
          catalog={catalog}
          defaultDay={tab === "calendar" ? day : dayKey()}
          priority={priorityFor(editor, priorities)}
          pomodoroMin={taskPomodoroMin(
            editor,
            taskDurations,
            data.settings.defaultWorkMin,
          )}
          confirmDelete={requestDelete}
          onClose={() => setEditor(null)}
          onSave={async (t, rating, minutes) => {
            const save = async () => {
              const isNew = !data.tasks.some((task) => task.id === t.id);
              const previousMinutes = taskPomodoroMin(
                editor,
                taskDurations,
                data.settings.defaultWorkMin,
              );
              if (
                !(await run("save_task", {
                  ...t,
                  ...(isNew || minutes !== previousMinutes
                    ? { pomodoroMin: minutes }
                    : {}),
                  confirmedSeriesChange:
                    isSeries(editor) ||
                    (t.status === "completed" && !!data.suspendedWork?.[t.id]),
                }))
              )
                return false;
              if (
                rating > 0 &&
                rating !== priorityFor(editor, priorities) &&
                !(await run("set_priority", { id: t.id, rating }))
              )
                return false;
              setEditor(null);
              setFocusTaskId(t.id);
              return true;
            };
            if (
              isSeries(editor) ||
              (t.status === "completed" && !!data.suspendedWork?.[t.id])
            )
              requestDelete(
                t.kind === "deadline"
                  ? "Son tarihli tek işe çevirmek istiyor musun?"
                  : isSeries(editor)
                    ? "Tekrar serisi güncellensin mi?"
                    : "Bekleyen oturum kapatılıp görev tamamlanacak mı?",
                t.kind === "deadline"
                  ? "Eski günlerin kayıtları silinmez. Yeni tekrar üretilmez; iş tamamlanınca sonraki günlerde görünmez."
                  : isSeries(editor)
                    ? "Gelecekteki başlanmamış örnekler silinip güncel kuralla yeniden oluşturulabilir. Tamamlanan ve başlanmış geçmiş korunur. Serinin yıldızı bütün günlere uygulanır."
                    : "Bekleyen kalan süre kapanır; kaydedilmiş çalışma süresi korunur ve görev tamamlananlara taşınır.",
                save,
              );
            else await save();
          }}
          onDelete={
            data.tasks.some((t) => t.id === editor.id)
              ? () =>
                  requestDelete(
                    editor.recurrenceRule
                      ? "Tekrar serisini silmek istiyor musun?"
                      : "Görevi silmek istiyor musun?",
                    editor.recurrenceRule
                      ? `“${editor.title}” serisi ve gelecekteki başlanmamış örnekleri silinir. Tamamlanan ve başlanmış geçmiş korunur.`
                      : `“${editor.title}” silinecek. Kaydedilmiş odak oturumları korunur.`,
                    async () => {
                      if (
                        await run("delete_task", {
                          id: editor.id,
                          confirmed: true,
                        })
                      ) {
                        setEditor(null);
                        return true;
                      }
                      return false;
                    },
                  )
              : undefined
          }
          error={error}
          busy={busy}
        />
      )}
      {detailTask && (
        <CompletedTaskDetails
          task={detailTask}
          sessions={data.sessions}
          allTasks={data.tasks}
          priority={priorityFor(detailTask, priorities)}
          pomodoroMin={taskPomodoroMin(
            detailTask,
            taskDurations,
            data.settings.defaultWorkMin,
          )}
          onClose={() => setDetailTaskId(null)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          positive={confirmation.positive}
          error={error}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            if (await confirmation.action()) setConfirmation(null);
          }}
        />
      )}
    </div>
  );
}

function FocusChecklist({
  task,
  upcoming,
  disabled,
  preview,
  onChange,
}: {
  task: Task;
  upcoming: boolean;
  disabled: boolean;
  preview: boolean;
  onChange: (id: string, done: boolean) => void;
}) {
  const done = task.subtasks.filter((subtask) => subtask.done).length;
  return (
    <details className="focus-checklist" open={task.subtasks.length <= 4}>
      <summary>
        <Check size={13} />
        <span>
          {upcoming ? "Sıradaki görevin alt görevleri" : "Alt görevler"}
        </span>
        <span className="checklist-count">
          {done}/{task.subtasks.length}
        </span>
        <ChevronRight size={13} />
      </summary>
      <div className="focus-checklist-items">
        {task.subtasks.map((subtask) => (
          <label key={subtask.id} className={subtask.done ? "done" : ""}>
            <input
              aria-label={`Pomodoro: ${subtask.title}`}
              type="checkbox"
              checked={subtask.done}
              disabled={disabled}
              onChange={(event) => onChange(subtask.id, event.target.checked)}
            />
            <span>{subtask.title}</span>
          </label>
        ))}
      </div>
      {preview && <small>İşaretlemek için bu görevin oturumunu başlat.</small>}
      {done === task.subtasks.length && !preview && (
        <small>
          Alt görevler hazır. İş bittiyse ana görevi de tamamlayabilirsin.
        </small>
      )}
    </details>
  );
}

function CompletedTaskCard({
  task,
  sessions,
  allTasks,
  priority,
  pomodoroMin,
  busy,
  onDetail,
  onRestore,
}: {
  task: Task;
  sessions: Session[];
  allTasks: Task[];
  priority: number;
  pomodoroMin: number;
  busy: boolean;
  onDetail: () => void;
  onRestore?: () => void;
}) {
  const { work, totalMin, last } = taskWorkSummary(task.id, sessions, allTasks);
  return (
    <article
      className="task-row completed completed-card"
      aria-label={`${task.title}: tamamlanan görev`}
      tabIndex={0}
      onClick={(event) => {
        if (!(event.target as Element).closest("button")) onDetail();
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onDetail();
        }
      }}
    >
      <div className="task-main">
        {onRestore ? (
          <button
            className="task-circle"
            aria-label={`${task.title}: geri al`}
            title="Tamamlamayı geri al"
            disabled={busy}
            onClick={onRestore}
          >
            <Check size={13} />
          </button>
        ) : (
          <span className="task-circle" aria-label="Tamamlandı">
            <Check size={13} />
          </span>
        )}
        <div className="task-content">
          <button
            className="task-title"
            aria-label={`${task.title}: tamamlanan detayları`}
            onClick={onDetail}
          >
            {task.title}
          </button>
          <div className="task-meta">
            {task.label && (
              <span className="label-tag" style={{ color: task.color }}>
                <i style={{ background: task.color }} />
                {task.label}
              </span>
            )}
            <PriorityStars
              title={task.title}
              value={priority}
              readOnly
              disabled
              onChange={() => {}}
            />
            {task.completedAt !== null && (
              <span>
                {new Date(task.completedAt).toLocaleString("tr-TR", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
        <button
          className="completed-detail-button"
          aria-label={`${task.title}: detayları göster`}
          onClick={onDetail}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="completed-summary">
        <span>
          <small>Toplam odak</small>
          <strong>{formatElapsed(totalMin)}</strong>
        </span>
        <span>
          <small>Pomodoro</small>
          <strong>{formatMinutes(last?.plannedMin ?? pomodoroMin)}</strong>
        </span>
        {task.estimateMin && (
          <span>
            <small>İş tahmini</small>
            <strong>~{formatMinutes(task.estimateMin)}</strong>
          </span>
        )}
        <span>
          <small>Oturum</small>
          <strong>{work.length}</strong>
        </span>
      </div>
      <div className="completion-note">
        {last ? (
          <>
            Son oturum: {formatElapsed(last.actualMin)} /{" "}
            {formatMinutes(last.plannedMin)}
            {last.outcome === "switched"
              ? " · Görev değiştirildi"
              : last.outcome === "elapsed"
                ? " · Süresi doldu"
                : last.actualMin < last.plannedMin
                  ? " · Erken bitirildi"
                  : " · Süresi doldu"}
          </>
        ) : (
          "Odak kaydı yok · Tamamlama süre eklemez"
        )}
      </div>
    </article>
  );
}

function CompletedTaskDetails({
  task,
  sessions,
  allTasks,
  priority,
  pomodoroMin,
  onClose,
}: {
  task: Task;
  sessions: Session[];
  allTasks: Task[];
  priority: number;
  pomodoroMin: number;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [onClose]);
  const { work, totalMin, last } = taskWorkSummary(task.id, sessions, allTasks);
  const stamp = (value: number) =>
    new Date(value).toLocaleString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal completed-details"
        role="dialog"
        aria-modal="true"
        aria-label="Tamamlanan görev detayları"
      >
        <div className="modal-heading">
          <div>
            <span className="read-only-badge">
              <LockKeyhole size={12} />
              Salt okunur
            </span>
            <h2>{task.title}</h2>
          </div>
          <button ref={closeRef} aria-label="Detayları kapat" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="task-meta">
          {task.label && (
            <span className="label-tag" style={{ color: task.color }}>
              <i style={{ background: task.color }} />
              {task.label}
            </span>
          )}
          <PriorityStars
            title={task.title}
            value={priority}
            readOnly
            disabled
            onChange={() => {}}
          />
        </div>
        <dl className="completion-facts">
          <div>
            <dt>Toplam odak</dt>
            <dd>{formatElapsed(totalMin)}</dd>
          </div>
          <div>
            <dt>Pomodoro süresi</dt>
            <dd>{formatMinutes(last?.plannedMin ?? pomodoroMin)}</dd>
          </div>
          <div>
            <dt>Çalışma oturumu</dt>
            <dd>{work.length}</dd>
          </div>
          {task.estimateMin && (
            <div>
              <dt>Toplam iş tahmini</dt>
              <dd>{formatMinutes(task.estimateMin)}</dd>
            </div>
          )}
          {task.completedAt !== null && (
            <div>
              <dt>Tamamlandı</dt>
              <dd>{stamp(task.completedAt)}</dd>
            </div>
          )}
          {task.scheduledDate && (
            <div>
              <dt>Plan günü</dt>
              <dd>{fullDate(task.scheduledDate)}</dd>
            </div>
          )}
          {task.startAt !== null && (
            <div>
              <dt>Plan başlangıcı</dt>
              <dd>{stamp(task.startAt)}</dd>
            </div>
          )}
          {task.endAt !== null && (
            <div>
              <dt>Plan bitişi</dt>
              <dd>{stamp(task.endAt)}</dd>
            </div>
          )}
          {task.dueAt !== null && (
            <div>
              <dt>Son bitirme zamanı</dt>
              <dd>{stamp(task.dueAt)}</dd>
            </div>
          )}
        </dl>
        {task.notes && (
          <section className="completion-section">
            <h3>Not</h3>
            <p className="completion-notes">{task.notes}</p>
          </section>
        )}
        {task.subtasks.length > 0 && (
          <section className="completion-section">
            <h3>Alt görevler</h3>
            <ul className="readonly-checklist">
              {task.subtasks.map((subtask) => (
                <li key={subtask.id}>
                  <span className={subtask.done ? "checked" : "unchecked"}>
                    {subtask.done ? <Check size={12} /> : null}
                  </span>
                  <span>{subtask.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="completion-section">
          <h3>Odak geçmişi</h3>
          {work.length ? (
            work.map((session) => (
              <div className="completion-session" key={session.id}>
                <div>
                  <strong>
                    {formatElapsed(session.actualMin)}{" "}
                    <span>/ {formatMinutes(session.plannedMin)} plan</span>
                  </strong>
                  <small>{stamp(session.endedAt)}</small>
                </div>
                <span>
                  {session.outcome === "switched"
                    ? "Görev değiştirildi"
                    : session.outcome === "elapsed"
                      ? "Süresi doldu"
                      : session.actualMin < session.plannedMin
                        ? "Erken bitirildi"
                        : "Süresi doldu"}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">
              Bu görevde kaydedilmiş odak oturumu yok. Tiklemek süre eklemez.
            </p>
          )}
        </section>
      </section>
    </div>
  );
}

function TaskRow({
  readOnly,
  priority,
  onPriority,
  task,
  sessions,
  allTasks,
  canStart,
  busy,
  onToggle,
  onEdit,
  onStart,
  onMove,
  onSubtask,
  onSelect,
  selected,
  pendingMs,
}: {
  readOnly: boolean;
  priority: number;
  onPriority: (rating: number) => void;
  task: Task;
  sessions: Snapshot["data"]["sessions"];
  allTasks: Task[];
  canStart: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStart: () => void;
  onMove: (date: string | null) => void;
  onSubtask: (id: string, done: boolean) => void;
  onSelect?: () => void;
  selected: boolean;
  pendingMs?: number;
}) {
  const [menu, setMenu] = useState(false);
  const completed = task.status === "completed";
  const total = taskWorkSummary(task.id, sessions, allTasks).totalMin;
  const allDone =
    task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
  return (
    <article
      className={`task-row ${completed ? "completed" : ""} ${onSelect ? "selectable" : ""} ${selected ? "selected-task" : ""}`}
      aria-label={`${task.title}: görev kartı`}
      tabIndex={onSelect ? 0 : undefined}
      onClick={(event) => {
        if (
          !(event.target as Element).closest(
            "button, input, select, textarea, label, .task-menu",
          )
        )
          onSelect?.();
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <div className="task-main">
        {readOnly ? (
          <span
            className="task-circle"
            aria-label={completed ? "Tamamlandı" : "Aktif görev"}
          >
            {completed && <Check size={13} />}
          </span>
        ) : (
          <button
            className="task-circle"
            aria-label={`${task.title}: ${completed ? "geri al" : "tamamla"}`}
            disabled={busy}
            onClick={onToggle}
          >
            {completed && <Check size={13} />}
          </button>
        )}
        <div className="task-content">
          {readOnly ? (
            <span className="task-title">{task.title}</span>
          ) : (
            <button className="task-title" onClick={onEdit}>
              {task.title}
            </button>
          )}
          <PriorityStars
            title={task.title}
            value={priority}
            readOnly={readOnly}
            disabled={busy}
            onChange={onPriority}
          />
          <div className="task-meta">
            {pendingMs !== undefined && (
              <span className="resume-tag">
                <RotateCcw size={12} />
                {clock(pendingMs)} kaldı
              </span>
            )}
            {task.label && (
              <span className="label-tag" style={{ color: task.color }}>
                <i style={{ background: task.color }} />
                {task.label}
              </span>
            )}
            {(total > 0 || task.estimateMin) && (
              <span>
                <Clock size={12} />
                {formatMinutes(total)}
                {task.estimateMin
                  ? ` / ~${formatMinutes(task.estimateMin)}`
                  : ""}
              </span>
            )}
            {task.startAt && (
              <span>
                <CalendarDays size={12} />
                {timeString(task.startAt)}–{timeString(task.endAt)}
              </span>
            )}
            {task.dueAt && taskKind(task) !== "recurring" && (
              <span>
                <Bell size={12} />
                Bitiş{" "}
                {new Date(task.dueAt).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "short",
                })}{" "}
                {timeString(task.dueAt)}
              </span>
            )}
            {task.seriesId && <Repeat size={12} />}{" "}
            {completed && task.completedAt && (
              <span>
                {new Date(task.completedAt).toLocaleDateString("tr-TR")}
              </span>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="task-actions">
            {!completed && (
              <button
                aria-label={`${task.title}: başlat`}
                title="Pomodoro başlat"
                disabled={!canStart || busy}
                onClick={onStart}
              >
                <Play size={15} />
              </button>
            )}
            <button
              aria-label={`${task.title}: seçenekler`}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        )}
      </div>
      {menu && !readOnly && (
        <div className="task-menu">
          <button
            onClick={() => {
              onEdit();
              setMenu(false);
            }}
          >
            Düzenle
          </button>
          {!completed && (
            <>
              <button
                onClick={() => {
                  onMove(dayKey());
                  setMenu(false);
                }}
              >
                Bugüne taşı
              </button>
              <button
                onClick={() => {
                  onMove(shiftDay(dayKey(), 1));
                  setMenu(false);
                }}
              >
                Yarına taşı
              </button>
              <label>
                Tarih seç
                <input
                  aria-label={`${task.title}: taşıma tarihi`}
                  type="date"
                  min={dayKey()}
                  onChange={(e) => {
                    if (e.target.value) {
                      onMove(e.target.value);
                      setMenu(false);
                    }
                  }}
                />
              </label>
              <button
                onClick={() => {
                  onMove(null);
                  setMenu(false);
                }}
              >
                Tarihsiz listeye taşı
              </button>
            </>
          )}
        </div>
      )}
      {task.notes && <p className="task-note">{task.notes}</p>}
      {task.subtasks.length > 0 && (
        <div className="subtasks">
          {task.subtasks.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={s.done}
                disabled={readOnly || busy}
                onChange={(e) => onSubtask(s.id, e.target.checked)}
              />
              <span className={s.done ? "done" : ""}>{s.title}</span>
            </label>
          ))}
        </div>
      )}
      {allDone && !completed && !readOnly && (
        <div className="suggestion">
          <Check size={12} />
          Alt görevler bitti. Hazırsan ana görevi de tamamlayabilirsin.
        </div>
      )}
    </article>
  );
}

function TaskEditor({
  initial,
  labels,
  catalog,
  defaultDay,
  priority,
  pomodoroMin,
  confirmDelete,
  onClose,
  onSave,
  onDelete,
  error,
  busy,
}: {
  initial: Task;
  labels: string[];
  catalog: LabelEntry[];
  defaultDay: string;
  priority: number;
  pomodoroMin: number;
  confirmDelete: ConfirmRequest;
  onClose: () => void;
  onSave: (task: Task, rating: number, minutes: number) => Promise<void>;
  onDelete?: () => void;
  error: string;
  busy: boolean;
}) {
  const [task, setTask] = useState(initial),
    [validation, setValidation] = useState(""),
    [subtask, setSubtask] = useState("");
  const legacyMixed =
    !initial.kind && !!initial.recurrenceRule && !!initial.dueAt;
  const [kind, setKind] = useState<
    "list" | "deadline" | "recurring" | "legacy"
  >(legacyMixed ? "legacy" : taskKind(initial));
  const [finishedAlready, setFinishedAlready] = useState(false);
  const [rating, setRating] = useState(priority);
  const [minutes, setMinutes] = useState<number | string>(pomodoroMin);
  const patch = (p: Partial<Task>) => setTask((t) => ({ ...t, ...p }));
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  const save = async () => {
    if (kind === "legacy") {
      setValidation("Bu eski işin türünü seç: son tarihli veya tekrarlayan.");
      return;
    }
    const nextTask = {
      ...task,
      ...(!onDelete || initial.kind || legacyMixed || kind !== taskKind(initial)
        ? { kind }
        : {}),
      ...(finishedAlready && kind === "deadline"
        ? { status: "completed" as const, completedAt: Date.now() }
        : {}),
    };
    const message =
      validatePomodoroMin(minutes) ||
      validateTask(nextTask, true) ||
      validatePlanningChange(nextTask, onDelete ? initial : undefined);
    if (message) {
      setValidation(message);
      return;
    }
    await onSave(
      { ...nextTask, title: task.title.trim() },
      rating,
      Number(minutes),
    );
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Görev düzenle"
      >
        <div className="modal-heading">
          <h2>{onDelete ? "Görevi düzenle" : "Yeni görev"}</h2>
          <button aria-label="Kapat" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            Başlık <span>Zorunlu</span>
            <input
              autoFocus
              required
              maxLength={250}
              className="required-field"
              aria-label="Başlık"
              placeholder="Ne yapmak istiyorsun?"
              value={task.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label className="field">
            Pomodoro süresi <span>Zorunlu · dakika</span>
            <input
              aria-label="Pomodoro süresi"
              type="number"
              required
              min="1"
              max="90"
              step="1"
              className="required-field"
              value={minutes}
              onChange={(e) =>
                setMinutes(e.target.value === "" ? "" : Number(e.target.value))
              }
            />
            <small>1–90 dakika · Görevin yanındaki ▶ bu süreyle başlar.</small>
          </label>
          <div className="field priority-field">
            <span>
              Öncelik <small>İsteğe bağlı · 1–5 yıldız</small>
            </span>
            <PriorityStars
              title={task.title || "Yeni görev"}
              value={rating}
              onChange={setRating}
            />
            <small className="muted">
              {rating
                ? `${rating} yıldız · ${rating >= 4 ? "yüksek öncelik" : rating >= 2 ? "orta öncelik" : "düşük öncelik"}`
                : "Henüz öncelik verilmedi"}
            </small>
          </div>
          <div className="field-grid">
            <label className="field">
              Etiket <span>Zorunlu</span>
              <input
                list="labels"
                aria-label="Etiket"
                required
                className="required-field"
                placeholder="İş, okul, kişisel…"
                value={task.label}
                onChange={(e) => {
                  const label = catalog.find((l) => l.name === e.target.value);
                  patch({
                    label: e.target.value,
                    ...(label ? { color: label.color } : {}),
                  });
                }}
              />
              <datalist id="labels">
                {labels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </datalist>
            </label>
            <label className="field">
              Etiket rengi
              <input
                aria-label="Etiket rengi"
                type="color"
                value={task.color}
                onChange={(e) => patch({ color: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            Görev türü <span>Zorunlu</span>
            <select
              aria-label="Görev türü"
              value={kind}
              onChange={(event) => {
                const selected = event.target.value as
                  "list" | "deadline" | "recurring";
                setKind(selected);
                if (selected === "recurring" && !task.recurrenceRule)
                  patch({
                    scheduledDate: task.scheduledDate || defaultDay,
                    recurrenceRule: {
                      frequency: "weekly",
                      weekdays: [parseDay(defaultDay).getDay()],
                      monthDay: parseDay(defaultDay).getDate(),
                    },
                  });
              }}
            >
              {legacyMixed && (
                <option value="legacy">Eski karma görev · türünü seç</option>
              )}
              {!initial.recurrenceRule && (
                <option value="list">Liste · tek seferlik iş</option>
              )}
              <option value="deadline">
                Son tarihli · bitince tekrar gelmez
              </option>
              <option value="recurring">Tekrarlayan · her dönem ayrı iş</option>
            </select>
          </label>
          {legacyMixed && (
            <p className="legacy-kind-message">
              Bu eski işte hem son tarih hem tekrar kuralı kayıtlı. Tek iş mi,
              her dönem yeniden yapılacak iş mi olduğunu seç. Eski günlerin
              kayıtları korunur.
            </p>
          )}
          {kind === "deadline" && (
            <>
              <label className="field">
                Son bitirme tarihi <span>Zorunlu</span>
                <input
                  aria-label="Son bitirme tarihi"
                  required
                  className="required-field"
                  type="datetime-local"
                  value={localInput(task.dueAt)}
                  onChange={(event) =>
                    patch({
                      dueAt: event.target.value
                        ? new Date(event.target.value).getTime()
                        : null,
                    })
                  }
                />
              </label>
              <small className="muted">
                Bu iş bugün ilerletilebilir; tamamlanınca gelecekte yeniden
                çıkmaz.
              </small>
              {initial.recurrenceRule && (
                <label className="switch-row">
                  <span>
                    Bu iş zaten tamamlandı
                    <small>
                      İşi tamamlananlara taşır; yapay odak süresi eklemez.
                    </small>
                  </span>
                  <input
                    aria-label="Bu iş zaten tamamlandı"
                    type="checkbox"
                    checked={finishedAlready}
                    onChange={(event) =>
                      setFinishedAlready(event.target.checked)
                    }
                  />
                </label>
              )}
            </>
          )}
          {kind === "recurring" && (
            <>
              <label className="field">
                Tekrar kuralı
                <select
                  aria-label="Tekrar"
                  value={task.recurrenceRule?.frequency || "weekly"}
                  onChange={(event) =>
                    patch({
                      scheduledDate: task.scheduledDate || defaultDay,
                      recurrenceRule: {
                        frequency: event.target.value as
                          "daily" | "weekly" | "monthly",
                        weekdays: task.recurrenceRule?.weekdays.length
                          ? task.recurrenceRule.weekdays
                          : [parseDay(defaultDay).getDay()],
                        monthDay:
                          task.recurrenceRule?.monthDay ||
                          parseDay(defaultDay).getDate(),
                      },
                    })
                  }
                >
                  <option value="daily">Her gün</option>
                  <option value="weekly">Her hafta · seçili günler</option>
                  <option value="monthly">Her ay</option>
                </select>
              </label>
              {task.recurrenceRule?.frequency === "weekly" && (
                <div className="weekday-selector">
                  {weekdays.map((name, index) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={task.recurrenceRule!.weekdays.includes(index)}
                        onChange={(event) =>
                          patch({
                            recurrenceRule: {
                              ...task.recurrenceRule!,
                              weekdays: event.target.checked
                                ? [...task.recurrenceRule!.weekdays, index]
                                : task.recurrenceRule!.weekdays.filter(
                                    (day) => day !== index,
                                  ),
                            },
                          })
                        }
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
              {task.recurrenceRule?.frequency === "monthly" && (
                <label className="field">
                  Ayın günü
                  <input
                    aria-label="Ayın günü"
                    type="number"
                    min="1"
                    max="31"
                    value={task.recurrenceRule.monthDay}
                    onChange={(event) =>
                      patch({
                        recurrenceRule: {
                          ...task.recurrenceRule!,
                          monthDay: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
              <small className="muted">
                Bir dönemi tamamlamak seriyi bitirmez. Yıldız ve pomodoro süresi
                seriden sonraki dönemlere taşınır.
              </small>
            </>
          )}
          <label className="field">
            Not
            <textarea
              aria-label="Not"
              rows={2}
              placeholder="Küçük bir hatırlatma…"
              value={task.notes}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </label>
          <div className="field">
            <span>
              Alt görevler <small>İsteğe bağlı</small>
            </span>
            <small className="muted">
              {task.scheduledDate
                ? `Ana görevle aynı gün: ${fullDate(task.scheduledDate)}`
                : "Ana görev gibi tarihsizdir; gün seçmek zorunlu değil."}
            </small>
            {task.subtasks.map((s) => (
              <div className="subtask-edit" key={s.id}>
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`${s.title}: alt görev`}
                  onChange={(e) =>
                    patch({
                      subtasks: task.subtasks.map((item) =>
                        item.id === s.id
                          ? { ...item, done: e.target.checked }
                          : item,
                      ),
                    })
                  }
                />
                <span>{s.title}</span>
                <button
                  type="button"
                  aria-label={`${s.title}: sil`}
                  onClick={() =>
                    confirmDelete(
                      "Alt görevi silmek istiyor musun?",
                      `“${s.title}” alt görevi kaldırılacak. Ana görev korunur.`,
                      () => {
                        patch({
                          subtasks: task.subtasks.filter(
                            (item) => item.id !== s.id,
                          ),
                        });
                        return true;
                      },
                    )
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <div className="subtask-input">
              <input
                aria-label="Alt görev ekle"
                placeholder="Bir adım ekle…"
                value={subtask}
                onChange={(e) => setSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (subtask.trim()) {
                      patch({
                        subtasks: [
                          ...task.subtasks,
                          {
                            id: newId(),
                            title: subtask.trim(),
                            done: false,
                          },
                        ],
                      });
                      setSubtask("");
                    }
                  }
                }}
              />
              <button
                type="button"
                aria-label="Alt görev kaydet"
                onClick={() => {
                  if (subtask.trim()) {
                    patch({
                      subtasks: [
                        ...task.subtasks,
                        {
                          id: newId(),
                          title: subtask.trim(),
                          done: false,
                        },
                      ],
                    });
                    setSubtask("");
                  }
                }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          {(validation || error) && (
            <p className="form-error" role="alert">
              {validation || error}
            </p>
          )}
          <div className="modal-footer">
            {onDelete && (
              <button type="button" className="danger" onClick={onDelete}>
                <Trash2 size={14} />
                Görevi sil
              </button>
            )}
            <button type="button" onClick={onClose}>
              Vazgeç
            </button>
            <button className="primary" disabled={busy}>
              <Check size={15} />
              Kaydet
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SettingsPanel({
  labels,
  onLabelSave,
  onLabelDelete,
  settings,
  databasePath,
  active,
  onSave,
  onSound,
  onBackup,
}: {
  labels: LabelEntry[];
  onLabelSave: (name: string, color: string) => Promise<boolean>;
  onLabelDelete: (name: string) => void;
  settings: Settings;
  databasePath: string;
  active: boolean;
  onSave: (s: Settings) => Promise<boolean>;
  onSound: (phase: string) => void;
  onBackup: (kind: "export" | "import") => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings),
    [saved, setSaved] = useState(false);
  const [driveBackup, setDriveBackup] = useState<{
    configured: boolean;
    lastUploadedAt?: string;
    lastFilename?: string;
  } | null>(null);
  useEffect(() => {
    call<{
      configured: boolean;
      lastUploadedAt?: string;
      lastFilename?: string;
    }>("drive_backup_status")
      .then(setDriveBackup)
      .catch(() => {});
  }, []);
  const patch = (p: Partial<Settings>) => {
    setDraft((s) => ({ ...s, ...p }));
    setSaved(false);
  };
  return (
    <section className="settings-panel">
      <div className="eyebrow muted">SANA GÖRE BİR RİTİM</div>
      <h1>Ayarlar</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(await onSave(draft));
        }}
      >
        <div className="settings-group">
          <h3>
            <Clock size={17} />
            Odak & mola
          </h3>
          <div className="field-grid">
            <label className="field">
              Varsayılan çalışma · 1–90 dk
              <input
                aria-label="Varsayılan çalışma"
                type="number"
                required
                min="1"
                max="90"
                value={draft.defaultWorkMin}
                onChange={(e) =>
                  patch({ defaultWorkMin: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              Varsayılan mola · 1–30 dk
              <input
                aria-label="Varsayılan mola"
                type="number"
                required
                min="1"
                max="30"
                value={draft.defaultBreakMin}
                onChange={(e) =>
                  patch({ defaultBreakMin: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
        <div className="settings-group">
          <h3>
            <Volume2 size={17} />
            Ses & bildirimler
          </h3>
          <label className="switch-row">
            Sesleri çal
            <input
              type="checkbox"
              checked={draft.soundEnabled}
              onChange={(e) => patch({ soundEnabled: e.target.checked })}
            />
          </label>
          <label className="switch-row">
            <span>
              Sessiz mod<small>Bildirimler görünür, hiçbir ses çalmaz.</small>
            </span>
            <input
              type="checkbox"
              checked={draft.quietMode}
              onChange={(e) => patch({ quietMode: e.target.checked })}
            />
          </label>
          <label className="volume-row">
            Ses seviyesi
            <input
              aria-label="Ses seviyesi"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={draft.soundVolume}
              onChange={(e) => patch({ soundVolume: Number(e.target.value) })}
            />
            <span>%{Math.round(draft.soundVolume * 100)}</span>
          </label>
          <div className="sound-buttons">
            <button type="button" onClick={() => onSound("work")}>
              Çalışma bitti · dinle
            </button>
            <button type="button" onClick={() => onSound("break")}>
              Mola bitti · dinle
            </button>
          </div>
          <small className="muted">
            Ses denemesi kaydedilmiş ayarları kullanır.
          </small>
          <label className="field">
            Planlı görev hatırlatması · dakika önce
            <input
              aria-label="Hatırlatma süresi"
              type="number"
              min="0"
              max="1440"
              required
              value={draft.notifyLeadMin}
              onChange={(e) => patch({ notifyLeadMin: Number(e.target.value) })}
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              call("request_notification_permission").catch(() => {})
            }
          >
            <Bell size={14} />
            Bildirim iznini kontrol et
          </button>
        </div>
        <div className="settings-group">
          <h3>
            <SettingsIcon size={17} />
            macOS
          </h3>
          <label className="switch-row">
            <span>
              Oturum açınca başlat
              <small>Planlı hatırlatmalar için Odak arka planda çalışır.</small>
            </span>
            <input
              type="checkbox"
              checked={draft.launchAtLogin}
              onChange={(e) => patch({ launchAtLogin: e.target.checked })}
            />
          </label>
          <label className="field">
            Hızlı görev kısayolu
            <input
              aria-label="Hızlı görev kısayolu"
              value={draft.quickAddShortcut}
              onChange={(e) => patch({ quickAddShortcut: e.target.value })}
            />
            <small>Örnek: CmdOrCtrl+Shift+K</small>
          </label>
        </div>
        <button className="primary">
          <Check size={15} />
          {saved ? "Ayarlar kaydedildi" : "Ayarları kaydet"}
        </button>
      </form>
      <LabelManager
        labels={labels}
        onSave={onLabelSave}
        onDelete={onLabelDelete}
      />
      <div className="settings-group backup-group">
        <h3>
          <Download size={17} />
          Veri yedekleme
        </h3>
        <p>Görevler, oturumlar, sayaç ve ayarlar tek JSON dosyasında.</p>
        <div className="sound-buttons">
          <button onClick={() => onBackup("export")}>
            <Download size={15} />
            JSON dışa aktar
          </button>
          <button disabled={active} onClick={() => onBackup("import")}>
            <Upload size={15} />
            JSON içe aktar
          </button>
        </div>
        {driveBackup?.configured && (
          <div className="drive-backup-info">
            <strong>Günlük Google Drive yedeği · bu Mac</strong>
            <p>
              23:55’te Drive’daki Odak klasörüne ayrı bir yedek alınır. Uyku
              veya bağlantı kesintisinden sonra yeniden denenir. Çalışan sayaç
              durdurulmaz.
            </p>
            {driveBackup.lastUploadedAt && (
              <small>
                Son başarılı yedek:{" "}
                {new Date(driveBackup.lastUploadedAt).toLocaleString("tr-TR")}
              </small>
            )}
            <small>
              Yedekleme bu Mac’e ayrıca kurulmuştur; Odak uygulaması ağ isteği
              yapmaz.
            </small>
          </div>
        )}
        <small className="database-path">Yerel SQLite: {databasePath}</small>
      </div>
      <p className="privacy-note">
        <Leaf size={15} />
        Hesap yok. Bulut yok. Verilerin bu Mac’te.
        <span>Odak v{__APP_VERSION__}</span>
      </p>
    </section>
  );
}

function TimerTitle({
  task,
  busy,
  onRename,
}: {
  task: Task;
  busy: boolean;
  onRename: (title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  useEffect(() => {
    if (!editing) setTitle(task.title);
  }, [task.title, editing]);
  useEffect(() => {
    setEditing(false);
    setTitle(task.title);
  }, [task.id]);
  if (!editing)
    return (
      <button
        className="timer-title"
        aria-label="Odak görev adını düzenle"
        title="Yalnızca görev adını düzenle"
        onClick={() => {
          setTitle(task.title);
          setEditing(true);
        }}
      >
        {task.title}
        <Pencil size={12} />
      </button>
    );
  return (
    <form
      className="timer-title-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        if (title.trim() && (await onRename(title))) setEditing(false);
      }}
    >
      <input
        autoFocus
        aria-label="Odak görev adı"
        className="required-field"
        required
        maxLength={250}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button aria-label="Görev adını kaydet" disabled={busy || !title.trim()}>
        <Check size={15} />
      </button>
      <button
        type="button"
        aria-label="Ad düzenlemeyi iptal et"
        onClick={() => setEditing(false)}
      >
        <X size={15} />
      </button>
    </form>
  );
}

function SessionHistory({
  sessions,
  tasks,
  filter,
}: {
  sessions: Session[];
  tasks: Task[];
  filter: string;
}) {
  const [limit, setLimit] = useState(20);
  const history = sessions
    .filter((s) => s.type === "work" && (!filter || s.label === filter))
    .sort((a, b) => b.endedAt - a.endedAt);
  if (!history.length) return null;
  return (
    <section className="session-history" aria-label="Biten odak oturumları">
      <h3>
        Biten odak oturumları <span>{history.length}</span>
      </h3>
      <p className="muted">
        Oturum bitince süre kaydedilir. Görevi tamamlamak için yuvarlağa
        basmalısın.
      </p>
      {history.slice(0, limit).map((s) => (
        <div className="session-history-row" key={s.id}>
          <span>
            <strong>
              {tasks.find((t) => t.id === s.taskId)?.title ||
                (s.taskId
                  ? "Görevi kaldırılmış oturum"
                  : "Önceki görevsiz odak")}
            </strong>
            <small>
              {new Date(s.endedAt).toLocaleString("tr-TR", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {s.label ? ` · ${s.label}` : ""}
            </small>
          </span>
          <span>
            <Clock size={13} />
            {formatMinutes(s.actualMin)}
          </span>
        </div>
      ))}
      {history.length > limit && (
        <button className="text-button" onClick={() => setLimit(limit + 20)}>
          Daha fazla göster
        </button>
      )}
    </section>
  );
}

function FocusTrend({
  sessions,
  selectedDate,
  onSelect,
}: {
  sessions: Session[];
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const days = dailyTrend(sessions);
  const selected =
    days.find((d) => d.date === selectedDate) || days[days.length - 1];
  const maximum = Math.max(60, ...days.map((d) => d.minutes));
  const x = (i: number) => 45 + (i * 640) / (days.length - 1);
  const y = (minutes: number) => 174 - (minutes / maximum) * 140;
  const points = days.map((d, i) => `${x(i)},${y(d.minutes)}`).join(" ");
  return (
    <section className="trend-chart" aria-label="Günlük odak çizgi grafiği">
      <div className="trend-heading">
        <h3>Günden güne odak</h3>
        <span>Son 14 gün</span>
      </div>
      <svg
        viewBox="0 0 730 210"
        role="img"
        aria-label="Son 14 günün toplam odak süreleri; noktaya tıklayıp günlük değişimi görebilirsin."
      >
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1="45"
              x2="685"
              y1={y(maximum * ratio)}
              y2={y(maximum * ratio)}
              className="trend-grid"
            />
            <text x="35" y={y(maximum * ratio) + 4} textAnchor="end">
              {Math.round(maximum * ratio)}
            </text>
          </g>
        ))}
        <text x="15" y="15">
          dk
        </text>
        <polygon points={`45,174 ${points} 685,174`} className="trend-area" />
        <polyline points={points} className="trend-line" />
        {days.map((d, i) => (
          <g key={d.date}>
            <circle
              cx={x(i)}
              cy={y(d.minutes)}
              r={d.date === selected.date ? 5 : 3.5}
              className="trend-point"
            />
            <circle
              cx={x(i)}
              cy={y(d.minutes)}
              r="14"
              className="trend-hit"
              role="button"
              tabIndex={0}
              aria-label={`${fullDate(d.date)}: ${formatMinutes(d.minutes)}`}
              aria-pressed={d.date === selected.date}
              onClick={() => onSelect(d.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(d.date);
                }
              }}
            >
              <title>
                {fullDate(d.date)} · {formatMinutes(d.minutes)}
              </title>
            </circle>
            {(i % 3 === 0 || i === days.length - 1) && (
              <text x={x(i)} y="201" textAnchor="middle">
                {parseDay(d.date).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "short",
                })}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="trend-detail" aria-live="polite">
        <span>
          {fullDate(selected.date)} ·{" "}
          <strong>{formatMinutes(selected.minutes)}</strong>
        </span>
        <span
          className={
            selected.delta > 0
              ? "increase"
              : selected.delta < 0
                ? "decrease"
                : "muted"
          }
        >
          {selected.delta > 0
            ? `↑ Önceki güne göre ${formatMinutes(selected.delta)} daha fazla`
            : selected.delta < 0
              ? `↓ Önceki güne göre ${formatMinutes(-selected.delta)} daha az`
              : "Önceki günle aynı"}
        </span>
      </div>
      <small className="muted">
        Bugünün değeri, biten odak oturumlarıyla gün boyunca artar.
      </small>
    </section>
  );
}

function LabelManager({
  labels,
  onSave,
  onDelete,
}: {
  labels: LabelEntry[];
  onSave: (name: string, color: string) => Promise<boolean>;
  onDelete: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#438470");
  const [pending, setPending] = useState(false);
  return (
    <section
      className="settings-group label-manager"
      aria-label="Etiket yönetimi"
    >
      <h3>Etiketler</h3>
      <p>
        Etiketleri buradan oluşturabilir veya seçim listesinden kaldırabilirsin.
        Mevcut görevlerin etiketleri ve renkleri korunur.
      </p>
      <form
        className="label-create"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            if (await onSave(name.trim(), color)) setName("");
          } finally {
            setPending(false);
          }
        }}
      >
        <input
          aria-label="Yeni etiket adı"
          className="required-field"
          required
          maxLength={250}
          placeholder="Etiket adı"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          aria-label="Yeni etiket rengi"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <button className="primary" disabled={pending || !name.trim()}>
          <Plus size={15} />
          Etiket oluştur
        </button>
      </form>
      <div className="managed-labels">
        {labels.map((l) => (
          <div key={l.name}>
            <span className="label-tag" style={{ color: l.color }}>
              <i style={{ background: l.color }} />
              {l.name}
            </span>
            <button
              aria-label={`${l.name}: etiketi sil`}
              title="Seçim listesinden kaldır; görevler korunur"
              disabled={pending}
              onClick={() => onDelete(l.name)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <small className="muted">
        Yeni görevde farklı bir etiket yazmak da etiketi otomatik oluşturur.
      </small>
    </section>
  );
}

function PriorityStars({
  title,
  value,
  onChange,
  readOnly = false,
  disabled = false,
}: {
  title: string;
  value: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const preview = hover ?? value;
  if (readOnly)
    return value > 0 ? (
      <span
        className="priority-readonly"
        aria-label={`${title}: ${value} yıldız öncelik`}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} size={12} className={i < value ? "lit" : ""} />
        ))}
      </span>
    ) : null;
  return (
    <div
      className="star-rating"
      role="radiogroup"
      aria-label={`${title}: öncelik`}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${title}: ${star} yıldız`}
          title={`${star} yıldız öncelik`}
          tabIndex={star === (value || 1) ? 0 : -1}
          disabled={disabled}
          className={`star-button ${star <= preview ? "lit" : ""} ${hover !== null ? "preview" : ""}`}
          style={{ animationDelay: `${star * 25}ms` }}
          onMouseEnter={() => setHover(star)}
          onFocus={() => setHover(star)}
          onBlur={() => setHover(null)}
          onClick={() => {
            setHover(null);
            onChange?.(star);
          }}
          onKeyDown={(e) => {
            const next =
              e.key === "ArrowRight" || e.key === "ArrowUp"
                ? Math.min(5, star + 1)
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? Math.max(1, star - 1)
                  : e.key === "Home"
                    ? 1
                    : e.key === "End"
                      ? 5
                      : null;
            if (next !== null) {
              e.preventDefault();
              (
                e.currentTarget.parentElement?.children[next - 1] as HTMLElement
              )?.focus();
              onChange?.(next);
            }
          }}
        >
          <Star size={15} />
        </button>
      ))}
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  error,
  onCancel,
  onConfirm,
  confirmLabel = "Evet, onayla",
  positive = false,
}: {
  title: string;
  message: string;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
  positive?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!pending) onCancel();
      }
      if (e.key === "Tab") {
        const items = [
          ...(dialog.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) || []),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (
          items.length &&
          ((e.shiftKey && index <= 0) ||
            (!e.shiftKey && index === items.length - 1))
        ) {
          e.preventDefault();
          (e.shiftKey ? items[items.length - 1] : items[0]).focus();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [onCancel, pending]);
  return (
    <div
      className="modal-overlay confirm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <section
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        ref={dialog}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message">{message}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button ref={cancel} disabled={pending} onClick={onCancel}>
            Vazgeç
          </button>
          <button
            className={positive ? "positive-confirm" : "danger-confirm"}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "İşleniyor…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
