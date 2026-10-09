import { describe, it, expect } from "vitest";
import {
  calendarPreview,
  cloneTask,
  newId,
  dayKey,
  formatMinutes,
  newTask,
  occursOn,
  spent,
  stats,
  tasksForDay,
  validateTask,
  type Session,
  taskPomodoroMin,
  validatePomodoroMin,
  focusCandidates,
  recommendFocus,
} from "../src/domain";
describe("next focus recommendations and unique recurrence choices", () => {
  const task = (id: string, date: string | null) => ({
    ...newTask(date),
    id,
    title: "Same title",
    label: "İş",
    createdAt: 0,
  });
  it("prioritizes today's 5, 4 and 3 stars before a 5-star backlog task", () => {
    const today = "2026-10-09",
      tasks = [
        task("three", today),
        task("four", today),
        task("five", today),
        task("backlog", null),
      ];
    const priorities = { three: 3, four: 4, five: 5, backlog: 5 };
    expect(
      recommendFocus(focusCandidates(tasks, today), priorities, today)?.id,
    ).toBe("five");
    tasks[2].status = "completed";
    expect(
      recommendFocus(focusCandidates(tasks, today), priorities, today)?.id,
    ).toBe("four");
    tasks[1].status = "completed";
    expect(
      recommendFocus(focusCandidates(tasks, today), priorities, today)?.id,
    ).toBe("three");
    tasks[0].status = "completed";
    expect(
      recommendFocus(focusCandidates(tasks, today), priorities, today)?.id,
    ).toBe("backlog");
  });
  it("moves away from the just-finished work without completing or removing its task", () => {
    const today = "2026-10-09",
      tasks = [
        task("previous", today),
        task("next", null),
        task("future", "2026-10-10"),
      ];
    const before = JSON.stringify(tasks);
    expect(
      recommendFocus(
        focusCandidates(tasks, today),
        { previous: 5, next: 4, future: 5 },
        today,
        "previous",
      )?.id,
    ).toBe("next");
    expect(JSON.stringify(tasks)).toBe(before);
    expect(
      recommendFocus(focusCandidates([tasks[2]], today), { future: 5 }, today),
    ).toBeUndefined();
  });
  it("keeps the nearest eligible occurrence per series while preserving different tasks with the same name", () => {
    const instance = (id: string, date: string) => ({
      ...task(id, date),
      seriesId: "weekly",
    });
    const tasks = [
      instance("later", "2026-10-19"),
      instance("past", "2026-10-05"),
      instance("nearest", "2026-10-12"),
      task("separate", null),
    ];
    const before = JSON.stringify(tasks);
    expect(focusCandidates(tasks, "2026-10-09").map((t) => t.id)).toEqual([
      "nearest",
      "separate",
    ]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("previews a monthly task 29 days away instead of its stored instance 59 days away", () => {
    const template = task("monthly", "2026-10-07");
    template.recurrenceRule = {
      frequency: "monthly",
      weekdays: [],
      monthDay: 7,
    };
    const far = {
      ...task("monthly@2026-12-07", "2026-12-07"),
      seriesId: template.id,
    };
    const before = JSON.stringify([template, far]);
    const choices = focusCandidates([template, far], "2026-10-09");
    expect(choices).toHaveLength(1);
    expect(choices[0].id).toBe("monthly@2026-11-07");
    expect(taskPomodoroMin(choices[0], { monthly: 30 }, 45)).toBe(30);
    expect(JSON.stringify([template, far])).toBe(before);
  });
  it("skips a completed recurrence day, shifts its schedule and resets only the preview checklist", () => {
    const template = task("daily", "2026-10-08");
    template.recurrenceRule = { frequency: "daily", weekdays: [], monthDay: 8 };
    template.startAt = new Date("2026-10-08T10:00:00").getTime();
    template.endAt = template.startAt + 60000;
    template.subtasks = [{ id: "step", title: "Check", done: true }];
    const completed = {
      ...task("daily@2026-10-09", "2026-10-09"),
      seriesId: template.id,
      status: "completed" as const,
    };
    const choices = focusCandidates([template, completed], "2026-10-09");
    expect(choices[0].scheduledDate).toBe("2026-10-10");
    expect(dayKey(new Date(choices[0].startAt!))).toBe("2026-10-10");
    expect(choices[0].endAt! - choices[0].startAt!).toBe(60000);
    expect(choices[0].subtasks[0].done).toBe(false);
    expect(template.subtasks[0].done).toBe(true);
  });
  it("skips nonexistent monthly days rather than showing a duplicate future occurrence", () => {
    const template = task("month-end", "2026-01-31");
    template.recurrenceRule = {
      frequency: "monthly",
      weekdays: [],
      monthDay: 31,
    };
    expect(focusCandidates([template], "2026-02-01")[0].scheduledDate).toBe(
      "2026-03-31",
    );
  });
});
describe("task Pomodoro duration", () => {
  it("requires a whole duration within 1–90 and keeps total estimates separate", () => {
    for (const invalid of ["", 0, 91, 1.5])
      expect(validatePomodoroMin(invalid)).toBeTruthy();
    for (const valid of [1, 30, 90])
      expect(validatePomodoroMin(valid)).toBeNull();
    const task = newTask();
    task.estimateMin = 480;
    expect(taskPomodoroMin(task, {}, 45)).toBe(45);
    expect(taskPomodoroMin(task, { [task.id]: 30 }, 45)).toBe(30);
    expect(task.estimateMin).toBe(480);
  });
  it("inherits series durations with an explicit instance override", () => {
    const task = newTask();
    task.seriesId = "series";
    expect(taskPomodoroMin(task, { series: 30 }, 45)).toBe(30);
    expect(taskPomodoroMin(task, { series: 30, [task.id]: 20 }, 45)).toBe(20);
  });
});
describe("task rules", () => {
  it("requires labels for form submission without rejecting historical blank-label records", () => {
    const t = newTask();
    t.title = "Legacy";
    expect(validateTask(t)).toBeNull();
    expect(validateTask(t, true)).toContain("Etiket zorunlu");
    t.label = "   ";
    expect(validateTask(t, true)).toContain("Etiket zorunlu");
    t.label = "İş";
    expect(validateTask(t, true)).toBeNull();
  });
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
  it("counts actual early-finish time in totals, labels and the line graph", async () => {
    const { dailyTrend } = await import("../src/domain");
    const early = { ...session("work", "2026-10-08", 45), actualMin: 12.5 };
    const sessions = [early, session("break", "2026-10-08", 15)];
    expect(spent("a", sessions)).toBe(12.5);
    const summary = stats(sessions, "2026-10-08");
    expect(summary.daily).toBe(12.5);
    expect(summary.weekly).toBe(12.5);
    expect(summary.labels["İş"]).toBe(12.5);
    expect(dailyTrend(sessions, "2026-10-08").at(-1)?.minutes).toBe(12.5);
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

describe("older WebView compatibility", () => {
  it("generates unique version-four UUIDs when randomUUID is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      const a = newId(),
        b = newId();
      expect(a).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(a).not.toBe(b);
    } finally {
      if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
      else delete (crypto as any).randomUUID;
    }
  });
  it("copies task notes and checklist without sharing nested state", () => {
    const a = newTask();
    a.subtasks = [{ id: "s", title: "Step", done: false }];
    const b = cloneTask(a);
    b.subtasks[0].done = true;
    expect(a.subtasks[0].done).toBe(false);
  });
});

describe("daily focus trend", () => {
  it("includes zero days, compares previous day and counts local completion dates", async () => {
    const { dailyTrend } = await import("../src/domain");
    const sessions: Session[] = [
      {
        id: "a",
        taskId: null,
        type: "work",
        startedAt: 0,
        endedAt: new Date("2026-10-06T23:59:00").getTime(),
        plannedMin: 45,
        actualMin: 45,
        label: "",
      },
      {
        id: "b",
        taskId: "task",
        type: "work",
        startedAt: 0,
        endedAt: new Date("2026-10-07T01:00:00").getTime(),
        plannedMin: 90,
        actualMin: 90,
        label: "İş",
      },
      {
        id: "c",
        taskId: "task",
        type: "break",
        startedAt: 0,
        endedAt: new Date("2026-10-08T10:00:00").getTime(),
        plannedMin: 15,
        actualMin: 15,
        label: "İş",
      },
      {
        id: "d",
        taskId: "task",
        type: "work",
        startedAt: 0,
        endedAt: new Date("2026-10-09T10:00:00").getTime(),
        plannedMin: 45,
        actualMin: 45,
        label: "İş",
      },
    ];
    const before = JSON.stringify(sessions);
    expect(dailyTrend(sessions, "2026-10-08", 2)).toEqual([
      { date: "2026-10-07", minutes: 90, delta: 45 },
      { date: "2026-10-08", minutes: 0, delta: -90 },
    ]);
    expect(JSON.stringify(sessions)).toBe(before);
  });
});

describe("past planning and optional priority", () => {
  it("preserves unchanged history but rejects new past dates and times", async () => {
    const { validatePlanningChange, isPastTask } =
      await import("../src/domain");
    const old = newTask("2026-10-07");
    old.title = "History";
    const now = new Date("2026-10-08T14:30:30").getTime();
    expect(
      validatePlanningChange(old, undefined, "2026-10-08", now),
    ).toBeTruthy();
    expect(validatePlanningChange(old, old, "2026-10-08", now)).toBeNull();
    expect(isPastTask(old, "2026-10-08")).toBe(true);
    const today = { ...old, scheduledDate: "2026-10-08" };
    expect(isPastTask(today, "2026-10-08")).toBe(false);
    expect(validatePlanningChange(today, old, "2026-10-08", now)).toBeNull();
    today.dueAt = now - 120000;
    expect(validatePlanningChange(today, old, "2026-10-08", now)).toBeTruthy();
  });
  it("inherits recurring series priority until an instance is explicitly rated", async () => {
    const { priorityFor } = await import("../src/domain");
    const instance = newTask("2026-10-09");
    instance.seriesId = "series";
    const before = JSON.stringify(instance);
    expect(priorityFor(instance, {})).toBe(0);
    expect(priorityFor(instance, { series: 5 })).toBe(5);
    expect(priorityFor(instance, { series: 5, [instance.id]: 2 })).toBe(2);
    expect(JSON.stringify(instance)).toBe(before);
  });
});
