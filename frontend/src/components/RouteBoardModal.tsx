import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  CheckCircle2,
  Loader2,
  MapPin,
  MessageCircle,
  Route as RouteIcon,
  X,
} from "lucide-react";
import { apiEventSource, apiFetch } from "@/lib/api";

type RouteBoardPlace = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
};

type RouteBoardItem = {
  id: string;
  collection_point: RouteBoardPlace;
  final_customer: RouteBoardPlace;
  distance_km: number | null;
  created_at: string;
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
});

// Eventos do servidor que podem mudar a lista de rotas em aberto.
const refreshEvents = new Set([
  "route-alert",
  "route-board-updated",
  "freight-route-created",
  "freight-route-assigned",
  "freight-route-updated",
]);

const placeCity = (place: RouteBoardPlace) =>
  [place.city, place.state].filter(Boolean).join("/");

/**
 * Mural de rotas em aberto. Abre ao entrar no portal e quando a operação
 * dispara "alertar motoristas". O aceite é registrado no chat com a operação.
 */
export function RouteBoardModal({
  open,
  onClose,
  onAccepted,
}: {
  open: boolean;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [routes, setRoutes] = useState<RouteBoardItem[]>([]);
  const [hasActiveRoute, setHasActiveRoute] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/drivers/me/route-board", {
        headers: authHeaders(),
      });
      const body = (await response.json().catch(() => ({}))) as {
        routes?: RouteBoardItem[];
        has_active_route?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Não foi possível carregar as rotas.");
        return;
      }
      setRoutes(body.routes ?? []);
      setHasActiveRoute(body.has_active_route === true);
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setConfirmingId(null);
    void load();
    const token = localStorage.getItem("acneto-access-token");
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    const onEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type && refreshEvents.has(payload.type)) void load();
      } catch {
        // Ignora eventos malformados.
      }
    };
    events?.addEventListener("message", onEvent);
    return () => {
      events?.removeEventListener("message", onEvent);
      events?.close();
    };
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const accept = async (routeId: string) => {
    setAcceptingId(routeId);
    setError("");
    try {
      const response = await apiFetch(
        `/api/drivers/me/route-board/${routeId}/accept`,
        { method: "POST", headers: authHeaders() },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Não foi possível aceitar a rota.");
        setConfirmingId(null);
        void load();
        return;
      }
      onAccepted();
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setAcceptingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-board-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-slate-100 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1052c7]">
            <RouteIcon size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="route-board-title"
              className="text-lg font-bold text-[#0b1d3a]"
            >
              Mural de rotas
            </h2>
            <p className="text-sm text-slate-500">
              {loading
                ? "Carregando rotas em aberto…"
                : routes.length === 1
                  ? "1 rota em aberto"
                  : `${routes.length} rotas em aberto`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar mural de rotas"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
            >
              {error}
            </p>
          )}
          {hasActiveRoute && !loading && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Você já tem uma rota em andamento. Conclua-a para aceitar outra.
            </p>
          )}
          {loading && (
            <div className="flex justify-center py-10 text-slate-400">
              <Loader2 className="animate-spin" size={26} />
            </div>
          )}
          {!loading && routes.length === 0 && !error && (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto text-slate-300" size={36} />
              <p className="mt-3 text-sm font-semibold text-slate-600">
                Nenhuma rota em aberto no momento.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Quando a operação alertar novas rotas, este mural abre sozinho.
              </p>
            </div>
          )}
          {!loading &&
            routes.map((route) => (
              <article
                key={route.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center pt-1 text-slate-400">
                    <MapPin size={16} className="text-[#1052c7]" />
                    <ArrowDown size={14} className="my-1" />
                    <MapPin size={16} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        Coleta
                      </p>
                      <p className="truncate text-sm font-semibold text-[#0b1d3a]">
                        {route.collection_point.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {placeCity(route.collection_point) ||
                          route.collection_point.address}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        Entrega
                      </p>
                      <p className="truncate text-sm font-semibold text-[#0b1d3a]">
                        {route.final_customer.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {placeCity(route.final_customer) ||
                          route.final_customer.address}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {Number.isFinite(route.distance_km) && (
                      <p className="text-sm font-bold text-[#0b1d3a]">
                        {Math.round(route.distance_km!)} km
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      {new Date(route.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>

                {confirmingId === route.id ? (
                  <div className="mt-4 rounded-lg bg-blue-50 p-3">
                    <p className="text-sm text-[#0b1d3a]">
                      Confirmar o aceite desta rota? A operação será avisada
                      pelo chat.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={acceptingId === route.id}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void accept(route.id)}
                        disabled={acceptingId === route.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#1052c7] px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
                      >
                        {acceptingId === route.id && (
                          <Loader2 className="animate-spin" size={15} />
                        )}
                        Confirmar aceite
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(route.id)}
                    disabled={hasActiveRoute || acceptingId !== null}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1052c7] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0a3a90] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <MessageCircle size={16} /> Aceitar pelo chat
                  </button>
                )}
              </article>
            ))}
        </div>
      </div>
    </div>
  );
}
