export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}
export interface Recurrence {
  frequency: "daily" | "weekly" | "monthly";
  weekdays: number[];
  monthDay: number;
}
export interface Task {
  id: string;
  title: string;
  label: string;
  color: string;
  notes: string;
  status: "active" | "completed";
  completedAt: number | null;
  estimateMin: number | null;
  scheduledDate: string | null;
  startAt: number | null;
  endAt: number | null;
  dueAt: number | null;
  recurrenceRule: Recurrence | null;
  seriesId: string | null;
  subtasks: Subtask[];
  createdAt: number;
}
export interface Session {
  id: string;
  taskId: string | null;
  type: "work" | "break";
  startedAt: number;
  endedAt: number;
  plannedMin: number;
  actualMin: number;
  label: string;
}
export interface Timer {
  taskId: string | null;
  phase: "idle" | "work" | "break" | "paused";
  pausedPhase: "work" | "break" | null;
  startedAt: number | null;
  pausedAt: number | null;
  pausedAccumulatedMs: number;
  workMin: number;
  breakMin: number;
  plannedMin: number;
  breakReady: boolean;
}
export interface Settings {
  defaultWorkMin: number;
  defaultBreakMin: number;
  soundEnabled: boolean;
  soundVolume: number;
  quietMode: boolean;
  notifyLeadMin: number;
  quickAddShortcut: string;
  launchAtLogin: boolean;
}
export interface Data {
  tasks: Task[];
  sessions: Session[];
  timer: Timer;
  settings: Settings;
  notified: string[];
}
export interface Snapshot {
  data: Data;
  remainingMs: number;
  databasePath: string;
  serviceError: string | null;
  labels?: LabelEntry[];
  priorities?: Record<string, number>;
  taskDurations?: Record<string, number>;
}
export const defaultSettings: Settings = {
  defaultWorkMin: 45,
  defaultBreakMin: 15,
  soundEnabled: true,
  soundVolume: 0.5,
  quietMode: false,
  notifyLeadMin: 15,
  quickAddShortcut: "CmdOrCtrl+Shift+K",
  launchAtLogin: true,
};
export const dayKey = (value = new Date()) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export const parseDay = (value: string) => new Date(`${value}T12:00:00`);
export function shiftDay(value: string, offset: number) {
  const d = parseDay(value);
  d.setDate(d.getDate() + offset);
  return dayKey(d);
}
export const formatMinutes = (minutes: number) => {
  const m = Math.round(minutes);
  return m >= 60
    ? `${Math.floor(m / 60)}sa${m % 60 ? ` ${m % 60}dk` : ""}`
    : `${m}dk`;
};
export const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const timeString = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const localInput = (ms: number | null) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const spent = (taskId: string, sessions: Session[]) =>
  sessions
    .filter((s) => s.type === "work" && s.taskId === taskId)
    .reduce((sum, s) => sum + s.actualMin, 0);
export function newTask(date: string | null = null): Task {
  return {
    id: newId(),
    title: "",
    label: "",
    color: "#438470",
    notes: "",
    status: "active",
    completedAt: null,
    estimateMin: null,
    scheduledDate: date,
    startAt: null,
    endAt: null,
    dueAt: null,
    recurrenceRule: null,
    seriesId: null,
    subtasks: [],
    createdAt: Date.now(),
  };
}
export function tasksForDay(tasks: Task[], date: string) {
  return tasks
    .filter(
      (t) =>
        !t.recurrenceRule &&
        (t.scheduledDate === date ||
          (!t.scheduledDate && t.dueAt && dayKey(new Date(t.dueAt)) === date) ||
          (t.status === "completed" &&
            t.completedAt &&
            dayKey(new Date(t.completedAt)) === date)),
    )
    .sort(
      (a, b) =>
        (a.startAt ?? a.dueAt ?? Infinity) -
          (b.startAt ?? b.dueAt ?? Infinity) || a.createdAt - b.createdAt,
    );
}
export function stats(sessions: Session[], today = dayKey()) {
  const monday = parseDay(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = dayKey(monday);
  let daily = 0,
    weekly = 0;
  const labels: Record<string, number> = {};
  const days: Record<string, number> = {};
  for (const s of sessions) {
    if (s.type !== "work") continue;
    const day = dayKey(new Date(s.endedAt));
    if (day === today) daily += s.actualMin;
    if (day >= weekStart && day <= today) {
      weekly += s.actualMin;
      labels[s.label || "Etiketsiz"] =
        (labels[s.label || "Etiketsiz"] || 0) + s.actualMin;
      days[day] = (days[day] || 0) + s.actualMin;
    }
  }
  return { daily, weekly, labels, days, weekStart };
}
export function validateTask(t: Task, requireLabel = false) {
  if (!t.title.trim()) return "Bir görev başlığı yaz.";
  if (requireLabel && !t.label.trim())
    return "Etiket zorunlu; bir etiket seç veya yaz.";
  if (t.startAt && !t.scheduledDate) return "Saat aralığı için bir gün seç.";
  if ((t.startAt === null) !== (t.endAt === null))
    return "Başlangıç ve bitiş saatlerini birlikte gir.";
  if (t.startAt && t.endAt && t.endAt <= t.startAt)
    return "Bitiş saati başlangıçtan sonra olmalı.";
  if (t.recurrenceRule && !t.scheduledDate)
    return "Tekrarlayan görev için başlangıç günü seç.";
  if (
    t.recurrenceRule?.frequency === "weekly" &&
    !t.recurrenceRule.weekdays.length
  )
    return "En az bir tekrar günü seç.";
  return null;
}
export function occursOn(task: Task, date: string) {
  const rule = task.recurrenceRule;
  if (!rule || !task.scheduledDate || date < task.scheduledDate) return false;
  const d = parseDay(date);
  return (
    rule.frequency === "daily" ||
    (rule.frequency === "weekly" && rule.weekdays.includes(d.getDay())) ||
    (rule.frequency === "monthly" && rule.monthDay === d.getDate())
  );
}
// Calendar dots can show future recurrence without eagerly creating every instance.
export function calendarPreview(tasks: Task[], date: string) {
  const existing = tasksForDay(tasks, date);
  const projected = tasks
    .filter(
      (t) =>
        occursOn(t, date) &&
        !tasks.some(
          (instance) =>
            instance.seriesId === t.id && instance.scheduledDate === date,
        ),
    )
    .map((t) => ({
      ...t,
      id: `${t.id}@${date}`,
      scheduledDate: date,
      seriesId: t.id,
      recurrenceRule: null,
    }));
  return [...existing, ...projected];
}

// WKWebView on older supported macOS releases may not expose randomUUID or structuredClone.
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const cloneTask = (task: Task): Task => JSON.parse(JSON.stringify(task));

export interface LabelEntry {
  name: string;
  color: string;
}
/** Local calendar days, including zero-focus days, without mutating session history. */
export function dailyTrend(sessions: Session[], today = dayKey(), count = 14) {
  const first = shiftDay(today, -count);
  const totals: Record<string, number> = {};
  for (const session of sessions) {
    if (session.type !== "work") continue;
    const date = dayKey(new Date(session.endedAt));
    if (date >= first && date <= today)
      totals[date] = (totals[date] || 0) + session.actualMin;
  }
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDay(today, i - count + 1);
    const minutes = totals[date] || 0;
    return {
      date,
      minutes,
      delta: minutes - (totals[shiftDay(date, -1)] || 0),
    };
  });
}

export function isPastTask(task: Task, today = dayKey()) {
  const date =
    task.scheduledDate || (task.dueAt ? dayKey(new Date(task.dueAt)) : null);
  return !!date && date < today;
}
export function priorityFor(task: Task, priorities: Record<string, number>) {
  return (
    priorities[task.id] ??
    (task.seriesId ? priorities[task.seriesId] : undefined) ??
    0
  );
}
/** One active occurrence per series, including a lazy preview beyond the reminder horizon. */
export function focusCandidates(tasks: Task[], today = dayKey()) {
  const available = tasks.filter(
    (task) =>
      task.status === "active" &&
      !task.recurrenceRule &&
      !isPastTask(task, today),
  );
  for (const template of tasks.filter(
    (task) =>
      task.status === "active" &&
      task.recurrenceRule &&
      !task.seriesId &&
      task.scheduledDate,
  )) {
    const first =
      template.scheduledDate! > today ? template.scheduledDate! : today;
    for (let offset = 0; offset < 366; offset++) {
      const date = shiftDay(first, offset);
      if (!occursOn(template, date)) continue;
      const existing = tasks.find(
        (task) => task.seriesId === template.id && task.scheduledDate === date,
      );
      if (existing?.status === "completed") continue;
      if (!existing) {
        const shiftTime = (value: number | null) => {
          if (value === null) return null;
          const original = new Date(value),
            shifted = parseDay(date);
          shifted.setHours(
            original.getHours(),
            original.getMinutes(),
            original.getSeconds(),
            original.getMilliseconds(),
          );
          return shifted.getTime();
        };
        const startAt = shiftTime(template.startAt);
        available.push({
          ...template,
          id: `${template.id}@${date}`,
          seriesId: template.id,
          recurrenceRule: null,
          scheduledDate: date,
          startAt,
          endAt:
            startAt !== null &&
            template.endAt !== null &&
            template.startAt !== null
              ? startAt + template.endAt - template.startAt
              : null,
          dueAt: shiftTime(template.dueAt),
          completedAt: null,
          subtasks: template.subtasks.map((subtask) => ({
            ...subtask,
            done: false,
          })),
        });
      }
      break;
    }
  }
  const unique = new Map<string, Task>();
  for (const task of available) {
    const key = task.seriesId ? `series:${task.seriesId}` : `task:${task.id}`;
    const previous = unique.get(key);
    if (
      !previous ||
      (task.scheduledDate || "") < (previous.scheduledDate || "")
    )
      unique.set(key, task);
  }
  return [...unique.values()];
}
/** Today's highest priority first; use the undated list only when today's pool is empty. */
export function recommendFocus(
  candidates: Task[],
  priorities: Record<string, number>,
  today = dayKey(),
  previousTaskId: string | null = null,
) {
  const available = candidates.filter((task) => task.id !== previousTaskId);
  const todayTasks = tasksForDay(available, today);
  const pool = todayTasks.length
    ? todayTasks
    : available.filter((task) => !task.scheduledDate);
  return [...pool].sort(
    (a, b) =>
      priorityFor(b, priorities) - priorityFor(a, priorities) ||
      (a.startAt ?? a.dueAt ?? Infinity) - (b.startAt ?? b.dueAt ?? Infinity) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  )[0];
}
export function taskPomodoroMin(
  task: Task,
  durations: Record<string, number>,
  fallback: number,
) {
  return (
    durations[task.id] ??
    (task.seriesId ? durations[task.seriesId] : undefined) ??
    fallback
  );
}
export function validatePomodoroMin(minutes: number | string) {
  return typeof minutes === "number" &&
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= 90
    ? null
    : "Pomodoro süresi zorunlu; 1–90 arasında tam dakika gir.";
}
export function validatePlanningChange(
  task: Task,
  previous?: Task,
  today = dayKey(),
  now = Date.now(),
) {
  if (
    task.scheduledDate &&
    task.scheduledDate < today &&
    (!previous || previous.scheduledDate !== task.scheduledDate)
  )
    return "Geçmiş bir güne görev planlanamaz. Bugünü veya ileri bir günü seç.";
  const minute = Math.floor(now / 60000) * 60000;
  for (const key of ["startAt", "endAt", "dueAt"] as const) {
    if (
      task[key] !== null &&
      task[key]! < minute &&
      (!previous || task[key] !== previous[key])
    )
      return "Geçmiş bir saate yeni görev planlanamaz.";
  }
  return null;
}
