import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Attachment = { id: string; name: string; mime_type: string };
type Ticket = {
  id: string;
  subject: string;
  description: string;
  location: string | null;
  page_url: string | null;
  status: string;
  staff_note: string | null;
  escalated_at: string | null;
  escalated_by: string | null;
  response_saved: boolean;
  escalation_note: string | null;
  created_at: string;
  attachments: Attachment[];
  user?: {
    full_name: string | null;
    email: string;
    phone: string | null;
    role: string | null;
  };
};
type TicketsResponse = {
  tickets: Ticket[];
  counts: Record<string, number>;
  escalated_open: number;
};

const statusLabels: Record<string, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  resolved: "Resolvido",
  closed: "Fechado",
};
const statusStyles: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-600",
};
const roleLabels: Record<string, string> = {
  driver: "Motorista",
  operator: "Operador",
  client: "Cliente",
  carrier: "Transportadora",
  admin: "Administrador",
};
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

// Número do selo na aba: abertos para o administrador; repassados pendentes para o super administrador.
export function useSupportBadge(enabled: boolean, isSuperAdmin: boolean) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !token) return;
    const refresh = () => {
      void apiFetch("/api/admin/support/tickets?status=open", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (response) =>
          response.ok ? ((await response.json()) as TicketsResponse) : null,
        )
        .then((body) => {
          if (body)
            setCount(
              isSuperAdmin ? body.escalated_open : (body.counts.open ?? 0),
            );
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [enabled, isSuperAdmin, token]);
  return count;
}

type View = "inbox" | "forward" | "escalated";

export function SupportTicketsAdmin({
  isSuperAdmin,
}: {
  isSuperAdmin: boolean;
}) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [view, setView] = useState<View>("inbox");
  const [origin, setOrigin] = useState("all");
  const [status, setStatus] = useState("open");
  const [forwardFilter, setForwardFilter] = useState("pending");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [forwardNotes, setForwardNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const imagesRef = useRef<Record<string, string>>({});
  imagesRef.current = images;

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (view === "forward") params.set("origin", "operators");
    else if (view === "escalated") params.set("origin", "escalated");
    else if (origin !== "all") params.set("origin", origin);
    if (view === "inbox" && status !== "all") params.set("status", status);
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/admin/support/tickets?${params.toString()}`,
        { headers: headers() },
      );
      if (!response.ok)
        throw new Error("Não foi possível carregar os chamados");
      setTickets(((await response.json()) as TicketsResponse).tickets);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [view, origin, status, headers]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(
    () => () => {
      Object.values(imagesRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const loadImage = async (ticketId: string, attachment: Attachment) => {
    if (imagesRef.current[attachment.id]) return;
    const response = await apiFetch(
      `/api/support/tickets/${ticketId}/attachments/${attachment.id}`,
      { headers: headers() },
    );
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    setImages((current) => ({ ...current, [attachment.id]: url }));
  };

  const toggle = (ticket: Ticket) => {
    const next = expandedId === ticket.id ? null : ticket.id;
    setExpandedId(next);
    if (next)
      ticket.attachments.forEach((item) => void loadImage(ticket.id, item));
  };

  const call = async (
    ticket: Ticket,
    path: string,
    method: "PATCH" | "POST",
    payload: Record<string, unknown>,
  ) => {
    setBusyId(ticket.id);
    setError("");
    try {
      const response = await apiFetch(path, {
        method,
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível concluir a ação");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const update = (ticket: Ticket, changes: Record<string, unknown>) =>
    call(ticket, `/api/admin/support/tickets/${ticket.id}`, "PATCH", changes);

  const forward = (ticket: Ticket) =>
    call(ticket, `/api/admin/support/tickets/${ticket.id}/escalate`, "POST", {
      note: forwardNotes[ticket.id] ?? "",
    });

  const visible =
    view === "forward"
      ? tickets.filter((ticket) =>
          forwardFilter === "pending"
            ? !ticket.escalated_at
            : forwardFilter === "forwarded"
              ? Boolean(ticket.escalated_at)
              : true,
        )
      : tickets;

  const views: Array<[View, string]> = [
    ["inbox", "Chamados recebidos"],
    ...(isSuperAdmin
      ? ([["escalated", "Repassados a mim"]] as Array<[View, string]>)
      : ([["forward", "Repassar ao super admin"]] as Array<[View, string]>)),
  ];

  const renderCard = (ticket: Ticket) => {
    const locked = Boolean(ticket.escalated_at) && !isSuperAdmin;
    const resolved = ticket.status === "resolved";
    const fromOperator = ticket.user?.role === "operator";
    return (
      <div
        key={ticket.id}
        className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
      >
        <button
          type="button"
          onClick={() => toggle(ticket)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[#0b1d3a]">
              {ticket.subject}
            </span>
            <span className="block text-xs text-slate-500">
              {ticket.user?.full_name ?? ticket.user?.email} ·{" "}
              {roleLabels[ticket.user?.role ?? ""] ?? "Usuário"} ·{" "}
              {new Date(ticket.created_at).toLocaleString("pt-BR")}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            {ticket.escalated_at && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">
                Repassado
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusStyles[ticket.status] ?? ""}`}
            >
              {statusLabels[ticket.status] ?? ticket.status}
            </span>
          </span>
        </button>
        {expandedId === ticket.id && (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">
              {ticket.user?.email}
              {ticket.user?.phone ? ` · ${ticket.user.phone}` : ""}
            </p>
            <p className="whitespace-pre-wrap text-slate-700">
              {ticket.description}
            </p>
            {ticket.location && (
              <p className="text-xs text-slate-500">
                <strong>Onde:</strong> {ticket.location}
              </p>
            )}
            {ticket.page_url && (
              <p className="break-all text-xs text-slate-400">
                {ticket.page_url}
              </p>
            )}
            {ticket.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ticket.attachments.map((item) =>
                  images[item.id] ? (
                    <a
                      key={item.id}
                      href={images[item.id]}
                      target="_blank"
                      rel="noreferrer"
                      title={item.name}
                    >
                      <img
                        src={images[item.id]}
                        alt={item.name}
                        className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                      />
                    </a>
                  ) : (
                    <span
                      key={item.id}
                      className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
                    >
                      <Loader2 size={16} className="animate-spin" />
                    </span>
                  ),
                )}
              </div>
            )}
            {ticket.escalated_at && (
              <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-900">
                Repassado ao super administrador por{" "}
                <strong>{ticket.escalated_by ?? "administrador"}</strong> em{" "}
                {new Date(ticket.escalated_at).toLocaleString("pt-BR")}.
                {ticket.escalation_note && (
                  <>
                    <br />
                    <strong>Observação:</strong> {ticket.escalation_note}
                  </>
                )}
              </p>
            )}
            {view === "forward" &&
              !ticket.escalated_at &&
              !resolved &&
              fromOperator && (
                <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={forwardNotes[ticket.id] ?? ""}
                    onChange={(event) =>
                      setForwardNotes((current) => ({
                        ...current,
                        [ticket.id]: event.target.value,
                      }))
                    }
                    placeholder="Observação para o super administrador (opcional)"
                    className={`${inputClass} resize-none`}
                  />
                  <button
                    type="button"
                    disabled={busyId === ticket.id}
                    onClick={() => void forward(ticket)}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    <Send size={14} />{" "}
                    {busyId === ticket.id
                      ? "Repassando..."
                      : "Repassar ao super admin"}
                  </button>
                </div>
              )}
            {resolved ? (
              <div className="space-y-1 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                <p className="font-semibold">
                  Chamado resolvido. Não pode mais ser alterado.
                </p>
                {ticket.staff_note && (
                  <p>
                    <strong>Resposta:</strong> {ticket.staff_note}
                  </p>
                )}
              </div>
            ) : locked ? (
              <p className="text-xs font-semibold text-violet-700">
                Aguardando o super administrador. Este chamado não pode mais ser
                alterado por aqui.
              </p>
            ) : (
              <div className="space-y-2">
                <select
                  value={ticket.status}
                  disabled={busyId === ticket.id}
                  onChange={(event) => {
                    if (
                      event.target.value === "resolved" &&
                      !window.confirm(
                        "Ao marcar como resolvido, o chamado não poderá mais ser alterado. Continuar?",
                      )
                    )
                      return;
                    void update(ticket, { status: event.target.value });
                  }}
                  className={inputClass}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  maxLength={2000}
                  disabled={ticket.response_saved || busyId === ticket.id}
                  value={notes[ticket.id] ?? ticket.staff_note ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({
                      ...current,
                      [ticket.id]: event.target.value,
                    }))
                  }
                  placeholder="Resposta para o usuário"
                  className={`${inputClass} resize-none`}
                />
                <button
                  type="button"
                  disabled={ticket.response_saved || busyId === ticket.id}
                  onClick={() =>
                    void update(ticket, {
                      staffNote: notes[ticket.id] ?? ticket.staff_note ?? "",
                    })
                  }
                  className="rounded-lg bg-[#1052c7] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {ticket.response_saved ? "Resposta salva" : "Salvar resposta"}
                </button>
                {ticket.response_saved && (
                  <p className="text-xs text-slate-500">
                    Para enviar uma nova resposta, altere antes o status do
                    chamado.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0b1d3a]">Chamados</h1>
          <p className="text-sm text-slate-500">
            {view === "inbox"
              ? "Chamados abertos por motoristas, operadores e demais usuários."
              : view === "forward"
                ? "Repasse ao super administrador os chamados de operadores que você não consegue resolver."
                : "Chamados de operadores repassados pelos administradores."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {views.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setView(value);
                setExpandedId(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === value ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "inbox" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            className={inputClass}
          >
            <option value="all">Todas as origens</option>
            <option value="drivers">Motoristas</option>
            <option value="operators">Operadores</option>
            <option value="others">Clientes e transportadoras</option>
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClass}
          >
            <option value="open">Abertos</option>
            <option value="in_progress">Em andamento</option>
            <option value="resolved">Resolvidos</option>
            <option value="closed">Fechados</option>
            <option value="all">Todos os status</option>
          </select>
        </div>
      )}
      {view === "forward" && (
        <select
          value={forwardFilter}
          onChange={(event) => setForwardFilter(event.target.value)}
          className={inputClass}
        >
          <option value="pending">Ainda não repassados</option>
          <option value="forwarded">Já repassados</option>
          <option value="all">Todos os chamados de operadores</option>
        </select>
      )}

      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
      {loading && tickets.length === 0 ? (
        <p className="text-sm text-slate-500">Carregando chamados...</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhum chamado neste filtro.
        </p>
      ) : (
        <div className="space-y-3">{visible.map(renderCard)}</div>
      )}
    </div>
  );
}
