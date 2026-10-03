import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

type ManagedModel = {
  name: string;
  label: string;
  fields: Record<string, string>;
  keyFields: string[];
  totalRecords: number;
  deletableRecords: number;
  protectedRecords: number;
};

type ManagedRecord = {
  key: Record<string, string>;
  protected: boolean;
  values: Record<string, string | number | boolean | null>;
};

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
  "Content-Type": "application/json",
});

const displayValue = (value: ManagedRecord["values"][string]) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
};

export function SuperAdminDataManager() {
  const [models, setModels] = useState<ManagedModel[]>([]);
  const [selectedModelName, setSelectedModelName] = useState("");
  const [records, setRecords] = useState<ManagedRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ManagedRecord | null>(
    null,
  );
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");

  const selectedModel = models.find(
    (model) => model.name === selectedModelName,
  );

  useEffect(() => {
    let active = true;
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const response = await apiFetch("/api/superadmin/data/models", {
          headers: authHeaders(),
        });
        const body = (await response.json()) as {
          models?: ManagedModel[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            body.error ?? "Não foi possível carregar os modelos.",
          );
        if (!active) return;
        setModels(body.models ?? []);
        setSelectedModelName(
          (current) => current || body.models?.[0]?.name || "",
        );
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        if (active) setLoadingModels(false);
      }
    };
    void loadModels();
    return () => {
      active = false;
    };
  }, [reloadVersion]);

  useEffect(() => {
    if (!selectedModelName) return;
    let active = true;
    const loadRecords = async () => {
      setLoadingRecords(true);
      setError("");
      try {
        const response = await apiFetch(
          `/api/superadmin/data/models/${encodeURIComponent(selectedModelName)}?page=${page}`,
          { headers: authHeaders() },
        );
        const body = (await response.json()) as {
          records?: ManagedRecord[];
          totalPages?: number;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            body.error ?? "Não foi possível carregar os registros.",
          );
        if (!active) return;
        setRecords(body.records ?? []);
        setTotalPages(body.totalPages ?? 1);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        if (active) setLoadingRecords(false);
      }
    };
    void loadRecords();
    return () => {
      active = false;
    };
  }, [page, reloadVersion, selectedModelName]);

  const reload = () => setReloadVersion((current) => current + 1);

  const deleteRecord = async () => {
    if (!pendingDelete || !selectedModel) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/superadmin/data/models/${encodeURIComponent(selectedModel.name)}/records`,
        {
          method: "DELETE",
          headers: authHeaders(),
          body: JSON.stringify({ key: pendingDelete.key }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível apagar o registro.");
      setPendingDelete(null);
      setNotice("Registro apagado.");
      reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearModel = async () => {
    if (!selectedModel || clearConfirmation !== "ZERAR") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/superadmin/data/models/${encodeURIComponent(selectedModel.name)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
          body: JSON.stringify({ confirmation: clearConfirmation }),
        },
      );
      const body = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível limpar este modelo.");
      setClearOpen(false);
      setClearConfirmation("");
      setNotice(`${body.deletedCount ?? 0} registro(s) apagado(s).`);
      setPage(1);
      reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">
            Ferramentas do superadmin
          </p>
          <h2 className="mt-1 text-2xl font-bold text-[#0b1d3a]">
            Gerenciamento de dados
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Consulte modelos, remova registros individuais ou limpe um conjunto
            de dados.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loadingModels || loadingRecords}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <label className="block text-xs font-semibold text-slate-600">
            Modelo de dados
            <select
              value={selectedModelName}
              onChange={(event) => {
                setSelectedModelName(event.target.value);
                setPage(1);
                setError("");
                setNotice("");
              }}
              disabled={loadingModels}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"
            >
              {models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          {selectedModel && (
            <div className="space-y-3 border-y border-slate-200 py-4">
              <div className="flex items-center gap-3">
                <Database size={19} className="text-[#1052c7]" />
                <div>
                  <p className="text-sm font-bold text-[#0b1d3a]">
                    {selectedModel.totalRecords} registro(s)
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedModel.deletableRecords} apagável(is)
                    {selectedModel.protectedRecords > 0 &&
                      ` · ${selectedModel.protectedRecords} protegido(s)`}
                  </p>
                </div>
              </div>
              {selectedModel.protectedRecords > 0 && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-800">
                  <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                  Contas superadmin são preservadas para manter o acesso ao
                  sistema.
                </p>
              )}
              <p className="text-xs leading-relaxed text-slate-500">
                Apagar registros pode remover dados relacionados conforme as
                dependências do banco.
              </p>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setClearConfirmation("");
                  setClearOpen(true);
                }}
                disabled={!selectedModel.deletableRecords || saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={16} /> Zerar modelo
              </button>
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {error && !pendingDelete && !clearOpen && (
            <p
              role="alert"
              className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
            >
              {notice}
            </p>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loadingRecords ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                <Loader2 size={18} className="animate-spin" /> Carregando
                registros...
              </div>
            ) : records.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Nenhum registro neste modelo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      {Object.entries(selectedModel?.fields ?? {}).map(
                        ([field, label]) => (
                          <th key={field} className="px-3 py-3 font-semibold">
                            {label}
                          </th>
                        ),
                      )}
                      <th className="px-3 py-3 text-right font-semibold">
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map((record) => (
                      <tr key={JSON.stringify(record.key)}>
                        {Object.keys(selectedModel?.fields ?? {}).map(
                          (field) => (
                            <td
                              key={field}
                              className="max-w-[260px] truncate px-3 py-3 text-slate-700"
                              title={displayValue(record.values[field])}
                            >
                              {displayValue(record.values[field])}
                            </td>
                          ),
                        )}
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            title={
                              record.protected
                                ? "Conta superadmin protegida"
                                : "Apagar registro"
                            }
                            aria-label={`Apagar registro ${Object.values(record.key).join(" / ")}`}
                            disabled={record.protected || saving}
                            onClick={() => setPendingDelete(record)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            {record.protected ? (
                              <ShieldAlert size={15} />
                            ) : (
                              <Trash2 size={15} />
                            )}
                            {record.protected ? "Protegido" : "Apagar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loadingRecords}
                aria-label="Página anterior"
                className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages || loadingRecords}
                aria-label="Próxima página"
                className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {pendingDelete && selectedModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-record-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h3
              id="delete-record-title"
              className="text-lg font-bold text-[#0b1d3a]"
            >
              Apagar este registro?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Modelo: {selectedModel.label}. Esta ação pode remover registros
              relacionados e não pode ser desfeita.
            </p>
            <p className="mt-2 break-all rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-600">
              {Object.entries(pendingDelete.key)
                .map(([field, value]) => `${field}: ${value}`)
                .join(" · ")}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void deleteRecord()}
                disabled={saving}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Apagando..." : "Apagar registro"}
              </button>
            </div>
          </section>
        </div>
      )}

      {clearOpen && selectedModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-model-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert
                size={21}
                className="mt-0.5 shrink-0 text-rose-600"
              />
              <div>
                <h3
                  id="clear-model-title"
                  className="text-lg font-bold text-[#0b1d3a]"
                >
                  Zerar {selectedModel.label}?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Serão apagados até {selectedModel.deletableRecords}{" "}
                  registro(s) deste modelo. Dados relacionados podem ser
                  removidos em cascata. Contas superadmin permanecerão
                  protegidas.
                </p>
              </div>
            </div>
            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Digite ZERAR para confirmar
              <input
                autoFocus
                value={clearConfirmation}
                onChange={(event) => setClearConfirmation(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearOpen(false)}
                disabled={saving}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void clearModel()}
                disabled={saving || clearConfirmation !== "ZERAR"}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Limpando..." : "Zerar dados"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
