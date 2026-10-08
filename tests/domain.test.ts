import { describe, it, expect } from "vitest";
import {
  calendarPreview,
  dayKey,
  formatMinutes,
  newTask,
  occursOn,
  spent,
  stats,
  tasksForDay,
  validateTask,
  type Session,
} from "../src/domain";
describe("task rules", () => {
  it("allows undated and unlimited tasks", () => {
    const t = newTask();
    t.title = "Rapor";
    expect(validateTask(t)).toBeNull();
    expect(t.scheduledDate).toBeNull();
    expect(t.estimateMin).toBeNull();
  });
  it("rejects incomplete and inverted schedule ranges", () => {
    const t = newTask("2026-10-08");
    t.title = "Plan";
    t.startAt = 100;
    expect(validateTask(t)).toBeTruthy();
    t.endAt = 50;
    expect(validateTask(t)).toBeTruthy();
    t.endAt = 200;
    expect(validateTask(t)).toBeNull();
  });
  it("includes completed tasks on a historical calendar day", () => {
    const t = newTask("2026-10-07");
    t.status = "completed";
    t.completedAt = Date.now();
    expect(tasksForDay([t], "2026-10-07")).toEqual([t]);
  });
  it("finds a deadline task without a scheduled day", () => {
    const t = newTask();
    t.dueAt = new Date("2026-10-08T18:00:00").getTime();
    expect(tasksForDay([t], "2026-10-08")).toEqual([t]);
  });
  it("supports selected weekly weekdays and start boundaries", () => {
    const t = newTask("2026-10-08");
    t.recurrenceRule = { frequency: "weekly", weekdays: [5], monthDay: 8 };
    expect(occursOn(t, "2026-10-09")).toBe(true);
    expect(occursOn(t, "2026-10-08")).toBe(false);
    expect(occursOn(t, "2026-10-02")).toBe(false);
  });
});
describe("completed session accounting", () => {
  const session = (
    type: "work" | "break",
    date: string,
    minutes: number,
  ): Session => ({
    id: crypto.randomUUID(),
    taskId: "a",
    type,
    startedAt: new Date(`${date}T10:00:00`).getTime(),
    endedAt: new Date(`${date}T11:00:00`).getTime(),
    plannedMin: minutes,
    actualMin: minutes,
    label: "İş",
  });
  it("counts work only, without an estimate", () => {
    expect(
      spent("a", [
        session("work", "2026-10-08", 45),
        session("break", "2026-10-08", 15),
      ]),
    ).toBe(45);
  });
  it("uses Monday-based local calendar weeks and excludes future sessions", () => {
    const s = stats(
      [
        session("work", "2026-10-08", 45),
        session("work", "2026-10-05", 30),
        session("work", "2026-10-04", 90),
        session("work", "2026-10-09", 45),
        session("break", "2026-10-08", 15),
      ],
      "2026-10-08",
    );
    expect(s.daily).toBe(45);
    expect(s.weekly).toBe(75);
    expect(s.labels["İş"]).toBe(75);
  });
  it("formats accumulated hours", () => {
    expect(formatMinutes(195)).toBe("3sa 15dk");
    expect(dayKey(new Date(2026, 9, 8))).toBe("2026-10-08");
  });
});

describe("lazy calendar recurrence preview", () => {
  it("shows future rules without duplicating an existing completed instance", () => {
    const template = newTask("2026-10-08");
    template.recurrenceRule = { frequency: "daily", weekdays: [], monthDay: 8 };
    expect(calendarPreview([template], "2026-10-20")).toHaveLength(1);
    const instance = {
      ...template,
      id: `${template.id}@2026-10-20`,
      seriesId: template.id,
      scheduledDate: "2026-10-20",
      recurrenceRule: null,
      status: "completed" as const,
      completedAt: 1,
    };
    expect(calendarPreview([template, instance], "2026-10-20")).toEqual([
      instance,
    ]);
    expect(template.recurrenceRule).not.toBeNull();
  });
});

describe("completion calendar history", () => {
  it("shows an undated task on its completion day without assigning it a date", () => {
    const t = newTask();
    t.status = "completed";
    t.completedAt = new Date("2026-10-07T18:00:00").getTime();
    expect(tasksForDay([t], "2026-10-07")).toEqual([t]);
    expect(t.scheduledDate).toBeNull();
  });
});
