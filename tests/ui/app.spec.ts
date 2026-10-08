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
    const calls: { cmd: string; args: any }[] = [];
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
      data: structuredClone(data),
      remainingMs:
        data.timer.phase === "idle" ? 0 : data.timer.plannedMin * 60000,
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
        const p = args.payload;
        if (
          ["delete_task", "delete_label", "cancel"].includes(args.action) &&
          !p.confirmed
        )
          throw new Error("Onay gerekli.");
        switch (args.action) {
          case "save_task": {
            const i = data.tasks.findIndex((t: any) => t.id === p.id);
            if (i === -1) data.tasks.push(p);
            else data.tasks[i] = p;
            break;
          }
          case "set_priority":
            priorities[p.id] = p.rating;
            break;
          case "rename_task":
            data.tasks.find((t: any) => t.id === p.id).title = p.title.trim();
            break;
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
          case "start":
            if (!p.taskId) throw new Error("Bir görev seçin.");
            data.timer = {
              ...data.timer,
              ...p,
              phase: "work",
              plannedMin: p.workMin,
              startedAt: Date.now(),
            };
            break;
          case "pause":
            data.timer.pausedPhase = data.timer.phase;
            data.timer.phase = "paused";
            break;
          case "resume":
            data.timer.phase = data.timer.pausedPhase;
            break;
          case "cancel":
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
  await page.getByLabel("Çalışma süresi", { exact: true }).fill("91");
  await page.getByLabel("Rapor yaz: başlat").click();
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
  await expect(page.getByLabel("Gün", { exact: true })).toHaveValue(day!);
  await page.getByLabel("Başlık", { exact: true }).fill("Lab kurulumu");
  await page.getByLabel("Başlangıç saati").fill("14:00");
  await page.getByLabel("Bitiş saati").fill("15:00");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lab kurulumu", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("14:00–15:00")).toBeVisible();
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

test("named focus is required; inline title edit keeps the timer untouched", async ({
  page,
}) => {
  await expect(page.locator(".brand-name")).toHaveText("Odak");
  await expect(
    page.getByRole("button", { name: "Odaklanmaya başla" }),
  ).toBeDisabled();
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
    page.getByRole("heading", { name: "Etikete göre · bu hafta" }),
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
  await expect(page.getByLabel("Gün", { exact: true })).toHaveValue("");
  await page.getByLabel("Tekrar", { exact: true }).selectOption("daily");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect(page.getByLabel("Gün", { exact: true })).toHaveValue(today);
  await expect(page.getByLabel("Gün", { exact: true })).toHaveClass(
    "required-field",
  );
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
  await expect(page.getByLabel("Geçmiş adım", { exact: true })).toBeDisabled();
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
  await page
    .getByRole("button", { name: "Liste", exact: false })
    .first()
    .click();
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
