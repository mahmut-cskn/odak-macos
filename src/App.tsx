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
import {
  calendarPreview,
  dailyTrend,
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
};
type ConfirmRequest = (
  title: string,
  message: string,
  action: Confirmation["action"],
) => void;
type Tab = "today" | "list" | "calendar" | "completed" | "stats" | "settings";
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [prioritySort, setPrioritySort] = useState(false);
  const requestDelete: ConfirmRequest = (title, message, action) => {
    setError("");
    setConfirmation({ title, message, action });
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
      setTimeout(() => quickRef.current?.focus(), 50);
    }).then((fn) => (active ? cleanups.push(fn) : fn()));
    return () => {
      active = false;
      cleanups.forEach((fn) => fn());
    };
  }, [reload]);
  const chosenTask = snapshot?.data.tasks.find(
    (t) =>
      t.id ===
      (focusTaskId ||
        (snapshot.data.timer.breakReady ? snapshot.data.timer.taskId : "")),
  );
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
    if (!quick && snapshot && !(tab === "calendar" && day < dayKey()))
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
            const validation = validatePomodoroMin(quickWork);
            if (validation) {
              setError(validation);
              return;
            }
            if (await run("save_task", { ...t, pomodoroMin: quickWork })) {
              setQuickTitle("");
              setQuickWork(snapshot?.data.settings.defaultWorkMin || 45);
              await hideQuick();
            }
          }}
        >
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
  const focusTasks = data.tasks.filter(
    (t) => t.status === "active" && !t.recurrenceRule && !isPastTask(t),
  );
  const selectedFocusTask = focusTasks.find(
    (t) => t.id === (focusTaskId || (timer.breakReady ? timer.taskId : "")),
  );
  const timerTask = active
    ? activeTask
    : selectedFocusTask || (timer.breakReady ? activeTask : undefined);
  let tasks =
    tab === "today"
      ? tasksForDay(data.tasks, dayKey()).filter((t) => t.status === "active")
      : tab === "list"
        ? data.tasks.filter(
            (t) =>
              !t.scheduledDate && !t.recurrenceRule && t.status === "active",
          )
        : tab === "completed"
          ? data.tasks
              .filter((t) => t.status === "completed")
              .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
          : tasksForDay(data.tasks, day);
  if (filter) tasks = tasks.filter((t) => t.label === filter);
  if (prioritySort && (tab === "today" || tab === "list"))
    tasks = [...tasks].sort(
      (a, b) => priorityFor(b, priorities) - priorityFor(a, priorities),
    );
  const add = () => {
    if (calendarReadOnly) return;
    setEditor(
      newTask(tab === "calendar" ? day : tab === "today" ? dayKey() : null),
    );
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
    const task = data.tasks.find((t) => t.id === taskId);
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
    setFocusTaskId(taskId);
    return run("start", { taskId, workMin: minutes, breakMin: rest });
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
        {tab !== "settings" && tab !== "stats" && (
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
                      {active || timer.breakReady
                        ? "Önceki odak oturumu"
                        : "Bir görev seç"}
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
                        : timer.breakReady
                          ? "00:00"
                          : clock(work * 60000)}
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
                    disabled={active || busy}
                    value={
                      (active ? activeTask?.id : selectedFocusTask?.id) || ""
                    }
                    onChange={(e) => setFocusTaskId(e.target.value)}
                  >
                    <option value="">Hangi işe odaklanacaksın?</option>
                    {activeTask &&
                      !focusTasks.some((t) => t.id === activeTask.id) && (
                        <option value={activeTask.id}>
                          {activeTask.title}
                          {activeTask.label ? ` · ${activeTask.label}` : ""}
                        </option>
                      )}
                    {focusTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.label ? ` · ${t.label}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
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
                        disabled={active}
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
                          : "AKLINDA KALMASIN"}
                  </div>
                  <h1>
                    {tab === "today"
                      ? "Bugünün gündemi"
                      : tab === "list"
                        ? "Görev listesi"
                        : tab === "completed"
                          ? "Tamamlanan görevler"
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
                  {tasks.length} görev
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
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    sessions={data.sessions}
                    readOnly={calendarReadOnly}
                    priority={priorityFor(task, priorities)}
                    onPriority={(rating) =>
                      run("set_priority", { id: task.id, rating })
                    }
                    canStart={!active && !isPastTask(task)}
                    busy={busy}
                    onToggle={() => run("toggle_task", { id: task.id })}
                    onEdit={() => setEditor(cloneTask(task))}
                    onStart={() => start(task.id)}
                    onMove={(date) => move(task, date)}
                    onSubtask={(id, done) =>
                      run("save_task", {
                        ...task,
                        subtasks: task.subtasks.map((s) =>
                          s.id === id ? { ...s, done } : s,
                        ),
                      })
                    }
                  />
                ))}
                {!tasks.length && (
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
              {tab === "list" && data.tasks.some((t) => t.recurrenceRule) && (
                <div className="series-list">
                  <h3>
                    <Repeat size={15} />
                    Tekrarlayan görevler
                  </h3>
                  {data.tasks
                    .filter(
                      (t) =>
                        t.recurrenceRule && (!filter || t.label === filter),
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
              Yalnızca bitirdiğin çalışma oturumları sayılır.
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
                <strong>
                  {data.sessions.filter((s) => s.type === "work").length}
                </strong>
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
            <FocusTrend sessions={data.sessions} />
            <h3>Etikete göre · bu hafta</h3>
            {Object.entries(summary.labels)
              .sort((a, b) => b[1] - a[1])
              .map(([label, min]) => (
                <div className="label-stat" key={label}>
                  <span>{label}</span>
                  <div>
                    <i
                      style={{
                        width: `${(min / Math.max(1, summary.weekly)) * 100}%`,
                        background:
                          data.tasks.find((t) => t.label === label)?.color ||
                          "#438470",
                      }}
                    />
                  </div>
                  <strong>{formatMinutes(min)}</strong>
                </div>
              ))}
            {!summary.weekly && (
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
      </main>
      <footer className="app-footer">
        <span>
          <Leaf size={12} />
          Bir seferde bir iş.
        </span>
        {!calendarReadOnly && (
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
            if (editor.recurrenceRule && !t.recurrenceRule)
              requestDelete(
                "Tekrar kuralını kaldırmak istiyor musun?",
                "Gelecekteki başlanmamış tekrarlar kaldırılır. Tamamlanan ve başlanmış geçmiş korunur.",
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
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
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

function TaskRow({
  readOnly,
  priority,
  onPriority,
  task,
  sessions,
  canStart,
  busy,
  onToggle,
  onEdit,
  onStart,
  onMove,
  onSubtask,
}: {
  readOnly: boolean;
  priority: number;
  onPriority: (rating: number) => void;
  task: Task;
  sessions: Snapshot["data"]["sessions"];
  canStart: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStart: () => void;
  onMove: (date: string | null) => void;
  onSubtask: (id: string, done: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const completed = task.status === "completed";
  const total = spent(task.id, sessions);
  const allDone =
    task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
  return (
    <article className={`task-row ${completed ? "completed" : ""}`}>
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
            {task.dueAt && (
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
                disabled={readOnly}
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
    const message =
      validatePomodoroMin(minutes) ||
      validateTask(task) ||
      validatePlanningChange(task, onDelete ? initial : undefined);
    if (message) {
      setValidation(message);
      return;
    }
    await onSave(
      { ...task, title: task.title.trim() },
      rating,
      Number(minutes),
    );
  };
  const changeDate = (value: string) => {
    const date = value || null;
    const change = (ms: number | null) =>
      date && ms ? new Date(`${date}T${timeString(ms)}`).getTime() : null;
    patch({
      scheduledDate: date,
      startAt: change(task.startAt),
      endAt: change(task.endAt),
    });
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
              Etiket
              <input
                list="labels"
                aria-label="Etiket"
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
          <div className="field-grid">
            <label className="field">
              Gün <span>İsteğe bağlı</span>
              <input
                aria-label="Gün"
                min={
                  initial.scheduledDate && initial.scheduledDate < dayKey()
                    ? initial.scheduledDate
                    : dayKey()
                }
                required={!!task.recurrenceRule}
                className={task.recurrenceRule ? "required-field" : ""}
                type="date"
                value={task.scheduledDate || ""}
                onChange={(e) => changeDate(e.target.value)}
              />
            </label>
            <label className="field">
              Toplam iş tahmini <span>İsteğe bağlı · dakika</span>
              <input
                aria-label="Tahmini süre"
                type="number"
                min="1"
                max="100000"
                placeholder="Süresiz bırakabilirsin"
                value={task.estimateMin || ""}
                onChange={(e) =>
                  patch({
                    estimateMin: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field">
              Başlangıç saati
              <input
                aria-label="Başlangıç saati"
                required={task.endAt !== null}
                className={task.endAt !== null ? "required-field" : ""}
                type="time"
                disabled={!task.scheduledDate}
                value={timeString(task.startAt)}
                onChange={(e) =>
                  patch({
                    startAt:
                      e.target.value && task.scheduledDate
                        ? new Date(
                            `${task.scheduledDate}T${e.target.value}`,
                          ).getTime()
                        : null,
                  })
                }
              />
            </label>
            <label className="field">
              Bitiş saati
              <input
                aria-label="Bitiş saati"
                required={task.startAt !== null}
                className={task.startAt !== null ? "required-field" : ""}
                type="time"
                disabled={!task.scheduledDate}
                value={timeString(task.endAt)}
                onChange={(e) =>
                  patch({
                    endAt:
                      e.target.value && task.scheduledDate
                        ? new Date(
                            `${task.scheduledDate}T${e.target.value}`,
                          ).getTime()
                        : null,
                  })
                }
              />
            </label>
          </div>
          <label className="field">
            Son bitirme zamanı <span>İsteğe bağlı</span>
            <input
              aria-label="Son bitirme zamanı"
              type="datetime-local"
              value={localInput(task.dueAt)}
              onChange={(e) =>
                patch({
                  dueAt: e.target.value
                    ? new Date(e.target.value).getTime()
                    : null,
                })
              }
            />
          </label>
          {!task.seriesId && (
            <>
              <label className="field">
                Tekrar
                <select
                  aria-label="Tekrar"
                  value={task.recurrenceRule?.frequency || ""}
                  onChange={(e) =>
                    patch({
                      scheduledDate: e.target.value
                        ? task.scheduledDate || defaultDay
                        : task.scheduledDate,
                      recurrenceRule: e.target.value
                        ? {
                            frequency: e.target.value as
                              "daily" | "weekly" | "monthly",
                            weekdays: [
                              parseDay(
                                task.scheduledDate || defaultDay,
                              ).getDay(),
                            ],
                            monthDay: parseDay(
                              task.scheduledDate || defaultDay,
                            ).getDate(),
                          }
                        : null,
                    })
                  }
                >
                  <option value="">Tekrarlama</option>
                  <option value="daily">Her gün</option>
                  <option value="weekly">Her hafta · seçili günler</option>
                  <option value="monthly">Her ay</option>
                </select>
              </label>
              {task.recurrenceRule?.frequency === "weekly" && (
                <div className="weekday-selector">
                  {weekdays.map((d, i) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        checked={task.recurrenceRule!.weekdays.includes(i)}
                        onChange={(e) =>
                          patch({
                            recurrenceRule: {
                              ...task.recurrenceRule!,
                              weekdays: e.target.checked
                                ? [...task.recurrenceRule!.weekdays, i]
                                : task.recurrenceRule!.weekdays.filter(
                                    (n) => n !== i,
                                  ),
                            },
                          })
                        }
                      />
                      {d}
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
                    onChange={(e) =>
                      patch({
                        recurrenceRule: {
                          ...task.recurrenceRule!,
                          monthDay: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
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

function FocusTrend({ sessions }: { sessions: Session[] }) {
  const days = dailyTrend(sessions);
  const [selectedDate, setSelectedDate] = useState(dayKey());
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
              onClick={() => setSelectedDate(d.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedDate(d.date);
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
}: {
  title: string;
  message: string;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
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
            className="danger-confirm"
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
            {pending ? "İşleniyor…" : "Evet, onayla"}
          </button>
        </div>
      </section>
    </div>
  );
}
