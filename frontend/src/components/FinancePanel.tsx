import { useEffect, useState } from "react";
import { Check, FileText, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type FinanceEntry = {
  id: string;
  negotiation_id: string;
  amount: number;
  status: "pending_review" | "approved" | "paid" | "rejected" | string;
  payment_note?: string | null;
  payment_proof_name?: string | null;
  payment_proof_data?: string | null;
  paid_at?: string | null;
  created_at: string;
  driver?: { id: string; full_name: string };
  company?: { name?: string; legal_name?: string } | null;
  negotiation?: {
    collection_point?: { name?: string } | null;
    final_customer?: { name?: string } | null;
  } | null;
};

const statusLabels: Record<string, string> = {
  pending_review: "Aguardando conferência",
  approved: "Aprovado para pagamento",
  paid: "Pago",
  rejected: "Devolvido",
};

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function FinancePanel() {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const token = localStorage.getItem("acneto-access-token");
  const headers = {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };

  const load = async () => {
    const response = await apiFetch("/api/operations/wallet", { headers });
    if (!response.ok) {
      setError("Não foi possível carregar os pagamentos.");
      return;
    }
    const body = (await response.json()) as { entries: FinanceEntry[] };
    setEntries(body.entries);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const settle = async (
    entry: FinanceEntry,
    action: "approve" | "reject" | "pay",
    file?: File,
  ) => {
    setBusy(entry.id);
    setError("");
    let paymentProofData: string | undefined;
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("O comprovante deve ter no máximo 5 MB.");
        setBusy(null);
        return;
      }
      if (!/\.(pdf|jpg|jpeg)$/i.test(file.name)) {
        setError("O comprovante deve ser PDF, JPG ou JPEG.");
        setBusy(null);
        return;
      }
      paymentProofData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    const response = await apiFetch(
      `/api/operations/negotiations/${entry.negotiation_id}/settle`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          paymentProofName: file?.name,
          paymentProofData,
        }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar o pagamento.");
    } else {
      await load();
    }
    setBusy(null);
  };

  const visible = entries.filter(
    (entry) => status === "all" || entry.status === status,
  );
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
          Controle financeiro
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#0b1d3a]">
          Pagamentos de fretes
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Confira fretes finalizados, aprove pagamentos e registre o comprovante
          da transferência.
        </p>
      </div>
      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm sm:w-80"
      >
        <option value="all">Todos os lançamentos</option>
        {Object.entries(statusLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <div className="space-y-3">
        {!visible.length && (
          <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
            Nenhum lançamento financeiro encontrado.
          </p>
        )}
        {visible.map((entry) => (
          <article
            key={entry.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <h3 className="font-bold text-[#0b1d3a]">
                  {entry.driver?.full_name ?? "Motorista"}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {entry.negotiation?.collection_point?.name ?? "Origem"} →{" "}
                  {entry.negotiation?.final_customer?.name ?? "Destino"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {entry.company?.name ??
                    entry.company?.legal_name ??
                    "Autônomo"}{" "}
                  · {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-lg font-bold text-[#0b1d3a]">
                  {formatBRL(entry.amount)}
                </p>
                <span className="text-xs font-semibold text-blue-700">
                  {statusLabels[entry.status] ?? entry.status}
                </span>
              </div>
            </div>
            {entry.payment_proof_name && (
              <a
                href={entry.payment_proof_data ?? undefined}
                download={entry.payment_proof_name}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
              >
                <FileText size={14} /> {entry.payment_proof_name}
              </a>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {entry.status === "pending_review" && (
                <>
                  <button
                    type="button"
                    disabled={busy === entry.id}
                    onClick={() => void settle(entry, "approve")}
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                  >
                    <Check size={14} /> Aprovar pagamento
                  </button>
                  <button
                    type="button"
                    disabled={busy === entry.id}
                    onClick={() => void settle(entry, "reject")}
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"
                  >
                    <X size={14} /> Devolver
                  </button>
                </>
              )}
              {entry.status === "approved" && (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                  Anexar comprovante e marcar como pago
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/jpg,.pdf,.jpg,.jpeg"
                    className="hidden"
                    disabled={busy === entry.id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void settle(entry, "pay", file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
