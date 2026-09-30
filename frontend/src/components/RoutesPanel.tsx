import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import { divIcon, type LatLngTuple } from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart3,
  Factory,
  FileText,
  MapPin,
  Plus,
  Truck,
  UsersRound,
  X,
} from "lucide-react";
import { apiEventSource, apiFetch } from "@/lib/api";
import type {
  DemoContact,
  DemoDriver,
  FreightRoute,
  FreightRouteDashboard,
  FreightRouteReportSummary,
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

function RoutesMap({ routes }: { routes: FreightRoute[] }) {
  const located = routes.filter(
    (route) =>
      Number.isFinite(route.collection_point?.latitude) &&
      Number.isFinite(route.collection_point?.longitude) &&
      Number.isFinite(route.final_customer?.latitude) &&
      Number.isFinite(route.final_customer?.longitude),
  );

  if (located.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
        Selecione ao menos uma rota com coordenadas GPS para exibi-la no mapa.
      </p>
    );
  }

  const allPoints: LatLngTuple[] = located.flatMap((route) => [
    [
      route.collection_point!.latitude as number,
      route.collection_point!.longitude as number,
    ] as LatLngTuple,
    [
      route.final_customer!.latitude as number,
      route.final_customer!.longitude as number,
    ] as LatLngTuple,
  ]);

  return (
    <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200">
      <MapContainer
        className="h-full w-full"
        center={allPoints[0] ?? [-15.7939, -47.8828]}
        zoom={allPoints.length > 0 ? 7 : 4}
        scrollWheelZoom
        zoomControl
      >
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
                  Cliente final · capacidade {route.total_capacity}
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
    totalCapacity: "",
    cargo: "",
    product: "",
    scheduledAt: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    if (!form.totalCapacity.trim()) {
      setError("Informe a capacidade total da rota");
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
          totalCapacity: form.totalCapacity.trim(),
          cargo: form.cargo,
          product: form.product,
          notes: form.notes,
          scheduledAt: form.scheduledAt || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível criar a rota");
      setForm({
        collectionPointId: "",
        finalCustomerId: "",
        totalCapacity: "",
        cargo: "",
        product: "",
        scheduledAt: "",
        notes: "",
      });
      await onCreated();
      onClose();
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
              Defina origem, destino e capacidade. A distância é calculada
              automaticamente a partir dos endereços do posto de coleta e do
              cliente final, e a capacidade poderá ser ajustada conforme o
              motorista que aceitar a rota.
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
          <input
            value={form.totalCapacity}
            onChange={(event) =>
              setForm({ ...form, totalCapacity: event.target.value })
            }
            placeholder="Capacidade total (ex: 30.000 L)"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.cargo}
              onChange={(event) =>
                setForm({ ...form, cargo: event.target.value })
              }
              placeholder="Carga"
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <input
              value={form.product}
              onChange={(event) =>
                setForm({ ...form, product: event.target.value })
              }
              placeholder="Produto"
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.scheduledAt}
              onChange={(event) =>
                setForm({ ...form, scheduledAt: event.target.value })
              }
              type="datetime-local"
              className="col-span-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-1"
            />
          </div>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            placeholder="Observações"
            rows={2}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex-1 rounded-xl bg-[#1052c7] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0b3f9f] disabled:opacity-60"
          >
            {saving ? "Criando..." : "Criar rota"}
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

  const endAssignment = async (
    assignmentId: string,
    status: "completed" | "cancelled",
  ) => {
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
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1052c7] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b3f9f]"
        >
          <Plus size={16} /> Nova rota
        </button>
      </div>

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
                    Capacidade: {route.total_capacity} · Motoristas ativos:{" "}
                    {route.active_driver_count}
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
                  Capacidade total: {selected.total_capacity}
                  {selected.distance_km
                    ? ` · ${selected.distance_km.toFixed(1)} km`
                    : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClasses[selected.status]}`}
              >
                {statusLabels[selected.status]}
              </span>
            </div>

            {(selected.cargo || selected.product || selected.notes) && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                {selected.cargo && <p>Carga: {selected.cargo}</p>}
                {selected.product && <p>Produto: {selected.product}</p>}
                {selected.notes && <p>Observações: {selected.notes}</p>}
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Motoristas vinculados
              </p>
              <div className="space-y-2">
                {selected.assignments.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Nenhum motorista vinculado ainda.
                  </p>
                )}
                {selected.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#0b1d3a]">
                        {assignment.driver?.full_name ?? "Motorista"}
                      </p>
                      <p className="text-xs text-slate-500">
                        Capacidade: {assignment.capacity ?? "—"} · Status:{" "}
                        {assignment.status}
                      </p>
                    </div>
                    {assignment.status === "active" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void endAssignment(assignment.id, "completed")
                          }
                          className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                        >
                          Concluir
                        </button>
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
                  className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700"
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

export function RoutesPanel({
  drivers,
  clients,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
}) {
  const [subTab, setSubTab] = useState<"rotas" | "relatorios" | "dashboard">(
    "rotas",
  );

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

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
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
      </div>

      {subTab === "rotas" && <RoutesListTab drivers={drivers} />}
      {subTab === "relatorios" && (
        <ReportsTab drivers={drivers} clients={clients} />
      )}
      {subTab === "dashboard" && <RoutesDashboardTab />}
    </section>
  );
}
