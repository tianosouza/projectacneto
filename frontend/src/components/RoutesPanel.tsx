import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { divIcon, type LatLngTuple } from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart3,
  Bell,
  Download,
  DollarSign,
  Factory,
  FileText,
  MapPin,
  Plus,
  Paperclip,
  Truck,
  UsersRound,
  X,
} from "lucide-react";
import { apiEventSource, apiFetch } from "@/lib/api";
import { FreightChatHistory } from "@/components/FreightChatHistory";
import type {
  DemoContact,
  DemoDriver,
  FreightRoute,
  FreightRouteDashboard,
  FreightRouteReportSummary,
  FreightSettlement,
} from "@/lib/dashboardTypes";

const statusLabels: Record<string, string> = {
  open: "Aberta",
  assigned: "Designada",
  in_progress: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const statusBadgeClasses: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  assigned: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const formatFreightCents = (amount: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount / 100);

type PaymentProofUpload = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

const paymentProofTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const encodePaymentProof = (file: File): Promise<PaymentProofUpload> =>
  new Promise((resolve, reject) => {
    if (!paymentProofTypes.has(file.type)) {
      reject(new Error("Anexe o comprovante em PDF, JPEG ou PNG."));
      return;
    }
    if (file.size === 0 || file.size > 8 * 1024 * 1024) {
      reject(new Error("O comprovante deve ter até 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Não foi possível ler o comprovante."));
        return;
      }
      resolve({
        fileName: file.name,
        mimeType: file.type,
        dataBase64: reader.result.slice(reader.result.indexOf(",") + 1),
      });
    };
    reader.onerror = () =>
      reject(new Error("Não foi possível ler o comprovante."));
    reader.readAsDataURL(file);
  });

const freightProgressLabels: Record<
  FreightRoute["assignments"][number]["progress_status"],
  string
> = {
  assigned: "Aguardando início",
  en_route_collection: "A caminho da coleta",
  awaiting_collection_confirmation: "Chegada à coleta pendente de confirmação",
  collection_confirmed: "Coleta confirmada",
  en_route_customer: "A caminho do cliente final",
  awaiting_customer_confirmation: "Chegada ao cliente pendente de confirmação",
  completed: "Frete concluído",
};

function authHeaders() {
  const token = localStorage.getItem("acneto-access-token");
  return {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };
}

function routeMarkerIcon(kind: "collection_point" | "final_customer") {
  const isCollectionPoint = kind === "collection_point";
  const background = isCollectionPoint ? "#0e4db7" : "#d97706";
  const Icon = isCollectionPoint ? Factory : UsersRound;
  return divIcon({
    className: "route-map-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -34],
    html: renderToStaticMarkup(
      <div
        style={{
          alignItems: "center",
          background,
          border: "3px solid white",
          borderRadius: "50% 50% 50% 4px",
          boxShadow: "0 3px 8px rgba(15, 23, 42, 0.28)",
          color: "white",
          display: "flex",
          height: "34px",
          justifyContent: "center",
          transform: "rotate(-45deg)",
          width: "34px",
        }}
      >
        <span style={{ transform: "rotate(45deg)", display: "flex" }}>
          <Icon size={18} strokeWidth={2.4} />
        </span>
      </div>,
    ),
  });
}

const routeLineColors = [
  "#1052c7",
  "#16a34a",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
];

function RoutesMapViewport({ points }: { points: LatLngTuple[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [32, 32], maxZoom: 11 });
    }
  }, [map, points]);

  return null;
}

function RoutesMap({ routes }: { routes: FreightRoute[] }) {
  const located = useMemo(
    () =>
      routes.filter(
        (route) =>
          Number.isFinite(route.collection_point?.latitude) &&
          Number.isFinite(route.collection_point?.longitude) &&
          Number.isFinite(route.final_customer?.latitude) &&
          Number.isFinite(route.final_customer?.longitude),
      ),
    [routes],
  );
  const allPoints = useMemo(
    () =>
      located.flatMap(
        (route) =>
          [
            [
              route.collection_point!.latitude!,
              route.collection_point!.longitude!,
            ] as LatLngTuple,
            [
              route.final_customer!.latitude!,
              route.final_customer!.longitude!,
            ] as LatLngTuple,
          ] satisfies LatLngTuple[],
      ),
    [located],
  );

  if (located.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
        Selecione ao menos uma rota com coordenadas GPS para exibi-la no mapa.
      </p>
    );
  }

  return (
    <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200">
      <MapContainer
        className="h-full w-full"
        center={[-14.235, -51.9253]}
        zoom={4}
        scrollWheelZoom
        zoomControl
      >
        <RoutesMapViewport points={allPoints} />
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>, World Street Map'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
        />
        {located.map((route, index) => {
          const collection: LatLngTuple = [
            route.collection_point!.latitude as number,
            route.collection_point!.longitude as number,
          ];
          const final: LatLngTuple = [
            route.final_customer!.latitude as number,
            route.final_customer!.longitude as number,
          ];
          const color = routeLineColors[index % routeLineColors.length];
          return (
            <Fragment key={route.id}>
              <Marker
                position={collection}
                icon={routeMarkerIcon("collection_point")}
              >
                <Popup>
                  <strong>{route.collection_point?.name}</strong>
                  <br />
                  Posto de coleta · rota {route.collection_point?.name} →{" "}
                  {route.final_customer?.name}
                </Popup>
              </Marker>
              <Marker position={final} icon={routeMarkerIcon("final_customer")}>
                <Popup>
                  <strong>{route.final_customer?.name}</strong>
                  <br />
                  Cliente final
                </Popup>
              </Marker>
              <Polyline
                positions={[collection, final]}
                pathOptions={{ color, weight: 4, opacity: 0.85 }}
              />
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}

function NewRouteModal({
  open,
  onClose,
  collectionPoints,
  finalCustomers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  collectionPoints: DemoContact[];
  finalCustomers: DemoContact[];
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    collectionPointId: "",
    finalCustomerId: "",
    notifyAllDrivers: false,
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      collectionPointId: "",
      finalCustomerId: "",
      notifyAllDrivers: false,
    });
    setError("");
    setSuccess("");
    setDone(false);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError("");
    if (!form.collectionPointId || !form.finalCustomerId) {
      setError("Selecione o posto de coleta e o cliente final");
      return;
    }
    if (form.collectionPointId === form.finalCustomerId) {
      setError("Posto de coleta e cliente final devem ser diferentes");
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/freight-routes", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          collectionPointId: form.collectionPointId,
          finalCustomerId: form.finalCustomerId,
          notifyAllDrivers: form.notifyAllDrivers,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        notification_message?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível criar a rota");
      await onCreated();
      setSuccess(body.notification_message ?? "Rota criada com sucesso.");
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#0b1d3a]">Nova rota</h2>
            <p className="mt-1 text-sm text-slate-500">
              Selecione o posto de coleta e o cliente final. A distância é
              calculada automaticamente a partir dos endereços cadastrados.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <select
            value={form.collectionPointId}
            onChange={(event) =>
              setForm({ ...form, collectionPointId: event.target.value })
            }
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Posto de coleta</option>
            {collectionPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.name}
              </option>
            ))}
          </select>
          <select
            value={form.finalCustomerId}
            onChange={(event) =>
              setForm({ ...form, finalCustomerId: event.target.value })
            }
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Cliente final</option>
            {finalCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.notifyAllDrivers}
              onChange={(event) =>
                setForm({
                  ...form,
                  notifyAllDrivers: event.target.checked,
                })
              }
              disabled={done}
              className="mt-0.5 h-4 w-4 accent-blue-700"
            />
            <span>
              <span className="block font-semibold text-[#0b1d3a]">
                Enviar alerta para todos os motoristas online (opcional)
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Avisa os motoristas online que há uma nova rota disponível. Não
                precisa informar valor.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {success && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          {!done && (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => (done ? onClose() : void submit())}
            disabled={saving}
            className="flex-1 rounded-xl bg-[#1052c7] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0b3f9f] disabled:opacity-60"
          >
            {saving ? "Criando..." : done ? "Concluir" : "Criar rota"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoutesListTab({ drivers }: { drivers: DemoDriver[] }) {
  const [routes, setRoutes] = useState<FreightRoute[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignDriverId, setAssignDriverId] = useState("");
  const [alertSending, setAlertSending] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [error, setError] = useState("");
  const [locations, setLocations] = useState<DemoContact[]>([]);
  const [mapRouteIds, setMapRouteIds] = useState<string[]>([]);

  const refresh = async () => {
    const response = await apiFetch("/api/freight-routes", {
      headers: authHeaders(),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { routes: FreightRoute[] };
    setRoutes(body.routes);
    setSelectedId((current) => current ?? body.routes[0]?.id ?? null);
  };

  const loadLocations = async () => {
    const response = await apiFetch("/api/operations/locations", {
      headers: authHeaders(),
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      locations: Array<{ id: string; kind: string; name: string }>;
    };
    setLocations(
      body.locations.map((location) => ({
        id: location.id,
        kind: location.kind as "collection_point" | "final_customer",
        name: location.name,
        email: "",
        region: "",
        accessLevel: "cliente" as const,
        status: "ativo" as const,
        latitude: null,
        longitude: null,
      })),
    );
  };

  useEffect(() => {
    void refresh();
    void loadLocations();
    const token = localStorage.getItem("acneto-access-token");
    const interval = window.setInterval(() => void refresh(), 8000);
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    const onEvent = () => void refresh();
    events?.addEventListener("message", onEvent);
    return () => {
      window.clearInterval(interval);
      events?.removeEventListener("message", onEvent);
      events?.close();
    };
  }, []);

  const collectionPoints = locations.filter(
    (location) => location.kind === "collection_point",
  );
  const finalCustomers = locations.filter(
    (location) => location.kind === "final_customer",
  );

  const visible = useMemo(
    () =>
      routes.filter(
        (route) => statusFilter === "all" || route.status === statusFilter,
      ),
    [routes, statusFilter],
  );
  const selected = routes.find((route) => route.id === selectedId) ?? null;

  const toggleMapRoute = (routeId: string) => {
    setMapRouteIds((current) =>
      current.includes(routeId)
        ? current.filter((id) => id !== routeId)
        : [...current, routeId],
    );
  };
  const selectedMapRoutes = routes.filter((route) =>
    mapRouteIds.includes(route.id),
  );

  const assignDriver = async () => {
    if (!selected || !assignDriverId) return;
    setError("");
    const response = await apiFetch(
      `/api/freight-routes/${selected.id}/assign`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ driverId: assignDriverId }),
      },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Não foi possível vincular o motorista");
      return;
    }
    setAssignDriverId("");
    await refresh();
  };

  const endAssignment = async (assignmentId: string, status: "cancelled") => {
    if (!selected) return;
    const response = await apiFetch(
      `/api/freight-routes/${selected.id}/assignments/${assignmentId}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível encerrar o vínculo");
      return;
    }
    await refresh();
  };

  const confirmArrival = async (
    assignmentId: string,
    action: "confirm_collection" | "confirm_customer",
  ) => {
    if (!selected) return;
    const response = await apiFetch(
      `/api/freight-routes/${selected.id}/assignments/${assignmentId}/progress`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível confirmar a chegada.");
      return;
    }
    setError("");
    await refresh();
  };

  const updateRouteStatus = async (status: string) => {
    if (!selected) return;
    const response = await apiFetch(`/api/freight-routes/${selected.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar a rota");
      return;
    }
    await refresh();
  };

  const alertAvailableRoutes = async () => {
    if (alertSending) return;
    if (
      !window.confirm(
        "Enviar alerta com todas as rotas em aberto para todos os motoristas homologados?",
      )
    )
      return;
    setError("");
    setAlertMessage("");
    setAlertSending(true);
    try {
      const response = await apiFetch("/api/freight-route-alerts/open", {
        method: "POST",
        headers: authHeaders(),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível enviar o alerta");
      setAlertMessage(body.message ?? "Alerta enviado.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setAlertSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="all">Todos os status</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void alertAvailableRoutes()}
            disabled={alertSending}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            <Bell size={16} />{" "}
            {alertSending ? "Enviando..." : "Alertar motoristas"}
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1052c7] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b3f9f]"
          >
            <Plus size={16} /> Nova rota
          </button>
        </div>
      </div>

      {alertMessage && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {alertMessage}
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {visible.length === 0 && (
            <p className="p-3 text-sm text-slate-500">
              Nenhuma rota encontrada.
            </p>
          )}
          {visible.map((route) => (
            <div
              key={route.id}
              className={`w-full rounded-xl border p-3 transition ${
                selectedId === route.id
                  ? "border-blue-300 bg-blue-50"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={mapRouteIds.includes(route.id)}
                  onChange={() => toggleMapRoute(route.id)}
                  title="Exibir esta rota no mapa"
                  className="mt-1 h-4 w-4 shrink-0 accent-[#1052c7]"
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(route.id)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-[#0b1d3a]">
                      {route.collection_point?.name ?? "?"} →{" "}
                      {route.final_customer?.name ?? "?"}
                    </strong>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClasses[route.status]}`}
                    >
                      {statusLabels[route.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Distância: {route.distance_km?.toFixed(1) ?? "—"} km
                  </p>
                </button>
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-[#0b1d3a]">
                  {selected.collection_point?.name} →{" "}
                  {selected.final_customer?.name}
                </h3>
                <p className="text-sm text-slate-500">
                  Distância: {selected.distance_km?.toFixed(1) ?? "—"} km
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClasses[selected.status]}`}
              >
                {statusLabels[selected.status]}
              </span>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Motoristas e ofertas negociadas
              </p>
              {selected.chat_offers.length > 0 && (
                <div className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3">
                  {selected.chat_offers.map((offer) => (
                    <div
                      key={offer.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#0b1d3a]">
                          {offer.driver?.full_name ?? "Motorista"} ·{" "}
                          {formatFreightCents(offer.amount_cents)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(offer.created_at).toLocaleString("pt-BR")}
                          {offer.created_by?.full_name &&
                            ` · enviado por ${offer.created_by.full_name}`}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">
                        {
                          {
                            offered: "Aguardando resposta",
                            accepted: "Aceita · em andamento",
                            rejected: "Recusada",
                            completed: "Frete concluído",
                            superseded: "Substituída",
                          }[offer.status]
                        }
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {selected.assignments.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Nenhum motorista vinculado ainda.
                  </p>
                )}
                {selected.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#0b1d3a]">
                        {assignment.driver?.full_name ?? "Motorista"}
                      </p>
                      <p className="text-xs text-slate-500">
                        Capacidade: {assignment.capacity ?? "—"} · Status:{" "}
                        {assignment.status}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-600">
                        Etapa:{" "}
                        {freightProgressLabels[assignment.progress_status]}
                      </p>
                      {assignment.collection_arrived_at && (
                        <p className="text-xs text-slate-500">
                          Chegada ao posto:{" "}
                          {new Date(
                            assignment.collection_arrived_at,
                          ).toLocaleString("pt-BR")}
                          {assignment.collection_confirmed_at &&
                            " · Confirmada"}
                        </p>
                      )}
                      {assignment.customer_arrived_at && (
                        <p className="text-xs text-slate-500">
                          Chegada ao cliente:{" "}
                          {new Date(
                            assignment.customer_arrived_at,
                          ).toLocaleString("pt-BR")}
                          {assignment.customer_confirmed_at && " · Confirmada"}
                        </p>
                      )}
                      {assignment.chat_offer && (
                        <p className="mt-1 text-xs font-semibold text-emerald-700">
                          Oferta aceita no chat:{" "}
                          {formatFreightCents(
                            assignment.chat_offer.amount_cents,
                          )}
                        </p>
                      )}
                    </div>
                    {assignment.status === "active" && (
                      <div className="flex flex-col items-end gap-2">
                        {assignment.progress_status ===
                          "awaiting_collection_confirmation" && (
                          <button
                            type="button"
                            onClick={() =>
                              void confirmArrival(
                                assignment.id,
                                "confirm_collection",
                              )
                            }
                            className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                          >
                            Confirmar chegada ao posto
                          </button>
                        )}
                        {assignment.progress_status ===
                          "awaiting_customer_confirmation" && (
                          <button
                            type="button"
                            onClick={() =>
                              void confirmArrival(
                                assignment.id,
                                "confirm_customer",
                              )
                            }
                            className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                          >
                            Confirmar chegada ao cliente
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void endAssignment(assignment.id, "cancelled")
                          }
                          className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                    {assignment.status === "completed" && (
                      <FreightChatHistory
                        routeId={selected.id}
                        assignmentId={assignment.id}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {["open", "assigned", "in_progress"].includes(selected.status) && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Vincular motorista
                </p>
                <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_auto]">
                  <select
                    value={assignDriverId}
                    onChange={(event) => setAssignDriverId(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Selecione o motorista</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={
                      drivers.find((driver) => driver.id === assignDriverId)
                        ?.capacity || ""
                    }
                    readOnly
                    placeholder="Capacidade do cadastro do motorista"
                    title="Capacidade vem do cadastro do motorista e não pode ser editada aqui"
                    className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => void assignDriver()}
                    className="rounded-xl bg-[#1052c7] px-3 py-2 text-sm font-semibold text-white"
                  >
                    Vincular
                  </button>
                </div>
              </div>
            )}

            {!["completed", "cancelled"].includes(selected.status) && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void updateRouteStatus("completed")}
                  disabled={selected.active_driver_count > 0}
                  title={
                    selected.active_driver_count > 0
                      ? "Confirme a chegada ao cliente em cada vínculo ativo"
                      : undefined
                  }
                  className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Concluir rota
                </button>
                <button
                  type="button"
                  onClick={() => void updateRouteStatus("cancelled")}
                  className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  Cancelar rota
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#0b1d3a]">
            <MapPin size={16} className="text-[#1052c7]" /> Mapa das rotas
            selecionadas
          </p>
          {mapRouteIds.length > 0 && (
            <button
              type="button"
              onClick={() => setMapRouteIds([])}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Limpar seleção ({mapRouteIds.length})
            </button>
          )}
        </div>
        <RoutesMap routes={selectedMapRoutes} />
      </div>

      <NewRouteModal
        open={showModal}
        onClose={() => setShowModal(false)}
        collectionPoints={collectionPoints}
        finalCustomers={finalCustomers}
        onCreated={refresh}
      />
    </div>
  );
}

function ReportsTab({
  drivers,
  clients,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
}) {
  const [clientId, setClientId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<FreightRouteReportSummary | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const runReport = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      if (driverId) params.set("driverId", driverId);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      const response = await apiFetch(
        `/api/freight-routes/reports?${params.toString()}`,
        {
          headers: authHeaders(),
        },
      );
      const body = (await response.json()) as {
        summary?: FreightRouteReportSummary;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível gerar o relatório");
      setSummary(body.summary ?? null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <select
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Todos os clientes</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <select
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Todos os motoristas</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.full_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={loading}
          className="rounded-xl bg-[#1052c7] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Filtrando..." : "Filtrar"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Resumo
            </p>
            <p className="mt-2 text-2xl font-bold text-[#0b1d3a]">
              {summary.total_routes}
            </p>
            <p className="text-sm text-slate-500">rotas no período</p>
            <p className="mt-3 text-sm text-slate-600">
              Distância total: {summary.total_distance_km.toFixed(1)} km
            </p>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              {Object.entries(summary.status_breakdown).map(
                ([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <span>{statusLabels[status] ?? status}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Por motorista
            </p>
            <div className="mt-3 space-y-2">
              {summary.by_driver.length === 0 && (
                <p className="text-sm text-slate-500">Sem dados.</p>
              )}
              {summary.by_driver.map((item) => (
                <div
                  key={item.driver_id}
                  className="flex justify-between text-sm text-slate-600"
                >
                  <span>{item.name}</span>
                  <span className="font-semibold">{item.route_count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Por cliente
            </p>
            <div className="mt-3 space-y-2">
              {summary.by_client.length === 0 && (
                <p className="text-sm text-slate-500">Sem dados.</p>
              )}
              {summary.by_client.map((item) => (
                <div
                  key={item.location_id}
                  className="flex justify-between text-sm text-slate-600"
                >
                  <span>{item.name}</span>
                  <span className="font-semibold">{item.route_count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoutesDashboardTab() {
  const [data, setData] = useState<FreightRouteDashboard | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    const response = await apiFetch("/api/freight-routes/dashboard", {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível carregar o dashboard");
      return;
    }
    setData((await response.json()) as FreightRouteDashboard);
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(interval);
  }, []);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data)
    return <p className="text-sm text-slate-500">Carregando dashboard...</p>;

  const maxDaily = Math.max(1, ...data.daily_series.map((item) => item.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Total de rotas
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0b1d3a]">
            {data.total_routes}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Ativas
          </p>
          <p className="mt-2 text-2xl font-bold text-blue-700">
            {data.active_routes}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Concluídas
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">
            {data.completed_routes}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Distância total
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0b1d3a]">
            {data.total_distance_km.toFixed(0)} km
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-xs font-semibold uppercase text-slate-500">
          Rotas criadas nos últimos 14 dias
        </p>
        <div className="flex items-end gap-1">
          {data.daily_series.map((item) => (
            <div
              key={item.date}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <div
                className="w-full rounded-t bg-blue-500"
                style={{
                  height: `${Math.max(4, (item.count / maxDaily) * 80)}px`,
                }}
                title={`${item.date}: ${item.count}`}
              />
              <span className="text-[10px] text-slate-400">
                {item.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold uppercase text-slate-500">
            Motoristas mais ativos
          </p>
          {data.top_drivers.length === 0 && (
            <p className="text-sm text-slate-500">Sem dados.</p>
          )}
          <div className="space-y-2">
            {data.top_drivers.map((item) => (
              <div
                key={item.driver_id}
                className="flex justify-between text-sm text-slate-600"
              >
                <span>{item.name}</span>
                <span className="font-semibold">{item.route_count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold uppercase text-slate-500">
            Clientes com mais rotas
          </p>
          {data.top_clients.length === 0 && (
            <p className="text-sm text-slate-500">Sem dados.</p>
          )}
          <div className="space-y-2">
            {data.top_clients.map((item) => (
              <div
                key={item.location_id}
                className="flex justify-between text-sm text-slate-600"
              >
                <span>{item.name}</span>
                <span className="font-semibold">{item.route_count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FreightSettlementsTab() {
  const [settlements, setSettlements] = useState<FreightSettlement[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [drafts, setDrafts] = useState<
    Record<string, { amount: string; notes: string; reference: string }>
  >({});
  const [paymentProofs, setPaymentProofs] = useState<
    Record<string, PaymentProofUpload | undefined>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
        const response = await apiFetch(`/api/freight-settlements${query}`, {
          headers: authHeaders(),
        });
        const body = (await response.json()) as {
          settlements?: FreightSettlement[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            body.error ?? "Não foi possível carregar os acertos.",
          );
        if (!active) return;
        const loaded = body.settlements ?? [];
        setSettlements(loaded);
        setDrafts((current) => {
          const next = { ...current };
          for (const settlement of loaded) {
            if (!next[settlement.id]) {
              const amount =
                settlement.confirmed_amount_cents ??
                settlement.driver_claimed_amount_cents;
              next[settlement.id] = {
                amount: amount ? (amount / 100).toFixed(2) : "",
                notes: settlement.operations_notes ?? "",
                reference: settlement.payment_reference ?? "",
              };
            }
          }
          return next;
        });
        setError("");
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [statusFilter]);

  const updateSettlement = async (
    settlement: FreightSettlement,
    status?: FreightSettlement["status"],
  ) => {
    const draft = drafts[settlement.id] ?? {
      amount: "",
      notes: "",
      reference: "",
    };
    const amountCents = Math.round(
      Number(draft.amount.replace(",", ".")) * 100,
    );
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setError("Informe um valor confirmado válido para este frete.");
      return;
    }
    setSavingId(settlement.id);
    setError("");
    try {
      const response = await apiFetch(
        `/api/freight-settlements/${settlement.id}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({
            confirmedAmountCents: amountCents,
            status,
            operationsNotes: draft.notes,
            paymentReference: draft.reference,
            ...(paymentProofs[settlement.id]
              ? { paymentProof: paymentProofs[settlement.id] }
              : {}),
          }),
        },
      );
      const body = (await response.json()) as {
        settlement?: FreightSettlement;
        error?: string;
      };
      if (!response.ok || !body.settlement)
        throw new Error(body.error ?? "Não foi possível atualizar o acerto.");
      setSettlements((current) =>
        current.map((item) =>
          item.id === settlement.id ? body.settlement! : item,
        ),
      );
      setPaymentProofs((current) => {
        const next = { ...current };
        delete next[settlement.id];
        return next;
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const downloadPaymentProof = async (settlement: FreightSettlement) => {
    setError("");
    try {
      const response = await apiFetch(
        `/api/freight-settlements/${settlement.id}/proof`,
        { headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Não foi possível abrir o comprovante.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        settlement.payment_proof_file_name ?? "comprovante-pagamento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const formatCents = (amount: number | null) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format((amount ?? 0) / 100);
  const totalByStatus = (status: FreightSettlement["status"]) =>
    settlements
      .filter((item) => item.status === status)
      .reduce(
        (total, item) =>
          total +
          (status === "pending"
            ? (item.driver_claimed_amount_cents ?? 0)
            : (item.confirmed_amount_cents ?? 0)),
        0,
      );

  return (
    <div className="freight-settlements space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Em conferência", totalByStatus("pending"), "text-amber-700"],
          ["Aprovado", totalByStatus("approved"), "text-blue-700"],
          ["Pago", totalByStatus("paid"), "text-emerald-700"],
        ].map(([label, amount, color]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`mt-1 text-lg font-bold ${color}`}>
              {formatCents(Number(amount))}
            </p>
          </div>
        ))}
      </div>

      <label className="block max-w-xs text-xs font-semibold text-slate-600">
        Situação
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">Todos os acertos</option>
          <option value="pending">Em conferência</option>
          <option value="approved">Aprovados</option>
          <option value="paid">Pagos</option>
        </select>
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {settlements.map((settlement) => {
        const draft = drafts[settlement.id] ?? {
          amount: "",
          notes: "",
          reference: "",
        };
        const locked = settlement.status === "paid";
        const badge = {
          pending: "Em conferência",
          approved: "Aprovado · aguardando pagamento",
          paid: "Pago",
        }[settlement.status];
        const setDraft = (field: keyof typeof draft, value: string) =>
          setDrafts((current) => ({
            ...current,
            [settlement.id]: { ...draft, [field]: value },
          }));
        return (
          <article
            key={settlement.id}
            className="freight-settlement-card rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-[#0b1d3a]">
                  {settlement.assignment.route.collection_point.name} →{" "}
                  {settlement.assignment.route.final_customer.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {settlement.assignment.driver.full_name} · concluído em{" "}
                  {settlement.assignment.ended_at
                    ? new Date(
                        settlement.assignment.ended_at,
                      ).toLocaleDateString("pt-BR")
                    : "—"}
                  {settlement.assignment.route.distance_km !== null &&
                    ` · ${settlement.assignment.route.distance_km.toFixed(1)} km`}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Valor informado pelo motorista:{" "}
                  {formatCents(settlement.driver_claimed_amount_cents)}
                  {settlement.driver_notes && ` · ${settlement.driver_notes}`}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {badge}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Valor confirmado (R$)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  disabled={locked || savingId === settlement.id}
                  value={draft.amount}
                  onChange={(event) => setDraft("amount", event.target.value)}
                  className="payment-field mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Observação da operação
                <input
                  maxLength={1000}
                  disabled={locked || savingId === settlement.id}
                  value={draft.notes}
                  onChange={(event) => setDraft("notes", event.target.value)}
                  className="payment-field mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Referência do pagamento
                <input
                  maxLength={160}
                  disabled={locked || savingId === settlement.id}
                  value={draft.reference}
                  onChange={(event) =>
                    setDraft("reference", event.target.value)
                  }
                  className="payment-field mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              <label className="payment-file-label text-xs font-semibold text-slate-600">
                Comprovante de pagamento (PDF, JPEG ou PNG · até 8 MB)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={
                    settlement.status === "pending" ||
                    (settlement.status === "paid" &&
                      settlement.has_payment_proof) ||
                    savingId === settlement.id
                  }
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      const proof = await encodePaymentProof(file);
                      setPaymentProofs((current) => ({
                        ...current,
                        [settlement.id]: proof,
                      }));
                      setError("");
                    } catch (cause) {
                      setError((cause as Error).message);
                      input.value = "";
                    }
                  }}
                  className="payment-field mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-100"
                />
                {paymentProofs[settlement.id] && (
                  <span className="mt-1 block truncate text-xs font-normal text-slate-500">
                    Novo comprovante: {paymentProofs[settlement.id]?.fileName}
                  </span>
                )}
              </label>
            </div>
            {settlement.status !== "pending" && (
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settlement.status === "paid"}
                  disabled={locked || savingId === settlement.id}
                  onChange={(event) => {
                    if (event.target.checked)
                      void updateSettlement(settlement, "paid");
                  }}
                  className="payment-toggle h-4 w-4 accent-emerald-600"
                />
                Pagamento realizado
              </label>
            )}
            {!locked && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {settlement.status === "approved" && (
                  <button
                    type="button"
                    disabled={savingId === settlement.id}
                    onClick={() =>
                      void updateSettlement(settlement, "approved")
                    }
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Salvar alterações
                  </button>
                )}
                {settlement.status === "pending" && (
                  <button
                    type="button"
                    disabled={savingId === settlement.id}
                    onClick={() =>
                      void updateSettlement(settlement, "approved")
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1052c7] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <DollarSign size={15} />
                    {savingId === settlement.id
                      ? "Salvando..."
                      : "Confirmar e aprovar"}
                  </button>
                )}
              </div>
            )}
            {locked &&
              !settlement.has_payment_proof &&
              paymentProofs[settlement.id] && (
                <button
                  type="button"
                  disabled={savingId === settlement.id}
                  onClick={() => void updateSettlement(settlement, "paid")}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  <Paperclip size={15} /> Salvar comprovante
                </button>
              )}
            {locked && (
              <p className="mt-3 text-sm font-semibold text-emerald-700">
                Pago em{" "}
                {settlement.paid_at
                  ? new Date(settlement.paid_at).toLocaleDateString("pt-BR")
                  : "—"}{" "}
                · {formatCents(settlement.confirmed_amount_cents)}
                {settlement.payment_reference &&
                  ` · ${settlement.payment_reference}`}
              </p>
            )}
            {settlement.has_payment_proof && (
              <button
                type="button"
                onClick={() => void downloadPaymentProof(settlement)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <Download size={15} />
                {settlement.payment_proof_file_name ?? "Baixar comprovante"}
              </button>
            )}
          </article>
        );
      })}
      {!settlements.length && !error && (
        <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          Nenhum frete concluído para conferência nesta situação.
        </p>
      )}
    </div>
  );
}

export function RoutesPanel({
  drivers,
  clients,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
}) {
  const [subTab, setSubTab] = useState<
    "rotas" | "relatorios" | "dashboard" | "acertos"
  >("rotas");

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
          Operação
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#0b1d3a]">Rotas</h2>
        <p className="mt-1 text-sm text-slate-500">
          Crie rotas, vincule motoristas e acompanhe relatórios e indicadores.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setSubTab("rotas")}
          className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${subTab === "rotas" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
        >
          <Truck size={16} /> Rotas
        </button>
        <button
          type="button"
          onClick={() => setSubTab("relatorios")}
          className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${subTab === "relatorios" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
        >
          <FileText size={16} /> Relatórios
        </button>
        <button
          type="button"
          onClick={() => setSubTab("dashboard")}
          className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${subTab === "dashboard" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
        >
          <BarChart3 size={16} /> Dashboard
        </button>
        <button
          type="button"
          onClick={() => setSubTab("acertos")}
          className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${subTab === "acertos" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
        >
          <DollarSign size={16} /> Acertos
        </button>
      </div>

      {subTab === "rotas" && <RoutesListTab drivers={drivers} />}
      {subTab === "relatorios" && (
        <ReportsTab drivers={drivers} clients={clients} />
      )}
      {subTab === "dashboard" && <RoutesDashboardTab />}
      {subTab === "acertos" && <FreightSettlementsTab />}
    </section>
  );
}
