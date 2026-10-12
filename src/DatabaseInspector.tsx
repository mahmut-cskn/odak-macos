import { useEffect, useState } from "react";
import { ArrowLeft, RotateCcw, LockKeyhole } from "lucide-react";
import { call } from "./api";
import { formatElapsed, taskKind, type Data } from "./domain";

type Inspection = {
  data: Data;
  priorities: Record<string, number>;
  prioritySource: string;
  databasePath: string;
  integrity: string;
  inspectedAt: number;
  taskDurations: Record<string, number>;
};
export default function DatabaseInspector({ onBack }: { onBack: () => void }) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [table, setTable] = useState("tasks"),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const reload = async () => {
    try {
      setInspection(await call<Inspection>("inspect_database"));
      setError("");
    } catch (error) {
      setError(String(error));
    }
  };
  useEffect(() => {
    reload();
  }, []);
  const records: Record<string, unknown>[] = !inspection
    ? []
    : table === "tasks"
      ? inspection.data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          label: task.label,
          kind: taskKind(task),
          status: task.status,
          series: task.seriesId || "",
          raw: task,
        }))
      : table === "sessions"
        ? inspection.data.sessions.map((session) => ({
            id: session.id,
            task: session.taskId || "",
            label: session.label,
            kind: session.type,
            duration: formatElapsed(session.actualMin),
            outcome: session.outcome || "eski kayıt",
            raw: session,
          }))
        : table === "priorities"
          ? Object.entries(inspection.priorities).map(([id, rating]) => ({
              id,
              rating: rating,
              source: inspection.prioritySource,
            }))
          : [
              { id: "timer", raw: inspection.data.timer },
              {
                id: "suspendedWork",
                raw: inspection.data.suspendedWork || {},
              },
              { id: "settings", raw: inspection.data.settings },
            ];
  const columnLabels: Record<string, string> = {
    title: "Başlık",
    label: "Etiket",
    kind: "Tür",
    status: "Durum",
    series: "Seri",
    task: "Görev",
    duration: "Süre",
    outcome: "Sonuç",
    rating: "Yıldız",
    source: "Kaynak",
  };
  const valueLabels: Record<string, string> = {
    list: "Liste",
    deadline: "Son tarihli",
    recurring: "Tekrarlayan",
    active: "Aktif",
    completed: "Tamamlanan",
    work: "Çalışma",
    break: "Mola",
    switched: "Görev değiştirildi",
    elapsed: "Süresi doldu",
    finished: "Bitir ile tamamlandı",
  };
  const filtered = records.filter((record) =>
    JSON.stringify(record)
      .toLocaleLowerCase("tr-TR")
      .includes(search.toLocaleLowerCase("tr-TR")),
  );
  const columns =
    table === "tasks"
      ? ["title", "label", "kind", "status", "series"]
      : table === "sessions"
        ? ["task", "label", "kind", "duration", "outcome"]
        : table === "priorities"
          ? ["rating", "source"]
          : [];
  return (
    <section className="database-inspector">
      <div className="inspection-heading">
        <button onClick={onBack}>
          <ArrowLeft size={15} />
          Ayarlar
        </button>
        <button onClick={reload}>
          <RotateCcw size={15} />
          Diskten yenile
        </button>
      </div>
      <h1>Yerel veriler</h1>
      <p className="muted">
        <LockKeyhole size={13} />
        Salt okunur · Kayıtlar doğrudan SQLite dosyasından okunur. Bu ekranda
        düzenleme ve silme yoktur.
      </p>
      {error && <p role="alert">{error}</p>}
      {inspection && (
        <>
          <div className="inspection-proof">
            <span>{inspection.data.tasks.length} görev</span>
            <span>{inspection.data.sessions.length} oturum kaydı</span>
            <span>
              {Object.keys(inspection.priorities).length} yıldız kaydı
            </span>
            <span>Bütünlük: {inspection.integrity}</span>
          </div>
          <small className="database-path">{inspection.databasePath}</small>
          <small className="muted inspection-timestamp">
            Son disk okuması:{" "}
            {new Date(inspection.inspectedAt).toLocaleString("tr-TR")} · Yıldız
            kaynağı: {inspection.prioritySource}
          </small>
          <div className="inspection-toolbar">
            <select
              aria-label="Veri tablosu"
              value={table}
              onChange={(event) => setTable(event.target.value)}
            >
              <option value="tasks">Görevler</option>
              <option value="sessions">Çalışma ve mola kayıtları</option>
              <option value="priorities">Yıldızlar</option>
              <option value="meta">Sayaç, kalan süreler ve ayarlar</option>
            </select>
            <input
              aria-label="Kayıtlarda ara"
              placeholder="Başlık, etiket veya kimlik ara…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="inspection-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kimlik</th>
                  {columns.map((column) => (
                    <th key={column}>{columnLabels[column]}</th>
                  ))}
                  <th>Ham kayıt</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={String(record.id)}>
                    <td className="record-id">{String(record.id)}</td>
                    {columns.map((column) => (
                      <td key={column}>
                        {valueLabels[String(record[column])] ||
                          String(record[column] ?? "")}
                      </td>
                    ))}
                    <td>
                      <details>
                        <summary>Göster</summary>
                        <pre>
                          {JSON.stringify(record.raw || record, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="muted">
            {filtered.length} kayıt görüntüleniyor. Eski tekrar örnekleri burada
            korunur; uygulama görünümünde arşivlenmiş olabilir.
          </small>
        </>
      )}
    </section>
  );
}
