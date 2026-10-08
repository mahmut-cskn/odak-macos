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
    id: crypto.randomUUID(),
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
export function validateTask(t: Task) {
  if (!t.title.trim()) return "Bir görev başlığı yaz.";
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
