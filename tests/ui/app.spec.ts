import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const callbacks: Record<string, ((p: any) => void)[]> = {};
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const task = (
      id: string,
      title: string,
      scheduledDate: string | null,
      label: string,
    ) => ({
      id,
      title,
      scheduledDate,
      label,
      color: label === "Okul" ? "#8e78a5" : "#438470",
      notes: "",
      status: "active",
      completedAt: null,
      estimateMin: null,
      startAt: null,
      endAt: null,
      dueAt: null,
      recurrenceRule: null,
      seriesId: null,
      subtasks: [],
      createdAt: Date.now(),
    });
    const data: any = {
      tasks: [
        task("report", "Rapor yaz", today(), "İş"),
        task("slides", "Sunum hazırla", today(), "Okul"),
        task("backlog", "Kitap oku", null, "Kişisel"),
      ],
      sessions: [],
      timer: {
        taskId: null,
        phase: "idle",
        pausedPhase: null,
        startedAt: null,
        pausedAt: null,
        pausedAccumulatedMs: 0,
        workMin: 45,
        breakMin: 15,
        plannedMin: 45,
        breakReady: false,
      },
      settings: {
        defaultWorkMin: 45,
        defaultBreakMin: 15,
        soundEnabled: true,
        soundVolume: 0.5,
        quietMode: false,
        notifyLeadMin: 15,
        quickAddShortcut: "CmdOrCtrl+Shift+K",
        launchAtLogin: true,
      },
      notified: [],
    };
    const catalog: { name: string; color: string }[] = [];
    const hidden = new Set<string>();
    const priorities: Record<string, number> = {};
    const taskDurations: Record<string, number> = {};
    const calls: { cmd: string; args: any }[] = [];
    data.suspendedWork = {};
    const remaining = (timer: any, now = Date.now()) =>
      timer.phase === "idle"
        ? 0
        : Math.max(
            0,
            (timer.workBudgetMs ?? timer.plannedMin * 60000) -
              Math.max(
                0,
                (timer.pausedAt ?? now) -
                  timer.startedAt -
                  timer.pausedAccumulatedMs,
              ),
          );
    const snapshot = () => ({
      labels: [
        ...new Map([
          ...data.tasks
            .filter((t: any) => t.label)
            .map((t: any) => [t.label, { name: t.label, color: t.color }]),
          ...catalog.map((l) => [l.name, l]),
        ]).values(),
      ].filter((l: any) => !hidden.has(l.name)),
      priorities: { ...priorities },
      taskDurations: { ...taskDurations },
      data: structuredClone(data),
      remainingMs: remaining(data.timer),
      databasePath:
        "~/Library/Application Support/com.mahmutcskn.odak/odak.sqlite3",
      serviceError: null,
    });
    (window as any).odakFixture = data;
    (window as any).odakCalls = calls;
    (window as any).odakNotify = () =>
      (callbacks["data-changed"] || []).forEach((fn) => fn(null));
    (window as any).odakTestApi = {
      listen: async (event: string, fn: (p: any) => void) => {
        (callbacks[event] ??= []).push(fn);
        return () => {
          callbacks[event] = callbacks[event].filter((f) => f !== fn);
        };
      },
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === "snapshot") return snapshot();
        if (cmd === "request_notification_permission") return null;
        if (cmd === "drive_backup_status")
          return { configured: true, lastUploadedAt: new Date().toISOString() };
        if (cmd === "export_backup") return "/tmp/odak-yedek.json";
        if (cmd === "import_backup") return "/tmp/recovery.json";
        if (cmd === "inspect_database")
          return {
            ...snapshot(),
            prioritySource: "SQLite",
            integrity: "ok",
            inspectedAt: Date.now(),
          };
        const p = args.payload;
        if (
          [
            "delete_task",
            "delete_label",
            "cancel",
            "finish",
            "switch_task",
          ].includes(args.action) &&
          !p.confirmed
        )
          throw new Error("Onay gerekli.");
        switch (args.action) {
          case "save_task": {
            const i = data.tasks.findIndex((t: any) => t.id === p.id);
            const { pomodoroMin, confirmedSeriesChange, ...task } = p;
            if (
              (i === -1 || task.label !== data.tasks[i].label) &&
              !task.label.trim()
            )
              throw new Error("Etiket zorunlu.");
            if (
              (i === -1 || pomodoroMin !== undefined) &&
              (!Number.isInteger(pomodoroMin) ||
                pomodoroMin < 1 ||
                pomodoroMin > 90)
            )
              throw new Error("Pomodoro süresi zorunlu.");
            if (pomodoroMin !== undefined) taskDurations[p.id] = pomodoroMin;
            if (i === -1) data.tasks.push(task);
            else data.tasks[i] = task;
            break;
          }
          case "set_priority":
            {
              const task = data.tasks.find((task: any) => task.id === p.id),
                parent = data.tasks.find(
                  (parent: any) =>
                    parent.id === task?.seriesId &&
                    parent.recurrenceRule &&
                    parent.kind !== "deadline",
                );
              priorities[parent?.id || p.id] = p.rating;
            }
            break;
          case "rename_task":
            data.tasks.find((t: any) => t.id === p.id).title = p.title.trim();
            break;
          case "set_subtask": {
            const task = data.tasks.find(
              (task: any) => task.id === p.taskId && task.status === "active",
            );
            if (!task) throw new Error("Aktif görev bulunamadı.");
            task.subtasks.find(
              (subtask: any) => subtask.id === p.subtaskId,
            ).done = p.done;
            break;
          }
          case "save_label":
            hidden.delete(p.name);
            catalog.push(p);
            break;
          case "delete_label":
            hidden.add(p.name);
            break;
          case "toggle_task": {
            const t = data.tasks.find((t: any) => t.id === p.id);
            t.status = t.status === "active" ? "completed" : "active";
            t.completedAt = t.status === "completed" ? Date.now() : null;
            break;
          }
          case "delete_task":
            data.tasks = data.tasks.filter((t: any) => t.id !== p.id);
            break;
          case "switch_task": {
            const timer = data.timer,
              now = Date.now();
            if (
              timer.taskId !== p.fromTaskId ||
              timer.startedAt !== p.startedAt
            )
              throw new Error("Oturum değişti.");
            if (timer.phase === "work" || timer.pausedPhase === "work") {
              const left = remaining(timer, now),
                elapsed =
                  (timer.workBudgetMs ?? timer.plannedMin * 60000) - left;
              if (elapsed > 0)
                data.sessions.push({
                  id: crypto.randomUUID(),
                  taskId: timer.taskId,
                  type: "work",
                  startedAt: timer.startedAt,
                  endedAt: now,
                  plannedMin: timer.plannedMin,
                  actualMin: elapsed / 60000,
                  label: data.tasks.find(
                    (task: any) => task.id === timer.taskId,
                  ).label,
                  outcome: "switched",
                });
              if (left > 0)
                data.suspendedWork[timer.taskId] = {
                  remainingMs: left,
                  plannedMin: timer.plannedMin,
                };
            }
          }
          case "start": {
            if (!p.taskId) throw new Error("Bir görev seçin.");
            if (!data.tasks.some((task: any) => task.id === p.taskId)) {
              const [seriesId, scheduledDate] = p.taskId.split("@");
              const template = data.tasks.find(
                (task: any) => task.id === seriesId && task.recurrenceRule,
              );
              if (!template) throw new Error("Görev bulunamadı.");
              data.tasks.push({
                ...template,
                id: p.taskId,
                seriesId,
                scheduledDate,
                recurrenceRule: null,
                status: "active",
                completedAt: null,
                subtasks: template.subtasks.map((subtask: any) => ({
                  ...subtask,
                  done: false,
                })),
              });
            }
            const pending = data.suspendedWork[p.taskId];
            delete data.suspendedWork[p.taskId];
            data.timer = {
              ...data.timer,
              taskId: p.taskId,
              workMin: pending?.plannedMin ?? p.workMin,
              breakMin: p.breakMin,
              phase: "work",
              plannedMin: pending?.plannedMin ?? p.workMin,
              workBudgetMs: pending?.remainingMs,
              startedAt: Date.now() - ((window as any).odakStartOffset || 0),
              pausedPhase: null,
              pausedAt: null,
              pausedAccumulatedMs: 0,
              breakReady: false,
            };
            break;
          }
          case "pause":
            data.timer.pausedPhase = data.timer.phase;
            data.timer.phase = "paused";
            data.timer.pausedAt = Date.now();
            break;
          case "resume":
            data.timer.pausedAccumulatedMs += Date.now() - data.timer.pausedAt;
            data.timer.pausedAt = null;
            data.timer.phase = data.timer.pausedPhase;
            data.timer.pausedPhase = null;
            break;
          case "finish": {
            const timer = data.timer;
            if (timer.taskId !== p.taskId || timer.startedAt !== p.startedAt)
              throw new Error("Oturum değişti.");
            const now = Date.now();
            const task = data.tasks.find((t: any) => t.id === p.taskId);
            if (timer.phase === "work" || timer.pausedPhase === "work") {
              const elapsed = Math.max(
                0,
                Math.min(
                  timer.workBudgetMs ?? timer.plannedMin * 60000,
                  (timer.pausedAt ?? now) -
                    timer.startedAt -
                    timer.pausedAccumulatedMs,
                ),
              );
              data.sessions.push({
                id: crypto.randomUUID(),
                taskId: p.taskId,
                type: "work",
                startedAt: timer.startedAt,
                endedAt: now,
                plannedMin: timer.plannedMin,
                actualMin: elapsed / 60000,
                label: task.label,
                outcome: "finished",
              });
            }
            delete data.suspendedWork[task.id];
            task.status = "completed";
            task.completedAt = now;
            Object.assign(timer, {
              phase: "idle",
              taskId: null,
              startedAt: null,
              pausedAt: null,
              pausedPhase: null,
              pausedAccumulatedMs: 0,
              breakReady: false,
            });
            break;
          }
          case "cancel":
            if (
              (data.timer.phase === "work" ||
                data.timer.pausedPhase === "work") &&
              data.timer.workBudgetMs
            )
              data.suspendedWork[data.timer.taskId] = {
                remainingMs: data.timer.workBudgetMs,
                plannedMin: data.timer.plannedMin,
              };
            data.timer.phase = "idle";
            data.timer.taskId = null;
            break;
          case "settings":
            data.settings = p;
            break;
        }
        (callbacks["data-changed"] || []).forEach((fn) => fn(null));
        return snapshot();
      },
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bugünün gündemi" }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => setup(page));
test("creates an undated task and moves it to today", async ({ page }) => {
  await page
    .getByRole("button", { name: "Liste", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("API tasarımı");
  await page.getByLabel("Etiket", { exact: true }).fill("İş");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "API tasarımı", exact: true }),
  ).toBeVisible();
  await page.getByLabel("API tasarımı: seçenekler").click();
  await page.getByRole("button", { name: "Bugüne taşı", exact: true }).click();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "API tasarımı", exact: true }),
  ).toBeVisible();
});
test("manual complete and restore retain the original day", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: tamamla").click();
  await expect(
    page.getByRole("button", { name: "Rapor yaz", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await page.getByLabel("Rapor yaz: geri al").click();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rapor yaz", exact: true }),
  ).toBeVisible();
});
test("timer supports bounds, task start, pause, resume and cancellation", async ({
  page,
}) => {
  await page.getByLabel("Odaklanılacak görev").selectOption("report");
  await page.getByLabel("Çalışma süresi", { exact: true }).fill("91");
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  await expect(page.getByRole("alert")).toContainText("1–90");
  await page.getByLabel("Çalışma süresi", { exact: true }).fill("45");
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  await expect(page.getByText("DURAKLATILDI")).toBeVisible();
  await page.getByRole("button", { name: "Devam et", exact: true }).click();
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, onayla" })
    .click();
  await expect(page.getByLabel("Rapor yaz: tamamla")).toBeVisible();
  await expect(page.getByText("Toplam 45dk")).toHaveCount(0);
});
test("adds a future scheduled task from the selected calendar day", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Takvim", exact: true }).click();
  await page.getByLabel("Sonraki ay").click();
  const dates = page.locator(".calendar-grid button");
  const day = await dates.nth(13).getAttribute("aria-label");
  await dates.nth(13).click();
  await page.getByRole("button", { name: "Bu güne görev ekle" }).click();
  await expect(page.getByLabel("Gün", { exact: true })).toHaveCount(0);
  await page.getByLabel("Başlık", { exact: true }).fill("Lab kurulumu");
  await page.getByLabel("Etiket", { exact: true }).fill("Lab");
  await page.getByLabel("Görev türü", { exact: true }).selectOption("deadline");
  await page
    .getByLabel("Son bitirme tarihi", { exact: true })
    .fill(`${day}T14:00`);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lab kurulumu", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Lab kurulumu: görev kartı", { exact: true }),
  ).toContainText("14:00");
});
test("subtasks suggest completion and label filters work", async ({ page }) => {
  await page
    .getByRole("button", { name: "Sunum hazırla", exact: true })
    .click();
  await page.getByLabel("Alt görev ekle").fill("Slaytlar");
  await page.getByLabel("Alt görev kaydet").click();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByLabel("Slaytlar", { exact: true }).check();
  await expect(
    page.getByText("Alt görevler bitti.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Sunum hazırla: tamamla")).toBeVisible();
  await page.getByLabel("Etiket filtresi").selectOption("Okul");
  await expect(
    page.getByRole("button", { name: "Rapor yaz", exact: true }),
  ).toHaveCount(0);
});
test("settings save bounds, quiet mode and shortcut; UI screenshots", async ({
  page,
}) => {
  await page.screenshot({ path: "docs/screenshot-light.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(25, 34, 29)",
  );
  await expect(page.locator(".task-title").first()).toHaveCSS(
    "color",
    "rgb(219, 228, 215)",
  );
  await expect(page.locator(".add-button")).toHaveCSS(
    "background-color",
    "rgb(32, 44, 36)",
  );
  await page.screenshot({ path: "docs/screenshot-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Ayarlar", { exact: true }).click();
  await page.getByLabel("Varsayılan çalışma", { exact: true }).fill("90");
  await page.getByLabel("Sessiz mod", { exact: false }).check();
  await page.getByLabel("Hızlı görev kısayolu").fill("CmdOrCtrl+Shift+O");
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(
    page.getByRole("button", { name: "Ayarlar kaydedildi" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "90",
  );
});

test("recommended focus remains named; inline title edit keeps the timer untouched", async ({
  page,
}) => {
  await expect(page.locator(".brand-name")).toHaveText("Odak");
  await expect(
    page.getByRole("button", { name: "Odaklanmaya başla" }),
  ).toBeEnabled();
  await page.getByLabel("Odaklanılacak görev").selectOption("report");
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Odak görev adını düzenle").click();
  await expect(page.getByLabel("Odak görev adı")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Odak görev adı").fill("Raporun son düzenlemesi");
  await page.getByLabel("Görev adını kaydet").click();
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data.timer).toEqual(before.data.timer);
  const expected = structuredClone(before.data.tasks);
  expected[0].title = "Raporun son düzenlemesi";
  expect(after.data.tasks).toEqual(expected);
  await expect(page.getByText("Tek iş, bütün dikkatin.")).toHaveCount(0);
});

test("starts a new named task through the existing New task button", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "Yeni görevle başla" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveClass(
    "required-field",
  );
  await page.getByLabel("Başlık", { exact: true }).fill("Yeni odak işi");
  await page.getByLabel("Etiket", { exact: true }).fill("İş");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Odaklanmaya başla" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  await expect(
    page.getByRole("button", { name: "Duraklat", exact: true }),
  ).toBeVisible();
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const task = state.data.tasks.find((t: any) => t.title === "Yeni odak işi");
  expect(state.data.timer.taskId).toBe(task.id);
  expect(task.status).toBe("active");
});

test("label management preserves old task payloads and remains available in filters", async ({
  page,
}) => {
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Ayarlar", { exact: true }).click();
  await page.getByLabel("Yeni etiket adı").fill("Araştırma");
  await page.getByLabel("Yeni etiket rengi").fill("#d28567");
  await page.getByRole("button", { name: "Etiket oluştur" }).click();
  await expect(page.getByLabel("Araştırma: etiketi sil")).toBeVisible();
  await page.getByLabel("İş: etiketi sil").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, onayla" })
    .click();
  await expect(page.getByLabel("İş: etiketi sil")).toHaveCount(0);
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await page.getByLabel("Etiket filtresi").selectOption("İş");
  await expect(
    page.getByRole("button", { name: "Rapor yaz", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await expect(
    page.locator("datalist option").filter({ hasText: "Araştırma" }),
  ).toHaveCount(1);
  await expect(
    page.locator("datalist option").filter({ hasText: "İş" }),
  ).toHaveCount(0);
});

test("completed section exposes legacy free sessions without completing tasks", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).odakFixture.sessions.push({
      id: "legacy",
      taskId: null,
      type: "work",
      startedAt: Date.now() - 2700000,
      endedAt: Date.now(),
      actualMin: 45,
      plannedMin: 45,
      label: "",
    });
    (window as any).odakNotify();
  });
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(
    page.getByText("Önceki görevsiz odak", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-history-row")).toContainText("45dk");
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(state.data.tasks.every((t: any) => t.status === "active")).toBe(true);
});

test("adds trend chart without removing existing charts and fills required recurrence day", async ({
  page,
}) => {
  await page.evaluate(() => {
    const values = [25, 0, 45, 75, 30, 60, 45, 90, 45, 60, 0, 45, 90, 135];
    for (let i = 0; i < values.length; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i - 13);
      date.setHours(14, 0, 0, 0);
      let minutes = values[i];
      let index = 0;
      while (minutes > 0) {
        const actualMin = Math.min(90, minutes);
        (window as any).odakFixture.sessions.push({
          id: `stats-${i}-${index++}`,
          taskId: "report",
          type: "work",
          startedAt: date.getTime() - actualMin * 60000,
          endedAt: date.getTime(),
          actualMin,
          plannedMin: actualMin,
          label: i % 2 ? "İş" : "Okul",
        });
        minutes -= actualMin;
      }
    }
    (window as any).odakNotify();
  });
  await page.getByLabel("İstatistik", { exact: true }).click();
  await expect(page.locator(".week-chart")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Etikete göre/ }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Günlük odak çizgi grafiği", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trend-hit")).toHaveCount(14);
  await page.locator(".trend-hit").nth(4).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".trend-hit").nth(4)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: "docs/screenshot-stats.png", fullPage: true });
  await page
    .getByRole("button", { name: "Liste", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await expect(page.getByLabel("Gün", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Görev türü", { exact: true })
    .selectOption("recurring");
  await page.getByLabel("Tekrar", { exact: true }).selectOption("daily");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect(page.getByLabel("Gün", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Ana görevle aynı gün:", { exact: false }),
  ).toBeVisible();
});

test("timer panel stays on Today and List while Calendar and Completed remain clear", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: başlat").click();
  for (const name of ["Takvim", "Tamamlanan"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".timer-card")).toHaveCount(0);
    const state: any = await page.evaluate(() =>
      (window as any).odakTestApi.invoke("snapshot"),
    );
    expect(state.data.timer.phase).toBe("work");
  }
  await page
    .getByRole("button", { name: "Liste", exact: false })
    .first()
    .click();
  await expect(page.locator(".timer-card")).toBeVisible();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(page.locator(".timer-card")).toBeVisible();
});

test("past calendar is read-only and never requests historical materialization", async ({
  page,
}) => {
  const date = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const old = structuredClone((window as any).odakFixture.tasks[0]);
    Object.assign(old, {
      id: "history",
      title: "Eski rapor",
      status: "completed",
      scheduledDate: yesterday,
      completedAt: d.getTime(),
      subtasks: [{ id: "step", title: "Geçmiş adım", done: false }],
    });
    (window as any).odakFixture.tasks.push(old);
    (window as any).odakNotify();
    return yesterday;
  });
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByRole("button", { name: "Takvim", exact: true }).click();
  await page.getByRole("button", { name: date, exact: true }).click();
  await expect(
    page.getByText("Geçmiş · salt okunur", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Eski rapor", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Yeni görev", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bu güne görev ekle" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Hızlı ekle", exact: false }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Eski rapor: geri al")).toHaveCount(0);
  await expect(page.getByLabel("Eski rapor: seçenekler")).toHaveCount(0);
  await page
    .getByLabel("Eski rapor: tamamlanan detayları", { exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Tamamlanan görev detayları" }),
  ).toContainText("Geçmiş adım");
  await expect(
    page.getByRole("dialog").locator("input, textarea, select"),
  ).toHaveCount(0);
  await page.getByLabel("Detayları kapat").click();
  await page.screenshot({
    path: "docs/screenshot-history.png",
    fullPage: true,
  });
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  const calls = await page.evaluate(() => (window as any).odakCalls);
  expect(
    calls.some(
      (call: any) =>
        call.args?.action === "ensure_day" && call.args.payload.date === date,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Bugün", exact: true }).last().click();
  await expect(
    page.getByRole("button", { name: "Bu güne görev ekle" }),
  ).toBeVisible();
});

test("task, subtask, label, timer and import deletions require a cancellable confirmation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Rapor yaz", exact: true }).click();
  await page.getByLabel("Alt görev ekle").fill("Bir adım");
  await page.getByLabel("Alt görev kaydet").click();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("button", { name: "Rapor yaz", exact: true }).click();
  await page.getByLabel("Bir adım: sil").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Görev düzenle" }),
  ).toBeVisible();
  await expect(page.getByLabel("Bir adım: sil")).toBeVisible();
  await page.getByLabel("Bir adım: sil").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, onayla" })
    .click();
  await expect(page.getByLabel("Bir adım: sil")).toHaveCount(0);
  await page.getByRole("button", { name: "Görevi sil", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vazgeç" })
    .click();
  const current: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(current.data.tasks.some((t: any) => t.id === "report")).toBe(true);
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vazgeç" })
    .click();
  await expect(
    page.getByRole("button", { name: "Duraklat", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, onayla" })
    .click();
  await page.getByLabel("Ayarlar", { exact: true }).click();
  await page.getByLabel("İş: etiketi sil").click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vazgeç" })
    .click();
  await expect(page.getByLabel("İş: etiketi sil")).toBeVisible();
  await page
    .getByRole("button", { name: "JSON içe aktar", exact: true })
    .click();
  const beforeCancel = await page.evaluate(() =>
    (window as any).odakCalls.filter((c: any) => c.cmd === "import_backup"),
  );
  expect(beforeCancel).toHaveLength(0);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vazgeç" })
    .click();
  const afterCancel = await page.evaluate(() =>
    (window as any).odakCalls.filter((c: any) => c.cmd === "import_backup"),
  );
  expect(afterCancel).toHaveLength(0);
});

test("priority stars preview, save and sort without altering task payloads", async ({
  page,
}) => {
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const stars = page.getByRole("radiogroup", {
    name: "Rapor yaz: öncelik",
    exact: true,
  });
  await stars
    .getByRole("radio", { name: "Rapor yaz: 4 yıldız", exact: true })
    .hover();
  await expect(stars.locator(".star-button.lit")).toHaveCount(4);
  await stars
    .getByRole("radio", { name: "Rapor yaz: 4 yıldız", exact: true })
    .click();
  await expect(
    stars.getByRole("radio", { name: "Rapor yaz: 4 yıldız", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("radiogroup", { name: "Sunum hazırla: öncelik", exact: true })
    .getByRole("radio", { name: "Sunum hazırla: 5 yıldız", exact: true })
    .click();
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  expect(after.priorities).toEqual({ report: 4, slides: 5 });
  await page.getByLabel("Görev sıralaması").selectOption("priority");
  await expect(page.locator(".task-list .task-title").first()).toHaveText(
    "Sunum hazırla",
  );
  await page
    .getByRole("button", { name: "Sunum hazırla", exact: true })
    .click();
  const editorStars = page.getByRole("dialog").getByRole("radiogroup");
  await editorStars
    .getByRole("radio", { name: "Sunum hazırla: 2 yıldız", exact: true })
    .click();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  const edited: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(edited.priorities.slides).toBe(2);
});

test("recurring task labels use prominent badges and series priority is selectable", async ({
  page,
}) => {
  await page.evaluate(() => {
    const series = structuredClone((window as any).odakFixture.tasks[0]);
    Object.assign(series, {
      id: "series",
      title: "Günlük yazı",
      recurrenceRule: { frequency: "daily", weekdays: [], monthDay: 8 },
    });
    (window as any).odakFixture.tasks.push(series);
    (window as any).odakNotify();
  });
  await page.getByRole("button", { name: "Tekrarlayan", exact: true }).click();
  await expect(page.locator(".series-row .label-tag")).toHaveText("İş");
  await page
    .getByRole("radiogroup", { name: "Günlük yazı: öncelik", exact: true })
    .getByRole("radio", { name: "Günlük yazı: 5 yıldız", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshot-priority.png",
    fullPage: true,
  });
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(state.priorities.series).toBe(5);
});

test("requires a task Pomodoro duration and row start uses 30 minutes independently of total estimate", async ({
  page,
}) => {
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("Otuz dakikalık iş");
  await page.getByLabel("Etiket", { exact: true }).fill("İş");
  const duration = page.getByLabel("Pomodoro süresi", { exact: true });
  await expect(duration).toHaveAttribute("required", "");
  await expect(duration).toHaveClass("required-field");
  for (const invalid of ["", "0", "91", "1.5"]) {
    await duration.fill(invalid);
    expect(
      await duration.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).odakFixture.tasks.length),
    ).toBe(3);
  }
  await duration.fill("30");
  await expect(page.getByLabel("Tahmini süre", { exact: true })).toHaveCount(0);
  await page.locator(".modal").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: "docs/screenshot-task-duration.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "30",
  );
  await page.getByLabel("Çalışma süresi", { exact: true }).fill("45");
  await page.getByLabel("Otuz dakikalık iş: başlat").click();
  await expect(page.locator(".timer-number")).toHaveText("30:00");
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const task = state.data.tasks.find(
    (t: any) => t.title === "Otuz dakikalık iş",
  );
  expect(state.taskDurations[task.id]).toBe(30);
  expect(task.estimateMin).toBeNull();
  expect(task.pomodoroMin).toBeUndefined();
  expect(state.data.tasks.filter((t: any) => t.id !== task.id)).toEqual(
    before.data.tasks,
  );
  expect(state.data.timer.plannedMin).toBe(30);
  expect(state.data.sessions).toEqual(before.data.sessions);
  await expect(page.getByLabel("Odaklanılacak görev")).toBeVisible();
  await expect(page.getByLabel("Odaklanılacak görev")).toBeDisabled();
  await page
    .locator(".timer-card")
    .screenshot({ path: "docs/screenshot-focus-duration.png" });
});

test("task dropdown remains visible during work and pause and switches the next task after break", async ({
  page,
}) => {
  const picker = page.getByLabel("Odaklanılacak görev");
  await expect(picker).toBeVisible();
  await picker.selectOption("report");
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  await expect(picker).toBeVisible();
  await expect(picker).toBeDisabled();
  await expect(picker).toHaveValue("report");
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(picker).toBeDisabled();
  await page.evaluate(async () => {
    const fixture = (window as any).odakFixture;
    await (window as any).odakTestApi.invoke("command", {
      action: "save_task",
      payload: {
        ...fixture.tasks[0],
        id: "next-task",
        title: "Sıradaki iş",
        pomodoroMin: 30,
      },
    });
    Object.assign(fixture.timer, {
      phase: "idle",
      pausedPhase: null,
      startedAt: null,
      pausedAt: null,
      breakReady: true,
    });
    (window as any).odakNotify();
  });
  await expect(page.getByText("MOLA BİTTİ", { exact: true })).toBeVisible();
  await expect(picker).toBeEnabled();
  await picker.selectOption("next-task");
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "30",
  );
  await page.getByRole("button", { name: "Devam et", exact: true }).click();
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(state.data.timer.taskId).toBe("next-task");
  expect(state.data.timer.plannedMin).toBe(30);
  expect(state.data.sessions).toEqual([]);
});

test("editing a task duration preserves a running timer and all existing task fields", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: başlat").click();
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByRole("button", { name: "Rapor yaz", exact: true }).click();
  await page.getByLabel("Pomodoro süresi", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  expect(after.taskDurations.report).toBe(30);
  await expect(page.locator(".timer-number")).toHaveText("45:00");
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "45",
  );
  await page.getByRole("button", { name: "İptal et", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, onayla" })
    .click();
  await page.getByLabel("Rapor yaz: başlat").click();
  await expect(page.locator(".timer-number")).toHaveText("30:00");
});

test("quick add also requires a Pomodoro duration", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "quick" } },
      invoke: async () => null,
    };
  });
  await page.goto("/?quick=1");
  await page.getByLabel("Görev başlığı").fill("Hızlı otuz dakika");
  await page.getByLabel("Etiket", { exact: true }).fill("İş");
  const duration = page.getByLabel("Pomodoro süresi", { exact: true });
  await duration.fill("");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).odakFixture.tasks.length),
  ).toBe(3);
  await duration.fill("30");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Görev başlığı")).toHaveValue("");
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const task = state.data.tasks.find(
    (t: any) => t.title === "Hızlı otuz dakika",
  );
  expect(task.scheduledDate).toBeNull();
  expect(state.taskDurations[task.id]).toBe(30);
});

test("finish asks permission, records elapsed work in graphs, completes the task and allows undo", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).odakStartOffset = 20 * 60000;
  });
  await page.getByLabel("Rapor yaz: başlat").click();
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "gerçekten çalıştığın süre",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Vazgeç", exact: true })
    .click();
  const cancelled: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(cancelled.data).toEqual(before.data);
  expect(
    await page.evaluate(() =>
      (window as any).odakCalls.some((c: any) => c.args?.action === "finish"),
    ),
  ).toBe(false);
  await page
    .locator(".timer-card")
    .screenshot({ path: "docs/screenshot-finish.png" });
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page.screenshot({
    path: "docs/screenshot-finish-confirm.png",
    fullPage: true,
  });
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, bitir", exact: true })
    .click();
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data.timer.phase).toBe("idle");
  expect(after.data.sessions).toHaveLength(1);
  expect(after.data.sessions[0].actualMin).toBeGreaterThanOrEqual(20);
  expect(after.data.sessions[0].actualMin).toBeLessThan(20.1);
  expect(after.data.sessions[0].plannedMin).toBe(45);
  expect(after.data.tasks[0].status).toBe("completed");
  await page.getByLabel("İstatistik", { exact: true }).click();
  await expect(
    page.getByLabel("Günlük odak çizgi grafiği", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trend-hit").last()).toHaveAttribute(
    "aria-label",
    /20dk/,
  );
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(page.getByLabel("Rapor yaz: geri al")).toBeVisible();
  await page.getByLabel("Rapor yaz: geri al").click();
  const undone: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(undone.data.tasks[0].status).toBe("active");
  expect(undone.data.tasks[0].completedAt).toBeNull();
  expect(undone.data.sessions).toEqual(after.data.sessions);
});

test("finish from pause excludes paused time", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).odakStartOffset = 5 * 60000;
  });
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  const paused: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, bitir", exact: true })
    .click();
  const finished: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const expected =
    (paused.data.timer.pausedAt -
      paused.data.timer.startedAt -
      paused.data.timer.pausedAccumulatedMs) /
    60000;
  expect(finished.data.sessions[0].actualMin).toBe(expected);
  expect(finished.data.tasks[0].status).toBe("completed");
});

test("break exposes Pause and Finish without cancellation or extra focus credit", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (window as any).odakFixture,
      now = Date.now();
    fixture.sessions.push({
      id: "earned",
      taskId: "report",
      type: "work",
      startedAt: now - 12 * 60000,
      endedAt: now,
      plannedMin: 45,
      actualMin: 12,
      label: "İş",
    });
    Object.assign(fixture.timer, {
      phase: "break",
      taskId: "report",
      startedAt: now,
      plannedMin: 15,
    });
    (window as any).odakNotify();
  });
  await expect(page.getByText("MOLA ZAMANI", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "İptal et", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".timer-title")).toHaveText("Mola zamanı");
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "İptal et", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bitir", exact: true }),
  ).toBeVisible();
  const earned: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(earned.data.tasks[0].status).toBe("active");
  expect(earned.data.sessions).toHaveLength(1);
  await page.getByLabel("Odaklanılacak görev").selectOption("backlog");
  const selectedNext: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(selectedNext.data).toEqual(earned.data);
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Rapor yaz");
  await expect(page.getByRole("alertdialog")).toContainText(
    "mola odak süresine eklenmez",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Evet, bitir", exact: true })
    .click();
  const finished: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(finished.data.tasks[0].status).toBe("completed");
  expect(finished.data.sessions).toEqual(earned.data.sessions);
  expect(finished.data.tasks[2].status).toBe("active");
  await expect(page.getByLabel("Odaklanılacak görev")).toHaveValue("backlog");
});

test("new task requires a nonblank label and typed labels remain available", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("Etiketli yeni iş");
  const label = page.getByLabel("Etiket", { exact: true });
  await expect(label).toHaveAttribute("required", "");
  await expect(label).toHaveClass("required-field");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await label.fill("   ");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Etiket zorunlu");
  expect(
    await page.evaluate(() => (window as any).odakFixture.tasks.length),
  ).toBe(3);
  await label.fill("Yeni kategori");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Etiketli yeni iş", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Ayarlar", { exact: true }).click();
  await expect(page.getByLabel("Yeni kategori: etiketi sil")).toBeVisible();
});

test("quick add requires a label and fits the small native window", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "quick" } },
      invoke: async () => null,
    };
  });
  await page.setViewportSize({ width: 480, height: 260 });
  await page.goto("/?quick=1");
  await page.getByLabel("Görev başlığı").fill("Hızlı etiketli iş");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).odakFixture.tasks.length),
  ).toBe(3);
  await page.getByLabel("Etiket", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Etiket zorunlu");
  await page.getByLabel("Etiket", { exact: true }).fill("Ev");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshot-quick-label.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(480);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(260);
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Görev başlığı")).toHaveValue("");
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(
    state.data.tasks.find((t: any) => t.title === "Hızlı etiketli iş").label,
  ).toBe("Ev");
});

test("suggests today's highest stars after Finish, then falls back to the general list", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const api = (window as any).odakTestApi,
      fixture = (window as any).odakFixture;
    for (const [id, rating] of [
      ["report", 5],
      ["slides", 4],
      ["backlog", 5],
    ])
      await api.invoke("command", {
        action: "set_priority",
        payload: { id, rating },
      });
    await api.invoke("command", {
      action: "save_task",
      payload: { ...fixture.tasks[1], pomodoroMin: 30 },
    });
  });
  const picker = page.getByLabel("Odaklanılacak görev"),
    suggestion = page.getByLabel("Sıradaki odak önerisi");
  await expect(picker).toHaveValue("report");
  await expect(suggestion).toContainText("5 yıldız");
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page.getByRole("button", { name: "Evet, bitir", exact: true }).click();
  await expect(picker).toHaveValue("slides");
  await expect(suggestion).toContainText("4 yıldız");
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "30",
  );
  await expect(page.locator(".timer-card .timer-title")).toContainText(
    "Sunum hazırla",
  );
  await expect(picker.locator('option[value="report"]')).toHaveCount(0);
  await page
    .locator(".timer-card")
    .screenshot({ path: "docs/screenshot-focus-suggestion.png" });
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page.getByRole("button", { name: "Evet, bitir", exact: true }).click();
  await expect(picker).toHaveValue("backlog");
  await expect(suggestion).toContainText("5 yıldız");
  await expect(suggestion).toContainText("Liste");
});

test("deadline clears the previous selection during break and keeps the next recommendation after break", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.evaluate(async () => {
    const fixture = (window as any).odakFixture,
      now = Date.now();
    await (window as any).odakTestApi.invoke("command", {
      action: "set_priority",
      payload: { id: "report", rating: 5 },
    });
    await (window as any).odakTestApi.invoke("command", {
      action: "set_priority",
      payload: { id: "slides", rating: 4 },
    });
    fixture.sessions.push({
      id: "deadline",
      taskId: "report",
      type: "work",
      startedAt: now - 45 * 60000,
      endedAt: now,
      plannedMin: 45,
      actualMin: 45,
      label: "İş",
    });
    Object.assign(fixture.timer, {
      phase: "break",
      startedAt: now,
      plannedMin: 15,
    });
    (window as any).odakNotify();
  });
  const picker = page.getByLabel("Odaklanılacak görev");
  await expect(page.locator(".timer-card .timer-title")).toHaveText(
    "Mola zamanı",
  );
  await expect(picker).toHaveValue("slides");
  await expect(picker).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "İptal et", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".timer-card")
    .screenshot({ path: "docs/screenshot-break-suggestion.png" });
  await page.evaluate(() => {
    Object.assign((window as any).odakFixture.timer, {
      phase: "idle",
      startedAt: null,
      breakReady: true,
    });
    (window as any).odakNotify();
  });
  await expect(page.locator(".timer-card .timer-title")).toContainText(
    "Sunum hazırla",
  );
  await expect(picker).toHaveValue("slides");
  await page.getByRole("button", { name: "Devam et", exact: true }).click();
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(state.data.timer.taskId).toBe("slides");
  expect(state.data.tasks[0].status).toBe("active");
  expect(state.data.sessions).toHaveLength(1);
});

test("picker uses only the nearest recurrence and can start a lazy monthly task without modifying other occurrences", async ({
  page,
}) => {
  const dates: any = await page.evaluate(() => {
    const fixture = (window as any).odakFixture,
      now = new Date();
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const nearest = new Date(now);
    nearest.setDate(nearest.getDate() + 29);
    const far = new Date(nearest);
    far.setMonth(far.getMonth() + 1);
    const first = new Date(nearest);
    first.setMonth(first.getMonth() - 1);
    const template = {
      ...fixture.tasks[0],
      id: "monthly",
      title: "Aylık kontrol",
      scheduledDate: key(first),
      recurrenceRule: {
        frequency: "monthly",
        weekdays: [],
        monthDay: nearest.getDate(),
      },
    };
    const later = {
      ...template,
      id: `monthly@${key(far)}`,
      seriesId: "monthly",
      scheduledDate: key(far),
      recurrenceRule: null,
    };
    const weekly = {
      ...template,
      id: "weekly",
      title: "Aylık kontrol",
      recurrenceRule: { frequency: "daily", weekdays: [], monthDay: 1 },
    };
    fixture.tasks.push(template, later, weekly);
    (window as any).odakNotify();
    return { nearest: `monthly@${key(nearest)}`, later: later.id };
  });
  const picker = page.getByLabel("Odaklanılacak görev");
  await expect(picker.locator('option[value^="monthly@"]')).toHaveCount(1);
  await expect(
    picker.locator(`option[value="${dates.nearest}"]`),
  ).toBeAttached();
  await expect(picker.locator(`option[value="${dates.later}"]`)).toHaveCount(0);
  await expect(picker.locator('option[value^="weekly@"]')).toHaveCount(1);
  await expect(picker.locator('option[value^="monthly@"]')).toContainText(
    /20\d{2}/,
  );
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await picker.selectOption(dates.nearest);
  const preview: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(preview.data).toEqual(before.data);
  await page.getByRole("button", { name: "Odaklanmaya başla" }).click();
  const started: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(started.data.timer.taskId).toBe(dates.nearest);
  expect(started.data.tasks.filter((t: any) => t.id !== dates.nearest)).toEqual(
    before.data.tasks,
  );
  expect(
    started.data.tasks.filter((t: any) => t.id === dates.nearest),
  ).toHaveLength(1);
});

test("empty current agenda and list leave focus unselected without starting a taskless timer", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).odakFixture.tasks.forEach((task: any) => {
      task.status = "completed";
      task.completedAt = Date.now();
    });
    (window as any).odakNotify();
  });
  await expect(page.getByLabel("Sıradaki odak önerisi")).toHaveCount(0);
  await expect(page.getByLabel("Odaklanılacak görev")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Odaklanmaya başla" }),
  ).toBeDisabled();
});

test("task card empty space and keyboard select its duration without starting or changing a live timer", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const fixture = (window as any).odakFixture;
    await (window as any).odakTestApi.invoke("command", {
      action: "save_task",
      payload: { ...fixture.tasks[1], pomodoroMin: 30 },
    });
  });
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const card = page.getByLabel("Sunum hazırla: görev kartı", { exact: true }),
    box = await card.boundingBox();
  await card.click({ position: { x: box!.width / 2, y: box!.height - 7 } });
  await expect(page.getByLabel("Odaklanılacak görev")).toHaveValue("slides");
  await expect(page.locator(".timer-number")).toHaveText("30:00");
  const selected: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(selected.data).toEqual(before.data);
  await page
    .getByRole("button", { name: "Liste", exact: false })
    .first()
    .click();
  const backlog = page.getByLabel("Kitap oku: görev kartı", { exact: true });
  await backlog.focus();
  await backlog.press("Enter");
  await expect(page.getByLabel("Odaklanılacak görev")).toHaveValue("backlog");
  await expect(page.locator(".timer-number")).toHaveText("45:00");
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  const running: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await card.focus();
  await card.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "Görev değiştirmek için yeni işin ▶ düğmesine bas",
  );
  await expect(page.getByLabel("Odaklanılacak görev")).toHaveValue("report");
  const unchanged: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(unchanged.data).toEqual(running.data);
});

test("focus checklist ticks only its selected task and preserves work and pause timestamps", async ({
  page,
}) => {
  await page.evaluate(() => {
    const task = (window as any).odakFixture.tasks[0];
    task.subtasks = [
      { id: "draft", title: "Taslağı hazırla", done: false },
      { id: "sources", title: "Kaynakları ekle", done: false },
      { id: "check", title: "Son kontrol", done: false },
    ];
    (window as any).odakNotify();
  });
  await page.getByLabel("Rapor yaz: başlat").click();
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Pomodoro: Taslağı hazırla", { exact: true }).check();
  const checked: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const expected = structuredClone(before.data);
  expected.tasks[0].subtasks[0].done = true;
  expect(checked.data).toEqual(expected);
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  const paused: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Pomodoro: Kaynakları ekle", { exact: true }).check();
  await page.getByLabel("Pomodoro: Son kontrol", { exact: true }).check();
  const allDone: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(allDone.data.timer).toEqual(paused.data.timer);
  expect(allDone.data.sessions).toEqual(paused.data.sessions);
  expect(allDone.data.tasks[0].status).toBe("active");
  await expect(page.locator(".focus-checklist")).toContainText("3/3");
  await page
    .locator(".timer-card")
    .screenshot({ path: "docs/screenshot-focus-checklist.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".timer-card").screenshot({
    path: "docs/screenshot-focus-checklist-dark.png",
    animations: "disabled",
  });
  const calls: any[] = await page.evaluate(() => (window as any).odakCalls);
  expect(
    calls.filter((call) => call.args?.action === "set_subtask"),
  ).toHaveLength(3);
});

test("completed cards show actual versus planned work and open strictly read-only optional details", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const fixture = (window as any).odakFixture,
      now = Date.now();
    Object.assign(fixture.tasks[0], {
      status: "completed",
      completedAt: now,
      scheduledDate: null,
      notes: "Teslim edilen raporun özeti.",
      estimateMin: 60,
      subtasks: [{ id: "done", title: "Kaynaklar kontrol edildi", done: true }],
    });
    Object.assign(fixture.tasks[1], {
      status: "completed",
      completedAt: now - 10000,
    });
    fixture.sessions.push({
      id: "partial",
      taskId: "report",
      type: "work",
      startedAt: now - 30 * 60000,
      endedAt: now,
      plannedMin: 60,
      actualMin: 30,
      label: "İş",
    });
    await (window as any).odakTestApi.invoke("command", {
      action: "set_priority",
      payload: { id: "report", rating: 5 },
    });
  });
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(page.locator(".completed-card").first()).toHaveAttribute(
    "aria-label",
    "Rapor yaz: tamamlanan görev",
  );
  const card = page.getByLabel("Rapor yaz: tamamlanan görev", { exact: true });
  await expect(card).toContainText("30dk / 1sa · Erken bitirildi");
  await expect(card.locator(".label-tag")).toHaveText("İş");
  await expect(card.locator(".task-title")).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await expect(card.getByLabel("5 yıldız öncelik")).toBeVisible();
  await expect(page.getByLabel("Rapor yaz: seçenekler")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshot-completed-cards.png",
    fullPage: true,
  });
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  const callCount = await page.evaluate(() => (window as any).odakCalls.length);
  await page
    .getByLabel("Rapor yaz: tamamlanan detayları", { exact: true })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Tamamlanan görev detayları",
  });
  await expect(detail).toContainText("Teslim edilen raporun özeti.");
  await expect(detail).toContainText("Kaynaklar kontrol edildi");
  await expect(detail).toContainText("30dk");
  await expect(
    detail.locator("input, select, textarea, [contenteditable=true]"),
  ).toHaveCount(0);
  await expect(detail.getByRole("button")).toHaveCount(1);
  for (const field of [
    "Plan günü",
    "Plan başlangıcı",
    "Plan bitişi",
    "Son bitirme zamanı",
  ])
    await expect(detail.getByText(field, { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshot-completed-details.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "docs/screenshot-completed-details-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  const calls: any[] = await page.evaluate(() => (window as any).odakCalls);
  expect(
    calls.slice(callCount).filter((call) => call.cmd === "command"),
  ).toHaveLength(0);
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  await page.evaluate(() => {
    const task = (window as any).odakFixture.tasks[0],
      now = new Date();
    task.scheduledDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    task.startAt = now.getTime();
    task.endAt = task.startAt + 60000;
    task.dueAt = task.endAt + 60000;
    (window as any).odakNotify();
  });
  await page.getByLabel("Rapor yaz: detayları göster", { exact: true }).click();
  for (const field of [
    "Plan günü",
    "Plan başlangıcı",
    "Plan bitişi",
    "Son bitirme zamanı",
  ])
    await expect(detail.getByText(field, { exact: true })).toBeVisible();
});

test("selection after break loads the next task duration instead of keeping zero", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const fixture = (window as any).odakFixture,
      now = Date.now();
    await (window as any).odakTestApi.invoke("command", {
      action: "save_task",
      payload: { ...fixture.tasks[1], pomodoroMin: 30 },
    });
    Object.assign(fixture.timer, {
      phase: "idle",
      breakReady: true,
      taskId: "report",
      startedAt: null,
    });
    fixture.sessions.push({
      id: "last-work",
      taskId: "report",
      type: "work",
      startedAt: now - 45 * 60000,
      endedAt: now,
      plannedMin: 45,
      actualMin: 45,
      label: "İş",
    });
    (window as any).odakNotify();
  });
  await expect(page.getByText("MOLA BİTTİ", { exact: true })).toBeVisible();
  await page.getByLabel("Odaklanılacak görev").selectOption("slides");
  await expect(page.locator(".timer-number")).toHaveText("30:00");
  await expect(page.getByLabel("Çalışma süresi", { exact: true })).toHaveValue(
    "30",
  );
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Odaklanılacak görev").selectOption("backlog");
  await expect(page.locator(".timer-number")).toHaveText("45:00");
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
});

test("manual tick adds no time but a one-second Finish counts one session and shows seconds", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: tamamla").click();
  await page.getByLabel("İstatistik", { exact: true }).click();
  await expect(
    page.locator(".stat-cards > div").nth(2).locator("strong"),
  ).toHaveText("0");
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(
    page.getByLabel("Rapor yaz: tamamlanan görev", { exact: true }),
  ).toContainText("Odak kaydı yok");
  await page.getByLabel("Rapor yaz: geri al").click();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.evaluate(() => {
    const now = Date.now();
    Object.assign((window as any).odakFixture.timer, {
      phase: "paused",
      pausedPhase: "work",
      startedAt: now - 1000,
      pausedAt: now,
      pausedAccumulatedMs: 0,
    });
    (window as any).odakNotify();
  });
  await page.getByRole("button", { name: "Bitir", exact: true }).click();
  await page.getByRole("button", { name: "Evet, bitir", exact: true }).click();
  await page.getByLabel("İstatistik", { exact: true }).click();
  await expect(
    page.locator(".stat-cards > div").nth(2).locator("strong"),
  ).toHaveText("1");
  await expect(
    page.locator(".stat-cards > div").first().locator("strong"),
  ).toHaveText("1sn");
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(
    page.getByLabel("Rapor yaz: tamamlanan görev", { exact: true }),
  ).toContainText("Son oturum: 1sn / 45dk");
});

test("confirmed handoff credits exact elapsed work and resumes the saved remainder", async ({
  page,
}) => {
  await page.getByLabel("Rapor yaz: başlat").click();
  await page.evaluate(() => {
    const now = Date.now();
    Object.assign((window as any).odakFixture.timer, {
      phase: "paused",
      pausedPhase: "work",
      pausedAt: now,
      startedAt: now - 27.5 * 60000,
      pausedAccumulatedMs: 0,
    });
    (window as any).odakNotify();
  });
  await expect(page.locator(".timer-number")).toHaveText("17:30");
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Sunum hazırla: başlat").click();
  await expect(page.getByRole("alertdialog")).toContainText("27dk 30sn");
  await page.screenshot({
    path: "docs/screenshot-switch-confirm.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  const cancelled: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(cancelled.data).toEqual(before.data);
  await page.getByLabel("Sunum hazırla: başlat").click();
  await page
    .getByRole("button", { name: "Tamam, göreve geç", exact: true })
    .click();
  const switched: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(switched.data.sessions).toHaveLength(1);
  expect(switched.data.sessions[0]).toMatchObject({
    taskId: "report",
    actualMin: 27.5,
    outcome: "switched",
  });
  expect(switched.data.suspendedWork.report).toEqual({
    remainingMs: 1050000,
    plannedMin: 45,
  });
  expect(switched.data.tasks[0].status).toBe("active");
  expect(switched.data.timer.taskId).toBe("slides");
  await expect(page.locator(".task-list")).toContainText("17:30");
  await page.screenshot({
    path: "docs/screenshot-saved-remainder.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const now = Date.now();
    Object.assign((window as any).odakFixture.timer, {
      phase: "paused",
      pausedPhase: "work",
      pausedAt: now,
      startedAt: now - 5 * 60000,
      pausedAccumulatedMs: 0,
    });
    (window as any).odakNotify();
  });
  await page.getByLabel("Rapor yaz: başlat").click();
  await page
    .getByRole("button", { name: "Tamam, göreve geç", exact: true })
    .click();
  const resumed: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(resumed.data.timer).toMatchObject({
    taskId: "report",
    plannedMin: 45,
    workBudgetMs: 1050000,
  });
  expect(resumed.data.suspendedWork.report).toBeUndefined();
  expect(
    resumed.data.sessions.reduce(
      (sum: number, session: any) => sum + session.actualMin,
      0,
    ),
  ).toBe(32.5);
  await expect(page.locator(".timer-number")).toHaveText(/17:3[0-9]|17:2[0-9]/);
});

test("legacy mixed series converts explicitly without deleting historical instances or adding focus time", async ({
  page,
}) => {
  const original = await page.evaluate(() => {
    const fixture = (window as any).odakFixture,
      date = new Date(),
      due = new Date();
    due.setDate(due.getDate() + 5);
    const parent = {
      ...structuredClone(fixture.tasks[0]),
      id: "mixed",
      title: "Politika belgeleri",
      dueAt: due.getTime(),
      recurrenceRule: {
        frequency: "daily",
        weekdays: [],
        monthDay: date.getDate(),
      },
    };
    const key = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    date.setDate(date.getDate() - 1);
    const past = {
      ...structuredClone(parent),
      id: "mixed-past",
      seriesId: "mixed",
      recurrenceRule: null,
      scheduledDate: key(date),
      status: "completed",
      completedAt: date.getTime(),
    };
    date.setDate(date.getDate() + 2);
    const next = {
      ...structuredClone(parent),
      id: "mixed-next",
      seriesId: "mixed",
      recurrenceRule: null,
      scheduledDate: key(date),
    };
    fixture.tasks.push(parent, past, next);
    (window as any).odakNotify();
    return [past, next];
  });
  await page.getByRole("button", { name: "Tekrarlayan", exact: true }).click();
  await page
    .getByRole("button", { name: "Politika belgeleri", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "hem son tarih hem tekrar",
  );
  await page.getByLabel("Görev türü", { exact: true }).selectOption("deadline");
  await page.getByLabel("Bu iş zaten tamamlandı", { exact: true }).check();
  for (const field of ["Gün", "Başlangıç", "Bitiş", "Toplam iş tahmini (dk)"])
    await expect(page.getByLabel(field, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Eski günlerin kayıtları silinmez",
  );
  await page.getByRole("button", { name: "Evet, onayla", exact: true }).click();
  const saved: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(
    saved.data.tasks.filter((task: any) => task.seriesId === "mixed"),
  ).toEqual(original);
  expect(
    saved.data.tasks.find((task: any) => task.id === "mixed"),
  ).toMatchObject({
    kind: "deadline",
    status: "completed",
    recurrenceRule: { frequency: "daily" },
  });
  expect(saved.data.sessions).toHaveLength(0);
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(
    page
      .getByLabel("Odaklanılacak görev")
      .locator("option")
      .filter({ hasText: "Politika belgeleri" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Tamamlanan", exact: true }).click();
  await expect(
    page.getByLabel("Politika belgeleri: tamamlanan görev", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshot-deadline-completed.png",
    fullPage: true,
  });
});

test("series ratings are shared by the nearest weekly instance and the next Friday", async ({
  page,
}) => {
  const nextDate = await page.evaluate(() => {
    const fixture = (window as any).odakFixture,
      date = new Date();
    date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
    const key = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const first = key(date);
    fixture.tasks.push({
      ...structuredClone(fixture.tasks[0]),
      id: "friday",
      title: "Cuma kontrolü",
      kind: "recurring",
      scheduledDate: first,
      dueAt: null,
      recurrenceRule: { frequency: "weekly", weekdays: [5], monthDay: 1 },
    });
    (window as any).odakNotify();
    date.setDate(date.getDate() + 7);
    return { first, second: key(date) };
  });
  await page.getByRole("button", { name: "Tekrarlayan", exact: true }).click();
  await page
    .getByRole("radio", { name: "Cuma kontrolü: 5 yıldız", exact: true })
    .click();
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  const picker = page.getByLabel("Odaklanılacak görev");
  await expect(
    picker.locator("option").filter({ hasText: "Cuma kontrolü" }),
  ).toHaveCount(1);
  await expect(
    picker.locator(`option[value="friday@${nextDate.first}"]`),
  ).toBeAttached();
  await page.evaluate(async ({ first }) => {
    const fixture = (window as any).odakFixture,
      parent = fixture.tasks.find((task: any) => task.id === "friday");
    fixture.tasks.push({
      ...structuredClone(parent),
      id: `friday@${first}`,
      seriesId: "friday",
      recurrenceRule: null,
      scheduledDate: first,
      status: "completed",
      completedAt: Date.now(),
    });
    (window as any).odakNotify();
  }, nextDate);
  await expect(
    picker.locator(`option[value="friday@${nextDate.second}"]`),
  ).toBeAttached();
  await expect(
    picker.locator("option").filter({ hasText: "Cuma kontrolü" }),
  ).toHaveCount(1);
  const state: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(state.priorities.friday).toBe(5);
  expect(
    state.data.tasks.find((task: any) => task.id === "friday").status,
  ).toBe("active");
});

test("trend selection and label filters summarize the same actual work", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fixture = (window as any).odakFixture,
      now = new Date();
    now.setHours(12, 0, 0, 0);
    const endedAt = now.getTime(),
      past = new Date(now);
    past.setDate(past.getDate() - 3);
    for (const [id, label, actualMin, end, type] of [
      ["old-a", "İş", 30, past.getTime(), "work"],
      ["old-b", "Okul", 108, past.getTime(), "work"],
      ["today", "Kişisel", 45, endedAt, "work"],
      ["rest", "Mola", 15, past.getTime(), "break"],
    ])
      fixture.sessions.push({
        id,
        label,
        actualMin,
        endedAt: end,
        type,
        taskId: null,
        startedAt: Number(end) - Number(actualMin) * 60000,
        plannedMin: 45,
      });
    (window as any).odakNotify();
  });
  await page.getByLabel("İstatistik", { exact: true }).click();
  await page.locator(".trend-hit").nth(10).click();
  await expect(page.locator(".trend-detail")).toContainText("2sa 18dk");
  await expect(page.locator(".label-stat")).toHaveCount(2);
  await expect(
    page.locator(".label-stat").filter({ hasText: "Okul" }),
  ).toContainText("1sa 48dk");
  await expect(
    page.locator(".label-stat").filter({ hasText: "İş" }),
  ).toContainText("30dk");
  await page.screenshot({
    path: "docs/screenshot-stats-selected-day.png",
    fullPage: true,
  });
  await page.getByLabel("Etiket dağılımı dönemi").selectOption("today");
  await expect(page.locator(".label-stat")).toHaveCount(1);
  await expect(page.locator(".label-stat")).toContainText("Kişisel");
  await page.getByLabel("Etiket dağılımı dönemi").selectOption("week");
  await expect(
    page.getByRole("heading", { name: "Etikete göre · Bu hafta", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Etiket dağılımı dönemi").selectOption("fortnight");
  await expect(page.locator(".label-stat")).toHaveCount(3);
});

test("database inspector reads disk records and offers no mutation controls", async ({
  page,
}) => {
  const before: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  await page.getByLabel("Ayarlar", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Veritabanını incele · salt okunur",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Yerel veriler" }),
  ).toBeVisible();
  await expect(page.getByText("Bütünlük: ok", { exact: true })).toBeVisible();
  await expect(page.locator(".inspection-table-wrap tbody tr")).toHaveCount(3);
  await page.getByLabel("Kayıtlarda ara").fill("Sunum");
  await expect(page.locator(".inspection-table-wrap tbody tr")).toHaveCount(1);
  await page.getByText("Göster", { exact: true }).click();
  await expect(page.locator(".inspection-table-wrap pre")).toContainText(
    '"id": "slides"',
  );
  await page.screenshot({
    path: "docs/screenshot-database.png",
    fullPage: true,
  });
  await page.getByLabel("Kayıtlarda ara").clear();
  await page.getByLabel("Veri tablosu").selectOption("meta");
  await expect(page.locator(".inspection-table-wrap tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Diskten yenile", exact: true })
    .click();
  const after: any = await page.evaluate(() =>
    (window as any).odakTestApi.invoke("snapshot"),
  );
  expect(after.data).toEqual(before.data);
  expect(await page.getByRole("button", { name: /Sil|Kaydet/ }).count()).toBe(
    0,
  );
});
