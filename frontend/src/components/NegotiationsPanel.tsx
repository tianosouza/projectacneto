import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Plus, Send, X } from "lucide-react";
import { apiEventSource, apiFetch } from "@/lib/api";
import type { DemoContact, DemoDriver } from "@/lib/dashboardTypes";

type Negotiation = {
  id: string;
  driver_id: string;
  driver: DemoDriver | null;
  collection_point: DemoContact | null;
  final_customer: DemoContact | null;
  cargo: string | null;
  product: string | null;
  cte_number?: string | null;
  documents_released?: boolean;
  quantity: string | null;
  distance_km: number | null;
  price_per_km: number | null;
  initial_value: number;
  current_value: number;
  status: string;
  wallet_status?: string | null;
  offers: Array<{
    id: string;
    amount: number;
    message: string | null;
    status: string;
    user?: { full_name?: string | null } | null;
    created_at: string;
  }>;
  messages: Array<{
    id: string;
    body: string;
    user?: { full_name?: string | null } | null;
    created_at: string;
  }>;
  created_at: string;
  updated_at: string;
};

const statusLabels: Record<string, string> = {
  pending: "Aguardando resposta",
  countered: "Contraproposta",
  accepted: "Aceita",
  awaiting_loading: "Aguardando carregamento",
  in_transit: "Frete em andamento",
  at_collection: "No posto de coleta",
  driver_completed: "Aguardando conferência",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
  completed: "Concluída",
  expired: "Expirada",
};

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDecimalBR = (
  value: number | null | undefined,
  fractionDigits = 2,
) =>
  value == null || !Number.isFinite(value)
    ? ""
    : value.toLocaleString("pt-BR", {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
const formatMoneyInput = (value: string) => {
  const normalized = value.replace(/\s|R\$/gi, "").replace(/\./g, ",");
  const parts = normalized.replace(/[^\d,]/g, "").split(",");
  const integerPart = parts[0] ?? "";
  const decimalPart = parts.slice(1).join("").slice(0, 2);
  return parts.length > 1
    ? `${integerPart || "0"},${decimalPart}`
    : integerPart;
};
const parseBRL = (value: string) => {
  const normalized = value.trim().replace(/R\$|\s/gi, "");
  if (!normalized) return 0;
  return normalized.includes(",")
    ? Number(normalized.replace(/\./g, "").replace(",", "."))
    : Number(normalized);
};

export function NegotiationsPanel({
  drivers,
  clients,
  selectedDriverId,
  selectedClientIds = [],
  routeDistanceKm,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
  selectedDriverId: string | null;
  selectedClientIds?: string[];
  routeDistanceKm: number | null;
}) {
  const token = localStorage.getItem("acneto-access-token");
  const headers = {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    driverId: "",
    collectionPointId: "",
    finalCustomerId: "",
    cargo: "",
    product: "",
    quantity: "",
    distanceKm: "",
    pricePerKm: "",
    cteNumber: "",
    documentsReleased: false,
    initialValue: "",
  });
  const collectionPoints = clients.filter(
    (client) => client.kind === "collection_point",
  );
  const finalCustomers = clients.filter(
    (client) => client.kind === "final_customer",
  );

  const refresh = async () => {
    const response = await apiFetch("/api/negotiations", { headers });
    if (!response.ok) return;
    const body = (await response.json()) as { negotiations: Negotiation[] };
    setNegotiations(body.negotiations);
    setSelectedId((current) => current ?? body.negotiations[0]?.id ?? null);
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    const token = localStorage.getItem("acneto-access-token");
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    const refreshOnEvent = () => void refresh();
    events?.addEventListener("message", refreshOnEvent);
    return () => {
      window.clearInterval(interval);
      events?.removeEventListener("message", refreshOnEvent);
      events?.close();
    };
  }, []);

  useEffect(() => {
    if (selectedDriverId)
      setForm((current) => ({
        ...current,
        driverId: selectedDriverId,
        distanceKm: routeDistanceKm?.toFixed(2) ?? current.distanceKm,
      }));
    const selectedClients = clients.filter((client) =>
      selectedClientIds.includes(client.id),
    );
    const collectionPoint = selectedClients.find(
      (client) => client.kind === "collection_point",
    );
    const finalCustomer = selectedClients.find(
      (client) => client.kind === "final_customer",
    );
    if (collectionPoint || finalCustomer) {
      setForm((current) => ({
        ...current,
        collectionPointId: collectionPoint?.id ?? current.collectionPointId,
        finalCustomerId: finalCustomer?.id ?? current.finalCustomerId,
      }));
    }
  }, [clients, routeDistanceKm, selectedClientIds, selectedDriverId]);

  useEffect(() => {
    if (routeDistanceKm && selectedDriverId && selectedClientIds.length === 2) {
      setShowForm(true);
    }
  }, [routeDistanceKm, selectedClientIds.length, selectedDriverId]);

  const selected = negotiations.find((item) => item.id === selectedId) ?? null;
  const visible = useMemo(
    () =>
      negotiations.filter(
        (item) =>
          (statusFilter === "all" && item.status !== "completed") ||
          (statusFilter !== "all" && item.status === statusFilter),
      ),
    [negotiations, statusFilter],
  );

  const createNegotiation = async () => {
    setError("");
    setSaving(true);
    try {
      const response = await apiFetch("/api/negotiations/from-route", {
        method: "POST",
        headers,
        body: JSON.stringify({
          driverId: form.driverId,
          collectionPointId: form.collectionPointId,
          finalCustomerId: form.finalCustomerId,
          cargo: form.cargo,
          product: form.product,
          cteNumber: form.cteNumber,
          documentsReleased: form.documentsReleased,
          quantity: form.quantity,
          pricePerKm: form.pricePerKm,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível criar a negociação");
      setForm({
        driverId: "",
        collectionPointId: "",
        finalCustomerId: "",
        cargo: "",
        product: "",
        quantity: "",
        distanceKm: "",
        pricePerKm: "",
        cteNumber: "",
        documentsReleased: false,
        initialValue: "",
      });
      setShowForm(false);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const negotiationAction = async (
    action: "accept" | "reject" | "cancel" | "complete",
  ) => {
    if (!selected) return;
    const response = await apiFetch(
      `/api/negotiations/${selected.id}/${action}`,
      { method: "POST", headers },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar a negociação");
      return;
    }
    await refresh();
  };

  const settleFreight = async (action: "approve" | "reject" | "pay") => {
    if (!selected) return;
    const response = await apiFetch(
      `/api/operations/negotiations/${selected.id}/settle`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ action }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar o pagamento");
      return;
    }
    await refresh();
  };

  const sendOffer = async () => {
    if (!selected) return;
    const response = await apiFetch(`/api/negotiations/${selected.id}/offer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        amount: offerAmount,
        message: offerMessage,
      }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível enviar a oferta");
      return;
    }
    setOfferAmount("");
    setOfferMessage("");
    await refresh();
  };

  const sendMessage = async () => {
    if (!selected || !message.trim()) return;
    const response = await apiFetch(
      `/api/negotiations/${selected.id}/messages`,
      { method: "POST", headers, body: JSON.stringify({ body: message }) },
    );
    if (!response.ok) return;
    setMessage("");
    await refresh();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
            Operação comercial
          </p>
          <h2 className="mt-1 text-2xl font-bold text-[#0b1d3a]">
            Negociações
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Crie propostas, acompanhe contrapropostas e feche fretes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1052c7] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b3f9f]"
        >
          <Plus size={16} /> Nova negociação
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              value={form.driverId}
              onChange={(event) =>
                setForm({ ...form, driverId: event.target.value })
              }
            >
              <option value="">Selecionar motorista</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.full_name}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              value={form.collectionPointId}
              onChange={(event) =>
                setForm({ ...form, collectionPointId: event.target.value })
              }
            >
              <option value="">Posto de coleta</option>
              {collectionPoints.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              value={form.finalCustomerId}
              onChange={(event) =>
                setForm({ ...form, finalCustomerId: event.target.value })
              }
            >
              <option value="">Cliente final</option>
              {finalCustomers.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              placeholder="Produto / carga"
              value={form.cargo}
              onChange={(event) =>
                setForm({ ...form, cargo: event.target.value })
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              placeholder="Quantidade ou capacidade"
              value={form.quantity}
              onChange={(event) =>
                setForm({ ...form, quantity: event.target.value })
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              placeholder="Produto"
              value={form.product}
              onChange={(event) =>
                setForm({ ...form, product: event.target.value })
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              placeholder="CTe (opcional)"
              value={form.cteNumber}
              onChange={(event) =>
                setForm({ ...form, cteNumber: event.target.value })
              }
            />
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.documentsReleased}
                onChange={(event) =>
                  setForm({ ...form, documentsReleased: event.target.checked })
                }
              />
              Documentos liberados
            </label>
            <input
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              inputMode="decimal"
              placeholder="Distância (km)"
              value={routeDistanceKm?.toFixed(2) ?? form.distanceKm}
              readOnly
              disabled
            />
            <input
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Valor por km *"
              value={form.pricePerKm}
              onChange={(event) =>
                setForm({
                  ...form,
                  pricePerKm: formatMoneyInput(event.target.value),
                })
              }
            />
            <input
              className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500"
              value={
                routeDistanceKm && form.pricePerKm
                  ? `Total: ${formatBRL(routeDistanceKm * parseBRL(form.pricePerKm))}`
                  : "Total calculado após informar R$/km"
              }
              readOnly
              disabled
            />
          </div>
          {error && (
            <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void createNegotiation()}
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving
              ? "Calculando e enviando..."
              : "Calcular rota e enviar ao motorista"}
          </button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">Todos os status</option>
            {Object.entries(statusLabels)
              .filter(([value]) => value !== "completed")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
          <div className="space-y-2">
            {visible.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-xl border p-3 text-left ${selectedId === item.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm text-[#0b1d3a]">
                    {item.driver?.full_name ?? "Motorista"}
                  </strong>
                  <span className="text-[11px] font-semibold text-blue-700">
                    {statusLabels[item.status] ?? item.status}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {item.collection_point?.name} → {item.final_customer?.name}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-700">
                  {formatBRL(item.current_value)}
                </p>
              </button>
            ))}
            {!visible.length && (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Nenhuma negociação encontrada.
              </p>
            )}
          </div>
        </div>

        {selected ? (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Negociação
                </p>
                <h3 className="mt-1 text-xl font-bold text-[#0b1d3a]">
                  {selected.driver?.full_name}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selected.collection_point?.name} →{" "}
                  {selected.final_customer?.name}
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                {statusLabels[selected.status] ?? selected.status}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Info label="Carga" value={selected.cargo ?? "Não informada"} />
              <Info
                label="Quantidade"
                value={selected.quantity ?? "Não informada"}
              />
              <Info
                label="Valor atual"
                value={formatBRL(selected.current_value)}
              />
            </div>
            <PricingEditor
              negotiation={selected}
              headers={headers}
              onUpdated={refresh}
              onError={setError}
            />
            <div>
              <h4 className="mb-2 text-sm font-bold text-[#0b1d3a]">Ofertas</h4>
              {selected.offers.map((offer) => (
                <div
                  key={offer.id}
                  className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>
                    {offer.user?.full_name ?? "Usuário"}:{" "}
                    {offer.message || "Oferta"}
                  </span>
                  <strong>{formatBRL(offer.amount)}</strong>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  placeholder="Nova oferta"
                  value={offerAmount}
                  onChange={(event) =>
                    setOfferAmount(formatMoneyInput(event.target.value))
                  }
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void sendOffer()}
                  className="rounded-xl bg-blue-600 px-3 text-white"
                  title="Enviar oferta"
                >
                  <Send size={16} />
                </button>
              </div>
              <input
                placeholder="Mensagem da oferta (opcional)"
                value={offerMessage}
                onChange={(event) => setOfferMessage(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-bold text-[#0b1d3a]">
                Mensagens
              </h4>
              {selected.messages.map((item) => (
                <p
                  key={item.id}
                  className="mb-1 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <strong>{item.user?.full_name ?? "Usuário"}:</strong>{" "}
                  {item.body}
                </p>
              ))}
              <div className="flex gap-2">
                <input
                  placeholder="Escreva uma mensagem"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  className="rounded-xl bg-slate-800 px-3 text-white"
                  title="Enviar mensagem"
                >
                  <MessageCircle size={16} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void negotiationAction("cancel")}
                className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
              >
                <X size={14} className="mr-1 inline" />
                Cancelar
              </button>
              {selected.status === "driver_completed" && (
                <>
                  <button
                    type="button"
                    onClick={() => void settleFreight("approve")}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Aprovar conclusão
                  </button>
                  <button
                    type="button"
                    onClick={() => void settleFreight("reject")}
                    className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                  >
                    Devolver para conferência
                  </button>
                </>
              )}
              {selected.status === "completed" &&
                selected.wallet_status === "approved" && (
                  <button
                    type="button"
                    onClick={() => void settleFreight("pay")}
                    className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Marcar pagamento realizado
                  </button>
                )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-sm text-slate-500">
            Selecione uma negociação para ver os detalhes.
          </div>
        )}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-700">{value}</p>
    </div>
  );
}

function PricingEditor({
  negotiation,
  headers,
  onUpdated,
  onError,
}: {
  negotiation: Negotiation;
  headers: Record<string, string>;
  onUpdated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [distanceKm, setDistanceKm] = useState(
    formatDecimalBR(negotiation.distance_km),
  );
  const [pricePerKm, setPricePerKm] = useState(
    formatDecimalBR(negotiation.price_per_km),
  );
  const [saving, setSaving] = useState(false);
  const isOpen =
    negotiation.status === "pending" || negotiation.status === "countered";

  const save = async () => {
    setSaving(true);
    const response = await apiFetch(
      `/api/negotiations/${negotiation.id}/pricing`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          distanceKm,
          pricePerKm,
        }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      onError(body.error ?? "Não foi possível atualizar a tarifa");
    } else {
      await onUpdated();
    }
    setSaving(false);
  };

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-amber-950">Tarifa da operação</h4>
        <span className="text-xs font-semibold text-amber-800">
          Total:{" "}
          {formatBRL(parseBRL(distanceKm || "0") * parseBRL(pricePerKm || "0"))}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          inputMode="decimal"
          value={distanceKm}
          onChange={(event) => setDistanceKm(event.target.value)}
          placeholder="Km"
          disabled={!isOpen}
          className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
        />
        <input
          value={pricePerKm}
          onChange={(event) =>
            setPricePerKm(formatMoneyInput(event.target.value))
          }
          placeholder="R$/km"
          disabled={!isOpen}
          className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={!isOpen || saving}
          onClick={() => void save()}
          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Atualizar valor"}
        </button>
      </div>
    </div>
  );
}
