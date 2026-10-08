import { useEffect, useMemo, useRef, useState } from "react";
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
import "leaflet/dist/leaflet.css";
import {
  Loader2,
  Briefcase,
  Truck,
  UserPlus,
  Users,
  MapPin,
  ArrowRight,
  MessageCircle,
  Pencil,
  Trash2,
  UsersRound,
  Factory,
  Building2,
  Database,
  Link2,
  Shield,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type {
  AccessLevel,
  ApprovalDriverFields,
  DemoContact,
  DemoDriver,
  DirectoryOperator,
  OperationalLocation,
  PendingUser,
} from "@/lib/dashboardTypes";
import {
  getDevelopmentClients,
  getOnlineDrivers,
  isDriverCurrentlyOnline,
  loadList,
  saveList,
} from "@/lib/dashboardData";
import { AuthScreen, InitialPasswordScreen } from "@/components/AuthScreen";
import { DriverPortal } from "@/components/DriverPortal";
import { ClientPortal } from "@/components/ClientPortal";
import { AccountCenter } from "@/components/AccountCenter";
import { SupportWidget } from "@/components/SupportWidget";
import {
  SupportTicketsAdmin,
  useSupportBadge,
} from "@/components/SupportTicketsAdmin";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DirectoryPanel, MetricCard } from "@/components/DashboardPrimitives";
import { DirectorySearch as ReusableDirectorySearch } from "@/components/DirectorySearch";
import { RegistrationRequestsPanel as ReusableRegistrationRequestsPanel } from "@/components/RegistrationRequestsPanel";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { SettingsMenu } from "@/components/SettingsMenu";
import { DriverChat } from "@/components/DriverChat";
import { DriverChatArchive } from "@/components/DriverChatArchive";
import { DriverChatAlerts } from "@/components/DriverChatAlerts";
import {
  PasswordResetRequestsPanel,
  usePasswordResetRequests,
} from "@/components/PasswordResetRequestsPanel";
import { MapsLocationLookupModal } from "@/components/MapsLocationLookupModal";
import type { MapPoint } from "@/lib/mapLink";
import { RoutesPanel } from "@/components/RoutesPanel";
import { SuperAdminDataManager } from "@/components/SuperAdminDataManager";
import { apiEventSource, apiFetch } from "@/lib/api";

const SUPPORT_ENABLED = false;

const brazilianStates = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
] as const;

const normalizeGeocodeText = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// Palavras gen\u00e9ricas de logradouro/endere\u00e7o que n\u00e3o identificam a via.
const genericAddressWords = new Set([
  "rua",
  "avenida",
  "travessa",
  "rodovia",
  "estrada",
  "alameda",
  "praca",
  "viela",
  "beco",
  "ladeira",
  "bairro",
  "centro",
  "numero",
  "quadra",
  "lote",
  "setor",
  "conjunto",
  "residencial",
  "loteamento",
  "jardim",
  "vila",
  "proximo",
]);

function App() {
  const { user, profile } = useAuth();
  return (
    <>
      <AppRoutes />
      {SUPPORT_ENABLED && user && !profile?.must_change_password && (
        <SupportWidget />
      )}
    </>
  );
}

function AppRoutes() {
  const { user, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa]">
        <Loader2 className="animate-spin text-[#1052c7]" size={32} />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (profile?.must_change_password) {
    return <InitialPasswordScreen />;
  }

  if (profile?.role === "driver") {
    return <DriverPortal />;
  }

  if (profile?.role === "client") {
    return (
      <ClientPortal
        fullName={user.user_metadata.full_name ?? "Cliente"}
        email={user.email}
        onSignOut={signOut}
      />
    );
  }

  if (profile?.role === "operator") {
    return (
      <RoleDashboard
        role="operator"
        title="Operador"
        subtitle="Painel de operação"
        accountUser={user}
        accountProfile={profile}
        isSuperAdmin={profile?.is_super_admin === true}
        onSignOut={signOut}
      />
    );
  }

  if (profile?.role === "admin") {
    return (
      <RoleDashboard
        role="admin"
        title="Administrador"
        subtitle="Painel administrativo"
        accountUser={user}
        accountProfile={profile}
        isSuperAdmin={profile?.is_super_admin === true}
        onSignOut={signOut}
      />
    );
  }

  if (profile?.role === "carrier") {
    return (
      <CarrierDashboard
        title="Transportadora"
        accountUser={user}
        accountProfile={profile}
        onSignOut={signOut}
      />
    );
  }

  return <DriverPortal />;
}

function CarrierDashboard({
  title,
  accountUser,
  accountProfile,
  onSignOut,
}: {
  title: string;
  accountUser: {
    email: string;
    phone?: string | null;
    birth_date?: string | null;
    user_metadata: { full_name?: string };
  };
  accountProfile: { role: string; created_at: string } | null;
  onSignOut: () => Promise<void>;
}) {
  const token = localStorage.getItem("acneto-access-token");
  const [drivers, setDrivers] = useState<DemoDriver[]>([]);
  const [vehicles, setVehicles] = useState<
    Array<{
      id: string;
      type: string;
      plate: string;
      capacity: string | null;
      products: string[];
      status: string;
      current_driver?: { id: string; full_name: string } | null;
    }>
  >([]);
  const [mapDrivers, setMapDrivers] = useState<DemoDriver[]>([]);
  const [mapLocations, setMapLocations] = useState<DemoContact[]>([]);
  const [driverForm, setDriverForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    compartments: "",
  });
  const [vehicleForm, setVehicleForm] = useState({
    type: "",
    plate: "",
    capacity: "",
    compartments: "",
    products: "",
  });
  const [activeTab, setActiveTab] = useState<"drivers" | "vehicles" | "map">(
    "drivers",
  );
  const [error, setError] = useState("");
  const [driverStatusMessage, setDriverStatusMessage] = useState("");
  const [assignmentDriverIds, setAssignmentDriverIds] = useState<
    Record<string, string>
  >({});
  const headers = {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };

  const refresh = async () => {
    const [response, mapResponse] = await Promise.all([
      apiFetch("/api/carrier/registrations", { headers }),
      apiFetch("/api/carrier/map", { headers }),
    ]);
    if (response.ok) {
      const body = (await response.json()) as {
        drivers: DemoDriver[];
        vehicles: typeof vehicles;
      };
      setDrivers(body.drivers);
      setVehicles(body.vehicles);
    }
    if (mapResponse.ok) {
      const body = (await mapResponse.json()) as {
        drivers: DemoDriver[];
        locations: OperationalLocation[];
      };
      setMapDrivers(body.drivers);
      setMapLocations(
        body.locations.map((location) => ({
          ...location,
          email: location.email ?? "",
          region: location.city ?? location.state ?? "",
          accessLevel: "cliente",
          status: "ativo",
        })),
      );
    }
  };

  useEffect(() => {
    void refresh();
    const refreshInterval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(refreshInterval);
  }, []);

  const submitDriver = async () => {
    setError("");
    setDriverStatusMessage("");
    const response = await apiFetch("/api/carrier/drivers", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...driverForm, employmentType: "carrier" }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      return setError(body.error ?? "Não foi possível cadastrar o motorista");
    setDriverForm({
      fullName: "",
      email: "",
      phone: "",
      password: "",
      compartments: "",
    });
    setDriverStatusMessage(
      "Motorista cadastrado e em análise. Aguarde a aprovação do operador ou administrador.",
    );
    await refresh();
  };

  const submitVehicle = async () => {
    setError("");
    const response = await apiFetch("/api/carrier/vehicles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...vehicleForm,
        products: vehicleForm.products
          .split(",")
          .map((product) => product.trim())
          .filter(Boolean),
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      return setError(body.error ?? "Não foi possível cadastrar o veículo");
    setVehicleForm({
      type: "",
      plate: "",
      capacity: "",
      compartments: "",
      products: "",
    });
    await refresh();
  };

  const assignDriver = async (vehicleId: string) => {
    const driverId = assignmentDriverIds[vehicleId];
    if (!driverId) return;
    const response = await apiFetch(
      `/api/carrier/vehicles/${vehicleId}/driver`,
      { method: "POST", headers, body: JSON.stringify({ driverId }) },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      return setError(body.error ?? "Não foi possível vincular o motorista");
    await refresh();
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] p-4 sm:p-6">
      <header className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl bg-[#0b1d3a] px-5 py-4 text-white shadow-lg">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-blue-200">
            Portal da transportadora
          </p>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-xs text-blue-100/70">
            {accountUser.email} · {accountProfile?.role}
          </p>
        </div>
        <SettingsMenu onSignOut={onSignOut} />
      </header>
      <main className="mx-auto mt-6 max-w-6xl space-y-6">
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Você administra seus motoristas e veículos. Todo novo cadastro fica{" "}
          <strong>em análise</strong> até aprovação de um operador ou
          administrador.
        </div>
        {error && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        {driverStatusMessage && activeTab === "drivers" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {driverStatusMessage}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:max-w-2xl">
          <button
            type="button"
            onClick={() => setActiveTab("drivers")}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${activeTab === "drivers" ? "bg-[#0e4db7] text-white shadow-md" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Users size={18} /> Motoristas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vehicles")}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${activeTab === "vehicles" ? "bg-[#0e4db7] text-white shadow-md" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Truck size={18} /> Veículos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("map")}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${activeTab === "map" ? "bg-[#0e4db7] text-white shadow-md" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <MapPin size={18} /> Localizar
          </button>
        </div>
        {activeTab !== "map" && (
          <div className="space-y-6">
            <RegistrationCard
              title={
                activeTab === "drivers"
                  ? "Cadastrar motorista"
                  : "Cadastrar veículo"
              }
              icon={activeTab === "drivers" ? Users : Truck}
            >
              {activeTab === "drivers" && (
                <>
                  <input
                    value={driverForm.fullName}
                    onChange={(e) =>
                      setDriverForm((form) => ({
                        ...form,
                        fullName: e.target.value,
                      }))
                    }
                    placeholder="Nome completo *"
                    className={registrationInputClass}
                  />
                  <input
                    value={driverForm.email}
                    onChange={(e) =>
                      setDriverForm((form) => ({
                        ...form,
                        email: e.target.value,
                      }))
                    }
                    placeholder="E-mail *"
                    type="email"
                    className={registrationInputClass}
                  />
                  <input
                    value={driverForm.phone}
                    onChange={(e) =>
                      setDriverForm((form) => ({
                        ...form,
                        phone: e.target.value,
                      }))
                    }
                    placeholder="Celular / WhatsApp *"
                    className={registrationInputClass}
                  />
                  <input
                    value={driverForm.password}
                    onChange={(e) =>
                      setDriverForm((form) => ({
                        ...form,
                        password: e.target.value,
                      }))
                    }
                    placeholder="Senha inicial *"
                    type="password"
                    className={registrationInputClass}
                  />
                  <input
                    value={driverForm.compartments}
                    onChange={(e) =>
                      setDriverForm((form) => ({
                        ...form,
                        compartments: e.target.value,
                      }))
                    }
                    placeholder="Compartimentação *"
                    className={registrationInputClass}
                  />
                  <p className="text-xs text-slate-500 sm:col-span-2">
                    Este motorista será vinculado automaticamente à sua
                    transportadora.
                  </p>
                  <button
                    type="button"
                    onClick={() => void submitDriver()}
                    className={registrationButtonClass}
                  >
                    Enviar para aprovação <ArrowRight size={15} />
                  </button>
                </>
              )}
              {activeTab === "vehicles" && (
                <>
                  <input
                    value={vehicleForm.type}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        type: e.target.value,
                      }))
                    }
                    placeholder="Tipo do veículo *"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.plate}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        plate: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Placa do cavalo *"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.capacity}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        capacity: e.target.value,
                      }))
                    }
                    placeholder="Capacidade total"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.compartments}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        compartments: e.target.value,
                      }))
                    }
                    placeholder="Compartimentação"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.products}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        products: e.target.value,
                      }))
                    }
                    placeholder="Produtos habilitados (separe por vírgula)"
                    className={`${registrationInputClass} sm:col-span-2`}
                  />
                  <button
                    type="button"
                    onClick={() => void submitVehicle()}
                    className={registrationButtonClass}
                  >
                    Enviar para aprovação <ArrowRight size={15} />
                  </button>
                </>
              )}
            </RegistrationCard>
            {activeTab === "drivers" && (
              <RegistrationList
                title="Motoristas da transportadora"
                icon={Users}
              >
                {drivers.map((driver) => (
                  <RegistryRow
                    key={driver.id}
                    title={driver.full_name}
                    detail={`${driver.phone ?? "Sem telefone"} · ${driver.current_vehicle?.plate ?? "Sem veículo vinculado"}`}
                    status={driver.homologation_status ?? "in_analysis"}
                  />
                ))}
              </RegistrationList>
            )}
            {activeTab === "vehicles" && (
              <RegistrationList title="Veículos da transportadora" icon={Truck}>
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="space-y-2">
                    <RegistryRow
                      title={`${vehicle.plate} · ${vehicle.type}`}
                      detail={`${vehicle.capacity ?? "Capacidade não informada"} · ${vehicle.products.join(", ") || "Sem produto habilitado"} · ${vehicle.current_driver?.full_name ?? "Sem motorista"}`}
                      status={vehicle.status}
                    />
                    {vehicle.status === "active" && (
                      <div className="flex gap-2">
                        <select
                          value={
                            assignmentDriverIds[vehicle.id] ??
                            vehicle.current_driver?.id ??
                            ""
                          }
                          onChange={(event) =>
                            setAssignmentDriverIds((current) => ({
                              ...current,
                              [vehicle.id]: event.target.value,
                            }))
                          }
                          className={`${registrationInputClass} min-w-0 flex-1`}
                        >
                          <option value="">Selecionar motorista</option>
                          {drivers
                            .filter(
                              (driver) =>
                                driver.homologation_status === "active",
                            )
                            .map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.full_name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void assignDriver(vehicle.id)}
                          className="rounded-xl bg-[#0e4db7] px-3 py-2 text-xs font-semibold text-white"
                        >
                          Vincular
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </RegistrationList>
            )}
          </div>
        )}
        {activeTab === "map" && (
          <CarrierLocationMap drivers={mapDrivers} locations={mapLocations} />
        )}
      </main>
    </div>
  );
}

function CarrierLocationMap({
  drivers,
  locations,
}: {
  drivers: DemoDriver[];
  locations: DemoContact[];
}) {
  const onlineDrivers = useMemo(
    () => drivers.filter(isDriverCurrentlyOnline),
    [drivers],
  );
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState("Todas");
  const [statusFilter, setStatusFilter] = useState("Todos");

  useEffect(() => {
    if (
      selectedDriverId &&
      !onlineDrivers.some((driver) => driver.id === selectedDriverId)
    ) {
      setSelectedDriverId(null);
    }
    setSelectedClientIds((current) =>
      current.filter((id) => locations.some((location) => location.id === id)),
    );
  }, [onlineDrivers, locations, selectedDriverId]);

  return (
    <LocationMapView
      drivers={onlineDrivers}
      clients={locations}
      clientSearch={clientSearch}
      setClientSearch={setClientSearch}
      onClearClientSelection={() => setSelectedClientIds([])}
      selectedClientIds={selectedClientIds}
      routePath={[]}
      routeSummary={null}
      routeLoading={false}
      routeError=""
      onToggleClient={(clientId) =>
        setSelectedClientIds((current) =>
          current.includes(clientId)
            ? current.filter((id) => id !== clientId)
            : [...current, clientId],
        )
      }
      onCalculateRoute={() => undefined}
      selectedDriverId={selectedDriverId}
      cityFilter={cityFilter}
      setCityFilter={setCityFilter}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      onSelectDriver={setSelectedDriverId}
      showRoutePanel={false}
    />
  );
}

function RoleDashboard({
  role,
  title,
  subtitle,
  accountUser,
  accountProfile,
  isSuperAdmin,
  onSignOut,
}: {
  role: "operator" | "admin";
  title: string;
  subtitle: string;
  accountUser: {
    email: string;
    phone?: string | null;
    birth_date?: string | null;
    user_metadata: { full_name?: string };
  };
  accountProfile: { role: string; created_at: string } | null;
  isSuperAdmin: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [clients, setClients] = useState<DemoContact[]>(() =>
    getDevelopmentClients(),
  );
  const [operators, setOperators] = useState<DemoContact[]>(() =>
    loadList("acneto-operators", []),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [locationPhone, setLocationPhone] = useState("");
  const [region, setRegion] = useState("");
  const [locationState, setLocationState] = useState("");
  const [locationKind, setLocationKind] = useState<
    "collection_point" | "final_customer"
  >("final_customer");
  const [locationAddress, setLocationAddress] = useState("");
  const passwordResets = usePasswordResetRequests(
    role === "admin" || role === "operator",
  );
  // Endereço pesquisado no Google Maps quando o geolocalizador não o encontra.
  const [mapsLookupQuery, setMapsLookupQuery] = useState<string | null>(null);
  const [locationCompanyIds, setLocationCompanyIds] = useState<string[]>([]);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(
    role === "admin" ? "operador" : "cliente",
  );
  const [registrationTab, setRegistrationTab] = useState<
    "drivers" | "vehicles" | "companies" | "operators" | "admins" | "clients"
  >(role === "admin" ? "admins" : "drivers");
  const [initialAccessPassword, setInitialAccessPassword] = useState("");
  const [drivers, setDrivers] = useState<DemoDriver[]>(() =>
    getOnlineDrivers(),
  );
  const [directoryOperators, setDirectoryOperators] = useState<
    DirectoryOperator[]
  >([]);
  const [directoryDrivers, setDirectoryDrivers] = useState<DemoDriver[]>([]);
  const [passwordResetValues, setPasswordResetValues] = useState<
    Record<string, string>
  >({});
  const [passwordResettingUserId, setPasswordResettingUserId] = useState<
    string | null
  >(null);
  const [driverForm, setDriverForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    compartments: "",
  });
  const [registeredCompanies, setRegisteredCompanies] = useState(() =>
    loadList<{ id: string; name: string; cnpj: string; status: string }>(
      "acneto-transport-companies",
      [],
    ),
  );
  const [registeredVehicles, setRegisteredVehicles] = useState(() =>
    loadList<{
      id: string;
      type: string;
      plate: string;
      capacity: string;
      compartments: string;
      products: string;
      companyId: string;
      driverId: string;
      status: string;
    }>("acneto-vehicles", []),
  );
  const [companyForm, setCompanyForm] = useState({ name: "", cnpj: "" });
  const [vehicleForm, setVehicleForm] = useState({
    type: "",
    plate: "",
    capacity: "",
    compartments: "",
    products: "",
    companyId: "",
    driverId: "",
  });
  const [tab, setTab] = useState<
    | "resumo"
    | "cadastros"
    | "localizacao"
    | "rotas"
    | "conta"
    | "solicitacoes"
    | "chamados"
    | "dados"
  >("resumo");
  const supportBadge = useSupportBadge(role === "admin", isSuperAdmin);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [routePath, setRoutePath] = useState<LatLngTuple[]>([]);
  const [routeSummary, setRouteSummary] = useState<{
    distance: number;
    duration: number;
  } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("Todas");
  const [statusFilter, setStatusFilter] = useState<string>("Todos");
  const [locationClientSearch, setLocationClientSearch] = useState("");
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [pendingVehicles, setPendingVehicles] = useState<
    Array<{
      id: string;
      type: string;
      plate: string;
      capacity: string | null;
      products: string[];
      company: { name?: string; legal_name?: string } | null;
      status: string;
    }>
  >([]);
  const [registrationRequests, setRegistrationRequests] = useState<
    PendingUser[]
  >([]);
  const [approvalRoles, setApprovalRoles] = useState<
    Record<string, "driver" | "carrier" | "client" | "operator" | "admin">
  >({});
  const [approvalDriverFields, setApprovalDriverFields] = useState<
    Record<string, ApprovalDriverFields>
  >({});
  const [initialPasswords, setInitialPasswords] = useState<
    Record<string, string>
  >({});
  const [directory, setDirectory] = useState<
    "clients" | "operators" | "drivers"
  >("clients");
  const [searchTerm, setSearchTerm] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [driverFormError, setDriverFormError] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [pendingRejection, setPendingRejection] = useState<PendingUser | null>(
    null,
  );
  const [processingRequest, setProcessingRequest] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);

  const showFormError = (message: string) => setFormError(message);

  useEffect(() => {
    saveList("acneto-clients", clients);
  }, [clients]);

  const resetUserPassword = async (userId: string) => {
    const password = passwordResetValues[userId] ?? "";
    if (password.length < 8) {
      setFormError("A nova senha deve ter no mínimo 8 caracteres.");
      return;
    }
    setPasswordResettingUserId(userId);
    const response = await apiFetch(`/api/admin/users/${userId}/password`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
      },
      body: JSON.stringify({ password }),
    });
    setPasswordResettingUserId(null);
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setFormError(body.error ?? "Não foi possível alterar a senha.");
      return;
    }
    setPasswordResetValues((current) => ({ ...current, [userId]: "" }));
    setFormSuccess(
      "Senha alterada. O usuário deverá trocá-la no próximo acesso.",
    );
  };

  useEffect(() => {
    saveList("acneto-operators", operators);
  }, [operators]);

  useEffect(() => {
    if (!localStorage.getItem("acneto-access-token")) {
      saveList("acneto-drivers", drivers);
    }
  }, [drivers]);

  useEffect(() => {
    saveList("acneto-transport-companies", registeredCompanies);
  }, [registeredCompanies]);

  useEffect(() => {
    saveList("acneto-vehicles", registeredVehicles);
  }, [registeredVehicles]);

  useEffect(() => {
    const token = localStorage.getItem("acneto-access-token");
    if (token) {
      void apiFetch("/api/operations/directory", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(
          (response) =>
            response.json() as Promise<{
              drivers: DemoDriver[];
              all_drivers: DemoDriver[];
              operators: DirectoryOperator[];
              companies?: Array<{
                id: string;
                name: string;
                cnpj: string;
                status: string;
              }>;
              vehicles?: Array<{
                id: string;
                type: string;
                plate: string;
                capacity: string;
                compartments: string;
                products: string;
                companyId: string;
                driverId: string;
                status: string;
              }>;
              locations: OperationalLocation[];
            }>,
        )
        .then(
          ({
            drivers: apiDrivers,
            all_drivers: apiAllDrivers,
            operators: apiOperators,
            companies = [],
            vehicles = [],
            locations = [],
          }) => {
            setDrivers(apiDrivers);
            setDirectoryDrivers(apiAllDrivers);
            setDirectoryOperators(apiOperators);
            setRegisteredCompanies((current) => {
              const localOnly = current.filter(
                (item) => !companies.some((company) => company.id === item.id),
              );
              return [...companies, ...localOnly];
            });
            setRegisteredVehicles((current) => {
              const localOnly = current.filter(
                (item) => !vehicles.some((vehicle) => vehicle.id === item.id),
              );
              return [...vehicles, ...localOnly];
            });
            setOperators(
              apiOperators.map((operator) => ({
                id: operator.id,
                name: operator.full_name ?? "Usuário sem nome",
                email: operator.email,
                phone: operator.phone,
                region: "",
                accessLevel: "operador" as const,
                status: "ativo" as const,
                latitude: null,
                longitude: null,
              })),
            );
            setClients((current) => {
              if (!locations.length) return current;
              return locations.map((location) => ({
                id: location.id,
                kind: location.kind,
                name: location.name,
                email: location.email ?? "",
                phone: location.phone,
                region: location.city ?? location.state ?? "",
                accessLevel: "cliente" as const,
                status: "ativo" as const,
                latitude: location.latitude,
                longitude: location.longitude,
                company_ids: location.company_ids ?? [],
                address: location.address,
                city: location.city,
                state: location.state,
              }));
            });
          },
        );
    }

    const refreshDrivers = () => setDrivers(getOnlineDrivers());

    const refreshFromSource = () => {
      if (localStorage.getItem("acneto-access-token")) {
        void apiFetch("/api/operations/directory", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
          },
        })
          .then(
            (response) =>
              response.json() as Promise<{
                drivers: DemoDriver[];
                all_drivers: DemoDriver[];
                operators: DirectoryOperator[];
                companies?: Array<{
                  id: string;
                  name: string;
                  cnpj: string;
                  status: string;
                }>;
                vehicles?: Array<{
                  id: string;
                  type: string;
                  plate: string;
                  capacity: string;
                  compartments: string;
                  products: string;
                  companyId: string;
                  driverId: string;
                  status: string;
                }>;
                locations: OperationalLocation[];
              }>,
          )
          .then(
            ({
              drivers: apiDrivers,
              all_drivers: apiAllDrivers,
              operators: apiOperators,
              companies = [],
              vehicles = [],
              locations = [],
            }) => {
              setDrivers(apiDrivers);
              setDirectoryDrivers(apiAllDrivers);
              setDirectoryOperators(apiOperators);
              setRegisteredCompanies((current) => {
                const localOnly = current.filter(
                  (item) =>
                    !companies.some((company) => company.id === item.id),
                );
                return [...companies, ...localOnly];
              });
              setRegisteredVehicles((current) => {
                const localOnly = current.filter(
                  (item) => !vehicles.some((vehicle) => vehicle.id === item.id),
                );
                return [...vehicles, ...localOnly];
              });
              setOperators(
                apiOperators.map((operator) => ({
                  id: operator.id,
                  name: operator.full_name ?? "Usuário sem nome",
                  email: operator.email,
                  phone: operator.phone,
                  region: "",
                  accessLevel: "operador" as const,
                  status: "ativo" as const,
                  latitude: null,
                  longitude: null,
                })),
              );
              if (locations.length) {
                setClients(
                  locations.map((location) => ({
                    id: location.id,
                    kind: location.kind,
                    name: location.name,
                    email: location.email ?? "",
                    phone: location.phone,
                    region: location.city ?? location.state ?? "",
                    accessLevel: "cliente" as const,
                    status: "ativo" as const,
                    latitude: location.latitude,
                    longitude: location.longitude,
                    company_ids: location.company_ids ?? [],
                    address: location.address,
                    city: location.city,
                    state: location.state,
                  })),
                );
              }
            },
          );
      } else {
        refreshDrivers();
      }
    };
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    events?.addEventListener("message", refreshFromSource);
    const refreshInterval = window.setInterval(refreshFromSource, 5000);

    window.addEventListener("storage", refreshFromSource);
    window.addEventListener("acneto-driver-location", refreshFromSource);

    return () => {
      window.clearInterval(refreshInterval);
      events?.removeEventListener("message", refreshFromSource);
      events?.close();
      window.removeEventListener("storage", refreshFromSource);
      window.removeEventListener("acneto-driver-location", refreshFromSource);
    };
  }, []);

  useEffect(() => {
    if (!["admin", "operator"].includes(role)) return;
    let active = true;
    const loadPendingUsers = async () => {
      const token = localStorage.getItem("acneto-access-token");
      if (!token) return;
      try {
        const response = await apiFetch("/api/admin/pending-users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok && active) {
          const body = (await response.json()) as { users: PendingUser[] };
          setPendingUsers(body.users);
          setApprovalDriverFields((current) => {
            const next = { ...current };
            body.users.forEach((pendingUser) => {
              const driver = pendingUser.driver;
              next[pendingUser.id] = {
                full_name: driver?.full_name ?? pendingUser.full_name ?? "",
                phone: driver?.phone ?? pendingUser.phone ?? "",
                vehicle_model: driver?.vehicle_model ?? "",
                vehicle_year: driver?.vehicle_year
                  ? String(driver.vehicle_year)
                  : "",
                plate: driver?.plate ?? "",
                city: driver?.city ?? "",
                state: driver?.state ?? "",
                capacity: driver?.capacity ?? "",
                compartments: driver?.compartments ?? "",
                cpf: driver?.cpf ?? "",
                cnh: driver?.cnh ?? "",
                cnh_category: driver?.cnh_category ?? "",
                cnh_expires_at: driver?.cnh_expires_at?.slice(0, 10) ?? "",
                location_sharing_authorized:
                  driver?.location_sharing_authorized ?? false,
              };
            });
            return next;
          });
        }
        const vehicleResponse = await apiFetch("/api/admin/pending-vehicles", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (vehicleResponse.ok && active) {
          const body = (await vehicleResponse.json()) as {
            vehicles: typeof pendingVehicles;
          };
          setPendingVehicles(body.vehicles);
        }
      } catch {
        // A falha temporária não interrompe a próxima atualização automática.
      }
    };
    void loadPendingUsers();
    const token = localStorage.getItem("acneto-access-token");
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    events?.addEventListener("message", () => void loadPendingUsers());
    const pendingRefresh = window.setInterval(loadPendingUsers, 3000);

    return () => {
      active = false;
      events?.close();
      window.clearInterval(pendingRefresh);
    };
  }, [role]);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    const loadRegistrationRequests = async () => {
      const token = localStorage.getItem("acneto-access-token");
      if (!token) return;
      try {
        const response = await apiFetch("/api/admin/registration-requests", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok && active) {
          const body = (await response.json()) as { users: PendingUser[] };
          setRegistrationRequests(body.users);
          setApprovalDriverFields((current) => {
            const next = { ...current };
            body.users.forEach((pendingUser) => {
              const driver = pendingUser.driver;
              next[pendingUser.id] = {
                full_name: driver?.full_name ?? pendingUser.full_name ?? "",
                phone: driver?.phone ?? pendingUser.phone ?? "",
                vehicle_model: driver?.vehicle_model ?? "",
                vehicle_year: driver?.vehicle_year
                  ? String(driver.vehicle_year)
                  : "",
                plate: driver?.plate ?? "",
                city: driver?.city ?? "",
                state: driver?.state ?? "",
                capacity: driver?.capacity ?? "",
                compartments: driver?.compartments ?? "",
                cpf: driver?.cpf ?? "",
                cnh: driver?.cnh ?? "",
                cnh_category: driver?.cnh_category ?? "",
                cnh_expires_at: driver?.cnh_expires_at?.slice(0, 10) ?? "",
                location_sharing_authorized:
                  driver?.location_sharing_authorized ?? false,
              };
            });
            return next;
          });
        }
      } catch {
        // A próxima atualização automática tentará novamente.
      }
    };
    void loadRegistrationRequests();
    const refresh = window.setInterval(loadRegistrationRequests, 5000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [role]);

  const approveUser = async (pendingUser: PendingUser) => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token) return;
    setProcessingRequest({ id: pendingUser.id, action: "approve" });
    try {
      const role = approvalRoles[pendingUser.id] ?? pendingUser.requested_role;
      const fields = approvalDriverFields[pendingUser.id];
      const initialPassword = initialPasswords[pendingUser.id] ?? "";
      if (["operator", "admin"].includes(role) && initialPassword.length < 8) {
        showFormError("Informe uma senha inicial com no mínimo 8 caracteres.");
        return;
      }
      if (
        role === "driver" &&
        (!fields?.full_name.trim() ||
          !fields.phone.trim() ||
          !fields.compartments.trim())
      ) {
        showFormError(
          "Preencha nome, telefone e compartimentação do motorista antes de aprovar.",
        );
        return;
      }
      const response = await apiFetch(
        `/api/admin/users/${pendingUser.id}/approve`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            role,
            initialPassword: ["operator", "admin"].includes(role)
              ? initialPassword
              : undefined,
            driver: fields
              ? {
                  fullName: fields.full_name,
                  phone: fields.phone,
                  compartments: fields.compartments,
                }
              : undefined,
          }),
        },
      );
      if (response.ok) {
        setPendingUsers((current) =>
          current.filter((user) => user.id !== pendingUser.id),
        );
        setRegistrationRequests((current) =>
          current.filter((user) => user.id !== pendingUser.id),
        );
        setApprovalDriverFields((current) => {
          const next = { ...current };
          delete next[pendingUser.id];
          return next;
        });
      } else {
        const body = (await response.json()) as { error?: string };
        showFormError(body.error ?? "Não foi possível finalizar a aprovação.");
      }
    } catch {
      showFormError(
        "Não foi possível confirmar a persistência do cadastro. Tente novamente.",
      );
    } finally {
      setProcessingRequest((current) =>
        current?.id === pendingUser.id ? null : current,
      );
    }
  };

  const rejectUser = async (pendingUser: PendingUser) => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token) return;
    setProcessingRequest({ id: pendingUser.id, action: "reject" });
    try {
      const response = await apiFetch(
        `/api/admin/users/${pendingUser.id}/reject`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        showFormError(body.error ?? "Não foi possível rejeitar o cadastro.");
        return;
      }
      setPendingUsers((current) =>
        current.filter((user) => user.id !== pendingUser.id),
      );
      setRegistrationRequests((current) =>
        current.filter((user) => user.id !== pendingUser.id),
      );
      setApprovalDriverFields((current) => {
        const next = { ...current };
        delete next[pendingUser.id];
        return next;
      });
      setPendingRejection(null);
    } catch {
      showFormError(
        "Não foi possível confirmar a exclusão do cadastro. Tente novamente.",
      );
    } finally {
      setProcessingRequest((current) =>
        current?.id === pendingUser.id ? null : current,
      );
    }
  };

  const setApprovalClosed = async (userId: string, closed: boolean) => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token) return;
    const response = await apiFetch(
      `/api/admin/users/${userId}/${closed ? "close" : "reopen"}-approval`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (response.ok) {
      setRegistrationRequests((current) =>
        current.map((request) =>
          request.id === userId
            ? { ...request, approval_closed: closed }
            : request,
        ),
      );
      if (closed) {
        setPendingUsers((current) =>
          current.filter((user) => user.id !== userId),
        );
      }
    }
  };

  const onlineDrivers = useMemo(
    () => drivers.filter(isDriverCurrentlyOnline),
    [drivers],
  );
  const filteredDrivers = useMemo(() => {
    return onlineDrivers
      .filter(
        (driver) =>
          Number.isFinite(driver.latitude) &&
          Number.isFinite(driver.longitude) &&
          Boolean(driver.last_seen) &&
          Date.now() - new Date(driver.last_seen as string).getTime() <=
            2 * 60 * 1000,
      )
      .filter(
        (driver) =>
          cityFilter === "Todas" ||
          (driver.availability_city ?? driver.city) === cityFilter,
      )
      .filter(
        (driver) => statusFilter === "Todos" || driver.status === statusFilter,
      )
      .sort(
        (first, second) =>
          new Date(first.availability_since).getTime() -
          new Date(second.availability_since).getTime(),
      );
  }, [cityFilter, onlineDrivers, statusFilter]);
  const totalClients = clients.length;
  const totalOperators = operators.length;
  const activeDrivers = onlineDrivers.length;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredClients = clients.filter((item) =>
    `${item.name} ${item.email} ${item.region}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const filteredOperators = operators.filter((item) =>
    `${item.name} ${item.email} ${item.region}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const filteredOnlineDrivers = onlineDrivers.filter((driver) =>
    `${driver.full_name} ${driver.city ?? ""} ${driver.vehicle_model ?? ""} ${driver.plate ?? ""}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const normalizedLocationSearch = locationSearch.trim().toLowerCase();
  const locationSearchReady = normalizedLocationSearch.length >= 3;
  const searchableDrivers = role === "admin" ? directoryDrivers : onlineDrivers;
  const locationDrivers = locationSearchReady
    ? searchableDrivers.filter((driver) =>
        driver.full_name.toLowerCase().includes(normalizedLocationSearch),
      )
    : [];
  const locationOperators = locationSearchReady
    ? directoryOperators.filter((operator) =>
        (operator.full_name ?? "")
          .toLowerCase()
          .includes(normalizedLocationSearch),
      )
    : [];

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds((current) =>
      current.includes(clientId)
        ? current.filter((id) => id !== clientId)
        : [...current, clientId],
    );
    setRoutePath([]);
    setRouteSummary(null);
  };

  const calculateRoute = async (): Promise<boolean> => {
    const selectedDriver = filteredDrivers.find(
      (driver) => driver.id === selectedDriverId,
    );
    const selectedClients = clients.filter((client) =>
      selectedClientIds.includes(client.id),
    );
    const collectionPoint = selectedClients.find(
      (client) => client.kind === "collection_point",
    );
    const finalCustomer = selectedClients.find(
      (client) => client.kind === "final_customer",
    );
    if (
      !selectedDriver ||
      selectedDriver.latitude == null ||
      selectedDriver.longitude == null ||
      !collectionPoint ||
      !finalCustomer
    ) {
      setRouteError("Selecione um posto de coleta e um cliente final com GPS.");
      return false;
    }

    setRouteLoading(true);
    setRouteError("");
    try {
      const isDemoRoute = [
        selectedDriver.id,
        collectionPoint.id,
        finalCustomer.id,
      ].some((id) => id.includes("demo"));
      const waypoints = [
        [selectedDriver.longitude, selectedDriver.latitude],
        [collectionPoint.longitude, collectionPoint.latitude],
        [finalCustomer.longitude, finalCustomer.latitude],
      ];
      const response = isDemoRoute
        ? await fetch(
            `https://router.project-osrm.org/route/v1/driving/${waypoints
              .map(([longitude, latitude]) => `${longitude},${latitude}`)
              .join(";")}?overview=full&geometries=geojson&steps=false`,
          )
        : await apiFetch("/api/operations/routes", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
            },
            body: JSON.stringify({
              driverId: selectedDriver.id,
              collectionPointId: collectionPoint.id,
              finalCustomerId: finalCustomer.id,
            }),
          });
      if (!response.ok) throw new Error("Rota indisponível");
      const body = (await response.json()) as {
        code?: string;
        distance: number;
        duration: number;
        geometry: { coordinates: number[][] };
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: number[][] };
        }>;
      };
      const route = body.routes?.[0] ?? body;
      if (body.code && body.code !== "Ok") throw new Error("Rota indisponível");
      setRoutePath(
        route.geometry.coordinates.map(
          ([longitude, latitude]) => [latitude, longitude] as LatLngTuple,
        ),
      );
      setRouteSummary({ distance: route.distance, duration: route.duration });
      return true;
    } catch {
      setRouteError("Não foi possível calcular a rota. Tente novamente.");
      setRoutePath([]);
      setRouteSummary(null);
      return false;
    } finally {
      setRouteLoading(false);
    }
  };

  useEffect(() => {
    if (!filteredDrivers.length) {
      setSelectedDriverId((current) => (current === null ? current : null));
      return;
    }

    if (
      !selectedDriverId ||
      !filteredDrivers.some((driver) => driver.id === selectedDriverId)
    ) {
      setSelectedDriverId(filteredDrivers[0].id);
    }
  }, [filteredDrivers, selectedDriverId]);

  useEffect(() => {
    const selectedDriverIsActive = Boolean(
      selectedDriverId &&
      filteredDrivers.some((driver) => driver.id === selectedDriverId),
    );
    if (selectedDriverIsActive) return;

    setSelectedClientIds((current) => (current.length ? [] : current));
    setRoutePath((current) => (current.length ? [] : current));
    setRouteSummary((current) => (current === null ? current : null));
    setRouteError((current) => (current ? "" : current));
  }, [filteredDrivers, selectedDriverId]);

  useEffect(() => {
    if (selectedDriverId && selectedClientIds.length === 2) {
      setLocationClientSearch("");
    }
  }, [selectedClientIds.length, selectedDriverId]);

  const geocodeAddress = async (
    address: string,
    city: string,
    state: string,
  ) => {
    const normalizedState = state.trim().toUpperCase();
    const stateName = brazilianStates.find(
      ([code]) => code === normalizedState,
    )?.[1];
    if (!address.trim() || !city.trim() || !stateName) return null;

    const params = new URLSearchParams({
      format: "jsonv2",
      limit: "5",
      addressdetails: "1",
      countrycodes: "br",
      street: address.trim(),
      city: city.trim(),
      state: stateName,
      country: "Brasil",
    });

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        { headers: { Accept: "application/json", "Accept-Language": "pt-BR" } },
      );
      if (!response.ok) return null;

      const results = (await response.json()) as Array<{
        lat?: string;
        lon?: string;
        address?: {
          city?: string;
          town?: string;
          municipality?: string;
          village?: string;
          state?: string;
          state_code?: string;
          "ISO3166-2-lvl4"?: string;
          road?: string;
          house_number?: string;
        };
        display_name?: string;
        addresstype?: string;
      }>;
      const requestedCity = normalizeGeocodeText(city);
      const requestedNumber = address.match(/\b\d+[a-zA-Z]?\b/)?.[0] ?? "";
      // Usa só o nome da via (antes da primeira vírgula), sem número/bairro.
      const addressWords = normalizeGeocodeText(address.split(",")[0] ?? "")
        .split(/[^a-z0-9]+/)
        .filter(
          (word) =>
            word.length >= 4 &&
            !/^\d+$/.test(word) &&
            !genericAddressWords.has(word),
        );
      const locationMatches = (
        resultCity: string,
        resultState: string | undefined,
      ) => {
        const normalizedResultCity = normalizeGeocodeText(resultCity);
        const cityMatch =
          normalizedResultCity.length > 0 &&
          (normalizedResultCity === requestedCity ||
            normalizedResultCity.includes(requestedCity) ||
            requestedCity.includes(normalizedResultCity));
        const stateMatch =
          resultState === normalizedState ||
          normalizeGeocodeText(resultState ?? "") ===
            normalizeGeocodeText(stateName);
        return cityMatch && stateMatch;
      };
      const nominatimMatch = results.find((result) => {
        const resultCity =
          result.address?.city ??
          result.address?.town ??
          result.address?.municipality ??
          result.address?.village ??
          "";
        const resultStreet = normalizeGeocodeText(result.address?.road ?? "");
        const streetMatch = addressWords.every((word) =>
          resultStreet.includes(word),
        );
        const resultStateParts = (
          result.address?.state_code ??
          result.address?.["ISO3166-2-lvl4"] ??
          ""
        ).split("-");
        const resultStateCode =
          resultStateParts[resultStateParts.length - 1]?.toUpperCase();
        return (
          Number.isFinite(Number(result.lat)) &&
          Number.isFinite(Number(result.lon)) &&
          locationMatches(
            resultCity,
            resultStateCode ?? result.address?.state,
          ) &&
          streetMatch
        );
      });
      if (nominatimMatch?.lat && nominatimMatch.lon) {
        const matchedNumber = nominatimMatch.address?.house_number ?? "";
        return {
          latitude: Number(nominatimMatch.lat),
          longitude: Number(nominatimMatch.lon),
          approximate:
            Boolean(requestedNumber) &&
            matchedNumber !== requestedNumber &&
            nominatimMatch.addresstype !== "house",
          matchedAddress: nominatimMatch.display_name ?? address,
        };
      }

      const photonParams = new URLSearchParams({
        q: `${address.trim()}, ${city.trim()}, ${stateName}, Brasil`,
        limit: "5",
      });
      const photonResponse = await fetch(
        `https://photon.komoot.io/api/?${photonParams.toString()}`,
        { headers: { Accept: "application/json" } },
      );
      if (!photonResponse.ok) return null;
      const photonBody = (await photonResponse.json()) as {
        features?: Array<{
          geometry?: { coordinates?: number[] };
          properties?: {
            countrycode?: string;
            city?: string;
            district?: string;
            state?: string;
            name?: string;
            street?: string;
            housenumber?: string;
            osm_key?: string;
          };
        }>;
      };
      const countMatchedWords = (
        properties: NonNullable<(typeof photonBody.features)>[number]["properties"],
      ) => {
        const matchedStreet = normalizeGeocodeText(
          `${properties?.name ?? ""} ${properties?.street ?? ""}`,
        );
        return addressWords.filter((word) => matchedStreet.includes(word))
          .length;
      };
      const photonMatch = (photonBody.features ?? []).find((feature) => {
        const properties = feature.properties;
        if (!properties || properties.countrycode?.toUpperCase() !== "BR")
          return false;
        const resultCity = properties.city ?? properties.district ?? "";
        if (!locationMatches(resultCity, properties.state)) return false;
        // Em cidades pequenas a via costuma faltar no OSM; aceita o local
        // quando ao menos metade das palavras específicas do endereço bate.
        return (
          addressWords.length > 0 &&
          countMatchedWords(properties) >= Math.ceil(addressWords.length / 2)
        );
      });
      const photonCoordinates = photonMatch?.geometry?.coordinates;
      if (
        !photonCoordinates ||
        !Number.isFinite(photonCoordinates[0]) ||
        !Number.isFinite(photonCoordinates[1])
      )
        return null;

      return {
        latitude: photonCoordinates[1],
        longitude: photonCoordinates[0],
        approximate:
          countMatchedWords(photonMatch.properties) < addressWords.length ||
          (Boolean(requestedNumber) &&
            photonMatch.properties?.housenumber !== requestedNumber),
        matchedAddress: `${photonMatch.properties?.name ?? address}, ${city}, ${stateName}`,
      };
    } catch {
      return null;
    }
  };

  const handleAdd = async (
    requestedAccessLevel: AccessLevel = accessLevel,
    manualPoint?: MapPoint,
  ) => {
    if (!name.trim() || !email.trim()) {
      showFormError("Preencha nome e e-mail antes de salvar o cadastro.");
      return;
    }

    if (
      role === "admin" &&
      ["operador", "admin"].includes(requestedAccessLevel)
    ) {
      if (initialAccessPassword.length < 8) {
        showFormError("Informe uma senha inicial com no mínimo 8 caracteres.");
        return;
      }
      const token = localStorage.getItem("acneto-access-token");
      const response = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          fullName: name.trim(),
          email: email.trim(),
          phone: region.trim(),
          role: requestedAccessLevel === "operador" ? "operator" : "admin",
          initialPassword: initialAccessPassword,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        showFormError(body.error ?? "Não foi possível criar o acesso.");
        return;
      }
      setName("");
      setEmail("");
      setRegion("");
      setInitialAccessPassword("");
      setFormSuccess(
        requestedAccessLevel === "admin"
          ? "Administrador criado com sucesso. Ele deverá trocar a senha no primeiro acesso."
          : "Operador criado com sucesso. Ele deverá trocar a senha no primeiro acesso.",
      );
      return;
    }

    if (requestedAccessLevel === "cliente") {
      const addressText = locationAddress.trim();
      const cityText = region.trim();
      const stateText = locationState.trim().toUpperCase();

      if (!locationPhone.trim()) {
        showFormError("Informe o WhatsApp do cliente ou posto de coleta.");
        return;
      }

      if (!addressText || !cityText || !stateText) {
        showFormError(
          "Informe endereço, cidade e UF para localizar o ponto corretamente.",
        );
        return;
      }

      const editingLocation = clients.find(
        (client) => client.id === editingContactId,
      );
      // Na edição sem mudança de endereço, mantém o GPS já salvo (que pode ter
      // sido marcado manualmente pelo Google Maps).
      const keepsSavedPoint =
        editingLocation?.latitude != null &&
        editingLocation.longitude != null &&
        (editingLocation.address ?? "").trim() === addressText &&
        (editingLocation.city ?? editingLocation.region ?? "").trim() ===
          cityText &&
        (editingLocation.state ?? "").trim().toUpperCase() === stateText;

      const manualCoordinates = Boolean(manualPoint);
      let coordinates: Awaited<ReturnType<typeof geocodeAddress>> = null;
      if (manualPoint) {
        coordinates = {
          ...manualPoint,
          approximate: false,
          matchedAddress: addressText,
        };
      } else if (keepsSavedPoint) {
        coordinates = {
          latitude: editingLocation.latitude!,
          longitude: editingLocation.longitude!,
          approximate: false,
          matchedAddress: addressText,
        };
      } else {
        coordinates = await geocodeAddress(addressText, cityText, stateText);
        if (!coordinates) {
          // Não achou: abre a pesquisa no Google Maps para coletar o link.
          setMapsLookupQuery(`${addressText}, ${cityText} - ${stateText}`);
          return;
        }
      }
      const isPersistedLocation = Boolean(
        editingLocation?.kind &&
        !editingLocation.id.startsWith("client-demo-") &&
        !editingLocation.id.startsWith("collection-demo-"),
      );
      const duplicateCoordinates = clients.find(
        (client) =>
          client.id !== editingContactId &&
          client.kind !== locationKind &&
          client.latitude === coordinates.latitude &&
          client.longitude === coordinates.longitude,
      );
      if (duplicateCoordinates) {
        showFormError(
          "Este endereço foi localizado no mesmo ponto de outro local. Confira o número, a cidade e a UF antes de salvar.",
        );
        return;
      }

      const locationPayload = {
        kind: locationKind,
        name: name.trim(),
        email: email.trim(),
        phone: locationPhone.trim(),
        address: addressText,
        city: cityText,
        state: stateText,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        companyIds: locationCompanyIds,
      };
      const token = localStorage.getItem("acneto-access-token");
      if (token && (!editingContactId || isPersistedLocation)) {
        const response = await apiFetch(
          isPersistedLocation
            ? `/api/operations/locations/${editingLocation!.id}`
            : "/api/operations/locations",
          {
            method: isPersistedLocation ? "PATCH" : "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(locationPayload),
          },
        );
        const result = (await response.json()) as {
          location?: DemoContact;
          error?: string;
        };
        if (!response.ok || !result.location) {
          showFormError(result.error ?? "Não foi possível salvar o local.");
          return;
        }
        setClients((items) =>
          isPersistedLocation
            ? items.map((item) =>
                item.id === result.location!.id ? result.location! : item,
              )
            : [result.location!, ...items],
        );
      } else {
        const localLocation: DemoContact = {
          id: editingContactId ?? `${Date.now()}`,
          kind: locationKind,
          name: name.trim(),
          email: email.trim(),
          phone: locationPhone.trim(),
          region: cityText,
          city: cityText,
          state: stateText,
          address: addressText,
          company_ids: locationCompanyIds,
          accessLevel: "cliente",
          status: "ativo",
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        };
        setClients((items) =>
          editingContactId
            ? items.map((item) =>
                item.id === editingContactId ? localLocation : item,
              )
            : [localLocation, ...items],
        );
      }
      setName("");
      setEmail("");
      setLocationPhone("");
      setRegion("");
      setLocationState("");
      setLocationAddress("");
      setLocationCompanyIds([]);
      setLocationKind("final_customer");
      setEditingContactId(null);
      setFormSuccess(
        coordinates.approximate
          ? `GPS aproximado (local encontrado: ${coordinates.matchedAddress}); o endereço exato não foi localizado. Confira o ponto no mapa.`
          : manualCoordinates
            ? isPersistedLocation
              ? "Endereço atualizado com o GPS informado."
              : "Cadastro criado com o GPS informado."
            : isPersistedLocation
              ? "Endereço atualizado com GPS confirmado."
              : "Cadastro criado com GPS confirmado.",
      );
      return;
    }

    const newEntry: DemoContact = {
      id: `${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      region: region.trim(),
      accessLevel: requestedAccessLevel,
      status: "ativo",
      latitude: null,
      longitude: null,
    };

    if (editingContactId) {
      setClients((items) =>
        items.map((item) =>
          item.id === editingContactId
            ? { ...item, ...newEntry, id: item.id }
            : item,
        ),
      );
      setOperators((items) =>
        items.map((item) =>
          item.id === editingContactId
            ? { ...item, ...newEntry, id: item.id }
            : item,
        ),
      );
      setEditingContactId(null);
    } else {
      setOperators((prev) => [newEntry, ...prev]);
    }

    setName("");
    setEmail("");
    setRegion("");
    setLocationAddress("");
    setAccessLevel(role === "admin" ? "operador" : "cliente");
  };

  const editContact = (contact: DemoContact) => {
    setEditingContactId(contact.id);
    setName(contact.name);
    setEmail(contact.email);
    setLocationPhone(contact.phone ?? "");
    setRegion(contact.city ?? contact.region);
    setLocationState(contact.state ?? "");
    setLocationAddress(contact.address ?? "");
    setLocationCompanyIds(contact.company_ids ?? []);
    if (contact.kind) {
      setLocationKind(contact.kind);
      setAccessLevel("cliente");
      setRegistrationTab("clients");
    } else {
      setAccessLevel(contact.accessLevel);
    }
    setTab("cadastros");
  };

  const removeContact = (contact: DemoContact) => {
    if (!window.confirm(`Excluir o cadastro de ${contact.name}?`)) return;
    setClients((items) => items.filter((item) => item.id !== contact.id));
    setOperators((items) => items.filter((item) => item.id !== contact.id));
  };

  const editDriver = (driver: DemoDriver) => {
    setLocationSearch("");
    setEditingDriverId(driver.id);
    setDriverForm({
      full_name: driver.full_name,
      email: driver.email ?? "",
      phone: driver.phone ?? "",
      password: "",
      compartments: driver.compartments ?? "",
    });
    setTab("cadastros");
  };

  const removeDriver = async (driver: DemoDriver) => {
    if (!window.confirm(`Excluir o cadastro de ${driver.full_name}?`)) return;
    const token = localStorage.getItem("acneto-access-token");
    if (token) {
      const response = await apiFetch(`/api/admin/drivers/${driver.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
    }
    setDrivers((items) => items.filter((item) => item.id !== driver.id));
    setDirectoryDrivers((items) =>
      items.filter((item) => item.id !== driver.id),
    );
  };

  const handleAddDriver = async () => {
    const fullName = driverForm.full_name.trim();
    const email = driverForm.email.trim();
    const phone = driverForm.phone.trim();
    const compartments = driverForm.compartments.trim();
    const fail = (message: string) => {
      setDriverFormError(message);
      showFormError(message);
    };
    if (!fullName || !email || !phone || !compartments)
      return fail("Informe nome, telefone, e-mail e compartimentação.");
    if (!editingDriverId && driverForm.password.length < 6)
      return fail("Informe uma senha com no mínimo 6 caracteres.");
    setDriverFormError("");

    const token = localStorage.getItem("acneto-access-token");
    const response = await apiFetch(
      editingDriverId
        ? `/api/admin/drivers/${editingDriverId}`
        : "/api/admin/drivers",
      {
        method: editingDriverId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          compartments,
          ...(editingDriverId ? {} : { password: driverForm.password }),
        }),
      },
    ).catch(() => null);
    const body = response
      ? ((await response.json().catch(() => ({}))) as {
          driver?: DemoDriver;
          error?: string;
        })
      : {};
    if (!response?.ok)
      return fail(body.error ?? "Não foi possível salvar o motorista.");

    if (editingDriverId) {
      const applyEdit = (item: DemoDriver) =>
        item.id === editingDriverId
          ? { ...item, full_name: fullName, email, phone, compartments }
          : item;
      setDrivers((prev) => prev.map(applyEdit));
      setDirectoryDrivers((prev) => prev.map(applyEdit));
      setEditingDriverId(null);
    } else if (body.driver) {
      setDrivers((prev) => [body.driver!, ...prev]);
      setDirectoryDrivers((prev) => [body.driver!, ...prev]);
    }
    setDriverForm({
      full_name: "",
      email: "",
      phone: "",
      password: "",
      compartments: "",
    });
  };

  const addCompany = () => {
    if (!companyForm.name.trim()) return;
    setRegisteredCompanies((items) => [
      {
        id: crypto.randomUUID(),
        name: companyForm.name.trim(),
        cnpj: companyForm.cnpj.trim(),
        status: "active",
      },
      ...items,
    ]);
    setCompanyForm({ name: "", cnpj: "" });
  };

  const addVehicle = () => {
    if (!vehicleForm.type.trim() || !vehicleForm.plate.trim()) return;
    setRegisteredVehicles((items) => [
      { id: crypto.randomUUID(), ...vehicleForm, status: "in_analysis" },
      ...items,
    ]);
    setVehicleForm({
      type: "",
      plate: "",
      capacity: "",
      compartments: "",
      products: "",
      companyId: "",
      driverId: "",
    });
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] p-4 sm:p-6">
      <DriverChatAlerts />
      <MapsLocationLookupModal
        query={mapsLookupQuery}
        onCancel={() => setMapsLookupQuery(null)}
        onConfirm={(point) => {
          setMapsLookupQuery(null);
          void handleAdd("cliente", point);
        }}
      />
      <ConfirmationModal
        open={Boolean(formError)}
        title="Revise os dados"
        message={formError ?? ""}
        actionLabel="Corrigir"
        onClose={() => setFormError(null)}
      />
      <ConfirmationModal
        open={Boolean(formSuccess)}
        title="Cadastro concluído"
        message={formSuccess ?? ""}
        actionLabel="Continuar"
        onClose={() => setFormSuccess(null)}
      />
      <ConfirmationModal
        open={Boolean(pendingRejection)}
        title="Rejeitar cadastro?"
        message={`Esta ação excluirá permanentemente a solicitação de ${pendingRejection?.full_name ?? pendingRejection?.email ?? "usuário"} e todos os dados pendentes relacionados.`}
        actionLabel="Sim, rejeitar e excluir"
        cancelLabel="Cancelar"
        destructive
        loading={Boolean(processingRequest?.action === "reject")}
        onClose={() => {
          if (pendingRejection && !processingRequest) {
            void rejectUser(pendingRejection);
          }
        }}
        onCancel={() => setPendingRejection(null)}
      />
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0e4db7]/10 ring-1 ring-[#0e4db7]/15">
              <img
                src="/logo-ac-neto.svg"
                alt="A C Neto Transportes"
                className="h-10 w-10 object-contain"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Gestão operacional
              </p>
              <h1 className="text-2xl font-bold text-[#0c1017]">{title}</h1>
              <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SettingsMenu onSignOut={onSignOut} />
          </div>
        </header>
        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            icon={Users}
            label="Clientes"
            value={String(totalClients)}
            active={directory === "clients"}
            onClick={() => setDirectory("clients")}
          />
          {role === "admin" && (
            <MetricCard
              icon={Briefcase}
              label="Operadores"
              value={String(totalOperators)}
              active={directory === "operators"}
              onClick={() => setDirectory("operators")}
            />
          )}
          <MetricCard
            icon={Truck}
            label="Motoristas disponíveis"
            value={String(activeDrivers)}
            active={directory === "drivers"}
            onClick={() => setDirectory("drivers")}
          />
        </section>
        <div className="mb-6 grid gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          <button
            onClick={() => setTab("resumo")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === "resumo"
                ? "bg-white text-[#0b1d3a] shadow-sm"
                : "text-slate-500"
            }`}
          >
            Resumo
          </button>
          {(role === "admin" || role === "operator") && (
            <button
              onClick={() => {
                if (role === "operator") setRegistrationTab("drivers");
                setTab("cadastros");
              }}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "cadastros"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              Cadastros
            </button>
          )}
          <button
            onClick={() => {
              setLocationSearch("");
              setLocationClientSearch("");
              setSelectedClientIds([]);
              setTab("localizacao");
            }}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === "localizacao"
                ? "bg-white text-[#0b1d3a] shadow-sm"
                : "text-slate-500"
            }`}
          >
            Localizar
          </button>
          <button
            onClick={() => setTab("conta")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === "conta"
                ? "bg-white text-[#0b1d3a] shadow-sm"
                : "text-slate-500"
            }`}
          >
            Meus dados
          </button>
          {(role === "admin" || role === "operator") && (
            <button
              onClick={() => setTab("rotas")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "rotas"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              Rotas
            </button>
          )}
          {(role === "admin" || role === "operator") && (
            <button
              onClick={() => setTab("solicitacoes")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "solicitacoes"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <span>{role === "admin" ? "Solicitações" : "Aprovações"}</span>
              {pendingUsers.length + passwordResets.requests.length > 0 && (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingUsers.length + passwordResets.requests.length}
                </span>
              )}
            </button>
          )}
          {SUPPORT_ENABLED && role === "admin" && (
            <button
              onClick={() => setTab("chamados")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "chamados"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <span>Chamados</span>
              {supportBadge > 0 && (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {supportBadge}
                </span>
              )}
            </button>
          )}
          {isSuperAdmin && (
            <button
              onClick={() => setTab("dados")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "dados"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Database size={15} /> Dados
            </button>
          )}
        </div>{" "}
        {tab === "resumo" ? (
          <>
            <ReusableDirectorySearch
              role={role}
              search={locationSearch}
              onSearch={setLocationSearch}
              matchedDrivers={locationDrivers}
              matchedOperators={role === "admin" ? locationOperators : []}
              onEditDriver={editDriver}
            />

            <section className="mt-6">
              <DirectoryPanel
                directory={directory}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                clients={filteredClients}
                operators={filteredOperators}
                drivers={filteredOnlineDrivers}
                onEditContact={editContact}
                onDeleteContact={removeContact}
                onEditDriver={editDriver}
                onDeleteDriver={(driver) => void removeDriver(driver)}
                canDelete
              />
            </section>
          </>
        ) : tab === "cadastros" ? (
          <>
            <div
              className={`mb-5 grid gap-1 rounded-xl bg-slate-100 p-1 ${role === "admin" ? "grid-cols-3" : "grid-cols-2"}`}
            >
              {[
                ["drivers", "Motoristas"],
                ["vehicles", "Veículos"],
                ...(role === "admin" ? [["companies", "Transportadoras"]] : []),
                ...(role === "admin"
                  ? [
                      ["clients", "Clientes"],
                      ["admins", "Administradores"],
                    ]
                  : [["clients", "Clientes"]]),
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setRegistrationTab(value as typeof registrationTab);
                    setAccessLevel(
                      value === "admins"
                        ? "admin"
                        : value === "clients"
                          ? "cliente"
                          : "operador",
                    );
                  }}
                  className={`rounded-lg py-2.5 text-sm font-semibold ${registrationTab === value ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {registrationTab === "companies" && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <RegistrationCard
                  title="Cadastrar transportadora"
                  icon={Building2}
                >
                  <input
                    value={companyForm.name}
                    onChange={(e) =>
                      setCompanyForm((form) => ({
                        ...form,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Razão social / nome"
                    className={registrationInputClass}
                  />
                  <input
                    value={companyForm.cnpj}
                    onChange={(e) =>
                      setCompanyForm((form) => ({
                        ...form,
                        cnpj: e.target.value,
                      }))
                    }
                    placeholder="CNPJ"
                    className={registrationInputClass}
                  />
                  <button
                    type="button"
                    onClick={addCompany}
                    className={registrationButtonClass}
                  >
                    Salvar transportadora <ArrowRight size={15} />
                  </button>
                </RegistrationCard>
                <RegistrationList
                  title="Transportadoras cadastradas"
                  icon={Building2}
                >
                  {registeredCompanies.map((company) => (
                    <RegistryRow
                      key={company.id}
                      title={company.name}
                      detail={company.cnpj || "CNPJ não informado"}
                      status={company.status}
                    />
                  ))}
                </RegistrationList>
              </div>
            )}

            {registrationTab === "vehicles" && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <RegistrationCard title="Cadastrar veículo" icon={Truck}>
                  <input
                    value={vehicleForm.type}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        type: e.target.value,
                      }))
                    }
                    placeholder="Tipo do veículo"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.plate}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        plate: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Placa do cavalo"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.capacity}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        capacity: e.target.value,
                      }))
                    }
                    placeholder="Capacidade total"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.compartments}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        compartments: e.target.value,
                      }))
                    }
                    placeholder="Compartimentação"
                    className={registrationInputClass}
                  />
                  <input
                    value={vehicleForm.products}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        products: e.target.value,
                      }))
                    }
                    placeholder="Produtos habilitados (separe por vírgula)"
                    className={`${registrationInputClass} sm:col-span-2`}
                  />
                  <select
                    value={vehicleForm.companyId}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        companyId: e.target.value,
                      }))
                    }
                    className={`${registrationInputClass} sm:col-span-2`}
                  >
                    <option value="">Autônomo / sem transportadora</option>
                    {registeredCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={vehicleForm.driverId}
                    onChange={(e) =>
                      setVehicleForm((form) => ({
                        ...form,
                        driverId: e.target.value,
                      }))
                    }
                    className={`${registrationInputClass} sm:col-span-2`}
                  >
                    <option value="">Sem motorista vinculado</option>
                    {directoryDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addVehicle}
                    className={registrationButtonClass}
                  >
                    Salvar veículo <ArrowRight size={15} />
                  </button>
                </RegistrationCard>
                <RegistrationList title="Veículos cadastrados" icon={Truck}>
                  {registeredVehicles.map((vehicle) => (
                    <RegistryRow
                      key={vehicle.id}
                      title={`${vehicle.plate} · ${vehicle.type}`}
                      detail={`${vehicle.capacity || "Capacidade não informada"} · ${vehicle.products || "Produto não informado"} · ${directoryDrivers.find((driver) => driver.id === vehicle.driverId)?.full_name ?? "Sem motorista"}`}
                      status={vehicle.status}
                    />
                  ))}
                </RegistrationList>
              </div>
            )}

            {registrationTab !== "vehicles" &&
              registrationTab !== "companies" && (
                <div className="grid gap-6 xl:grid-cols-2">
                  <div
                    className={`${registrationTab !== "drivers" ? "hidden " : ""}rounded-2xl border border-slate-200 bg-white p-5 shadow-sm`}
                  >
                    <div className="mb-4 flex items-center gap-2">
                      <Truck size={18} className="text-[#1052c7]" />
                      <h2 className="text-lg font-bold text-[#0b1d3a]">
                        Cadastar motorista
                      </h2>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={driverForm.full_name}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            full_name: e.target.value,
                          }))
                        }
                        placeholder="Nome do motorista *"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        type="tel"
                        value={driverForm.phone}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        placeholder="Telefone / WhatsApp *"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        type="email"
                        value={driverForm.email}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        placeholder="E-mail *"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      {!editingDriverId && (
                        <input
                          type="password"
                          value={driverForm.password}
                          onChange={(e) =>
                            setDriverForm((prev) => ({
                              ...prev,
                              password: e.target.value,
                            }))
                          }
                          placeholder="Senha de acesso *"
                          autoComplete="new-password"
                          className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      )}
                      <input
                        value={driverForm.compartments}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            compartments: e.target.value,
                          }))
                        }
                        placeholder="Compartimentação *"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-800 sm:col-span-2">
                        <Link2 size={15} />
                        <span>
                          Veículo e transportadora são vinculados separadamente
                          após o cadastro.
                        </span>
                      </div>
                    </div>

                    {driverFormError && (
                      <p className="mt-3 text-sm font-semibold text-rose-600">
                        {driverFormError}
                      </p>
                    )}

                    <button
                      onClick={handleAddDriver}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0a3a90]"
                    >
                      Salvar motorista <ArrowRight size={15} />
                    </button>
                  </div>

                  {registrationTab === "drivers" && (
                    <RegistrationList
                      title="Motoristas cadastrados"
                      icon={Users}
                    >
                      {(directoryDrivers.length
                        ? directoryDrivers
                        : drivers
                      ).map((driver) => (
                        <RegistryRow
                          key={driver.id}
                          title={driver.full_name}
                          detail={`${driver.phone ?? "Sem telefone"} · ${driver.current_vehicle?.plate ?? (driver.plate || "Sem veículo")}`}
                          status={driver.homologation_status ?? driver.status}
                          onEdit={() => editDriver(driver)}
                          onDelete={() => void removeDriver(driver)}
                        />
                      ))}
                    </RegistrationList>
                  )}

                  <div
                    className={`${registrationTab === "drivers" ? "hidden " : ""}rounded-2xl border border-slate-200 bg-white p-5 shadow-sm`}
                  >
                    <div className="mb-4 flex items-center gap-2">
                      <UserPlus size={18} className="text-[#1052c7]" />
                      <h2 className="text-lg font-bold text-[#0b1d3a]">
                        {registrationTab === "clients"
                          ? "Cadastrar cliente"
                          : "Cadastrar administrador"}
                      </h2>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nome"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="E-mail"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        placeholder={
                          accessLevel === "cliente" ? "Cidade" : "Região"
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      {accessLevel === "cliente" && (
                        <>
                          <input
                            value={locationPhone}
                            onChange={(e) => setLocationPhone(e.target.value)}
                            placeholder="WhatsApp / telefone"
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                          <select
                            value={locationKind}
                            onChange={(e) =>
                              setLocationKind(
                                e.target.value as
                                  | "collection_point"
                                  | "final_customer",
                              )
                            }
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="collection_point">
                              Posto de coleta
                            </option>
                            <option value="final_customer">
                              Cliente final
                            </option>
                          </select>
                          <select
                            value={locationState}
                            onChange={(event) =>
                              setLocationState(event.target.value)
                            }
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">UF do endereço</option>
                            {brazilianStates.map(([uf, stateName]) => (
                              <option key={uf} value={uf}>
                                {uf} · {stateName}
                              </option>
                            ))}
                          </select>
                          <input
                            value={locationAddress}
                            onChange={(e) => setLocationAddress(e.target.value)}
                            placeholder="Rua/Av., número e bairro"
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                          />
                          <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3 sm:col-span-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-blue-900">
                              Liberar visualização para transportadoras
                            </p>
                            {registeredCompanies.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                Nenhuma transportadora cadastrada para liberar.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {registeredCompanies.map((company) => (
                                  <label
                                    key={company.id}
                                    className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={locationCompanyIds.includes(
                                        company.id,
                                      )}
                                      onChange={(event) =>
                                        setLocationCompanyIds((current) =>
                                          event.target.checked
                                            ? [...current, company.id]
                                            : current.filter(
                                                (id) => id !== company.id,
                                              ),
                                        )
                                      }
                                    />
                                    <span className="min-w-0 truncate">
                                      {company.name}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      {registrationTab === "admins" && (
                        <select
                          value={accessLevel}
                          onChange={(e) =>
                            setAccessLevel(e.target.value as AccessLevel)
                          }
                          className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="operador">Operador</option>
                          <option value="admin">Administrador</option>
                        </select>
                      )}
                      {role === "admin" && accessLevel !== "cliente" && (
                        <input
                          type="password"
                          value={initialAccessPassword}
                          onChange={(e) =>
                            setInitialAccessPassword(e.target.value)
                          }
                          placeholder="Senha inicial (mínimo 8 caracteres)"
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                        />
                      )}
                    </div>

                    <button
                      onClick={() => void handleAdd()}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0a3a90]"
                    >
                      Salvar acesso <ArrowRight size={15} />
                    </button>
                  </div>
                  {registrationTab === "clients" && (
                    <ClientVisibilityPanel
                      clients={clients}
                      companies={registeredCompanies}
                      onUpdated={(clientId, companyIds) =>
                        setClients((current) =>
                          current.map((client) =>
                            client.id === clientId
                              ? { ...client, company_ids: companyIds }
                              : client,
                          ),
                        )
                      }
                    />
                  )}
                  {registrationTab === "admins" && (
                    <RegistrationList title="Acessos cadastrados" icon={Shield}>
                      {operators.map((operator) => (
                        <div key={operator.id} className="space-y-2">
                          <RegistryRow
                            title={operator.name}
                            detail={operator.email}
                            status={operator.status}
                          />
                          {role === "admin" && (
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <input
                                type="password"
                                value={passwordResetValues[operator.id] ?? ""}
                                onChange={(event) =>
                                  setPasswordResetValues((current) => ({
                                    ...current,
                                    [operator.id]: event.target.value,
                                  }))
                                }
                                placeholder="Nova senha (mínimo 8 caracteres)"
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  void resetUserPassword(operator.id)
                                }
                                disabled={
                                  passwordResettingUserId === operator.id
                                }
                                className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                              >
                                {passwordResettingUserId === operator.id
                                  ? "Alterando..."
                                  : "Alterar senha"}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </RegistrationList>
                  )}
                </div>
              )}
          </>
        ) : tab === "localizacao" ? (
          <LocationMapView
            drivers={filteredDrivers}
            clients={clients}
            clientSearch={locationClientSearch}
            setClientSearch={setLocationClientSearch}
            onClearClientSelection={() => setSelectedClientIds([])}
            selectedClientIds={selectedClientIds}
            routePath={routePath}
            routeSummary={routeSummary}
            routeLoading={routeLoading}
            routeError={routeError}
            onToggleClient={toggleClientSelection}
            onCalculateRoute={() => void calculateRoute()}
            selectedDriverId={selectedDriverId}
            cityFilter={cityFilter}
            setCityFilter={setCityFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onSelectDriver={setSelectedDriverId}
            canOpenChat
            isSuperAdmin={isSuperAdmin}
          />
        ) : tab === "rotas" ? (
          <RoutesPanel
            drivers={directoryDrivers.length ? directoryDrivers : drivers}
            clients={clients}
          />
        ) : tab === "dados" && isSuperAdmin ? (
          <SuperAdminDataManager />
        ) : SUPPORT_ENABLED && tab === "chamados" && role === "admin" ? (
          <SupportTicketsAdmin isSuperAdmin={isSuperAdmin} />
        ) : tab === "solicitacoes" ? (
          <div className="space-y-5">
            <PasswordResetRequestsPanel
              requests={passwordResets.requests}
              onChanged={() => void passwordResets.reload()}
            />
            <PendingVehiclesPanel
              vehicles={pendingVehicles}
              onDecision={async (vehicleId, status) => {
                const token = localStorage.getItem("acneto-access-token");
                const response = await apiFetch(
                  `/api/admin/vehicles/${vehicleId}/approval`,
                  {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token ?? ""}`,
                    },
                    body: JSON.stringify({ status }),
                  },
                );
                if (response.ok)
                  setPendingVehicles((items) =>
                    items.filter((item) => item.id !== vehicleId),
                  );
              }}
            />
            <ReusableRegistrationRequestsPanel
              requests={role === "admin" ? registrationRequests : pendingUsers}
              approvalRoles={approvalRoles}
              approvalDriverFields={approvalDriverFields}
              initialPasswords={initialPasswords}
              canManageRoles={role === "admin"}
              canManageStatus={role === "admin" || role === "operator"}
              onInitialPasswordChange={(userId, value) =>
                setInitialPasswords((current) => ({
                  ...current,
                  [userId]: value,
                }))
              }
              onRoleChange={(userId, value) =>
                setApprovalRoles((current) => ({ ...current, [userId]: value }))
              }
              onDriverFieldChange={(userId, field, value) =>
                setApprovalDriverFields((current) => ({
                  ...current,
                  [userId]: { ...current[userId], [field]: value },
                }))
              }
              onApprove={(request) => void approveUser(request)}
              onReject={(request) => setPendingRejection(request)}
              processingRequest={processingRequest}
              onClose={(userId) => void setApprovalClosed(userId, true)}
              onReopen={(userId) => void setApprovalClosed(userId, false)}
            />
          </div>
        ) : (
          <AccountCenter
            user={{
              email: accountUser.email,
              full_name: accountUser.user_metadata.full_name,
              phone: accountUser.phone,
              birth_date: accountUser.birth_date,
            }}
            profile={accountProfile}
          />
        )}
      </div>
    </div>
  );
}

function PendingVehiclesPanel({
  vehicles,
  onDecision,
}: {
  vehicles: Array<{
    id: string;
    type: string;
    plate: string;
    capacity: string | null;
    products: string[];
    company: { name?: string; legal_name?: string } | null;
    status: string;
  }>;
  onDecision: (
    vehicleId: string,
    status: "active" | "rejected" | "blocked",
  ) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#0b1d3a]">
            Veículos aguardando homologação
          </h2>
          <p className="text-sm text-slate-500">
            Aprovação central obrigatória para liberar a operação.
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
          {vehicles.length}
        </span>
      </div>
      {vehicles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
          Nenhum veículo pendente.
        </p>
      ) : (
        <div className="space-y-2">
          {vehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-[#0b1d3a]">
                  {vehicle.plate} · {vehicle.type}
                </p>
                <p className="text-xs text-slate-500">
                  {vehicle.company?.legal_name ??
                    vehicle.company?.name ??
                    "Transportadora"}{" "}
                  · {vehicle.capacity ?? "Capacidade não informada"} ·{" "}
                  {vehicle.products.join(", ") || "Sem produto informado"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onDecision(vehicle.id, "rejected")}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  Reprovar
                </button>
                <button
                  type="button"
                  onClick={() => void onDecision(vehicle.id, "active")}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  Aprovar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function truckMarkerIcon(selected: boolean) {
  const color = selected ? "#1052c7" : "#0e4db7";
  const size = selected ? 44 : 38;
  return divIcon({
    className: "truck-map-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
    html: renderToStaticMarkup(
      <div
        style={{
          alignItems: "center",
          background: color,
          border: "3px solid white",
          borderRadius: "14px 14px 14px 4px",
          boxShadow: "0 3px 8px rgba(15, 23, 42, 0.28)",
          color: "white",
          display: "flex",
          height: `${size}px`,
          justifyContent: "center",
          transform: "rotate(-45deg)",
          width: `${size}px`,
        }}
      >
        <span style={{ transform: "rotate(45deg)", display: "flex" }}>
          <Truck size={selected ? 24 : 21} strokeWidth={2.4} />
        </span>
      </div>,
    ),
  });
}

function clientMarkerIcon(kind: DemoContact["kind"]) {
  const isCollectionPoint = kind === "collection_point";
  const background = isCollectionPoint ? "#0e4db7" : "#d97706";
  const Icon = isCollectionPoint ? Factory : UsersRound;
  return divIcon({
    className: "client-map-marker",
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -38],
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
          height: "38px",
          justifyContent: "center",
          transform: "rotate(-45deg)",
          width: "38px",
        }}
      >
        <span style={{ transform: "rotate(45deg)", display: "flex" }}>
          <Icon size={20} strokeWidth={2.4} />
        </span>
      </div>,
    ),
  });
}

function driverMarkerPosition(
  driver: DemoDriver,
  drivers: DemoDriver[],
): LatLngTuple {
  const latitude = driver.latitude as number;
  const longitude = driver.longitude as number;
  const samePosition = drivers.filter(
    (candidate) =>
      candidate.latitude?.toFixed(5) === latitude.toFixed(5) &&
      candidate.longitude?.toFixed(5) === longitude.toFixed(5),
  );
  if (samePosition.length <= 1) return [latitude, longitude];

  const index = samePosition.findIndex(
    (candidate) => candidate.id === driver.id,
  );
  const angle = (2 * Math.PI * index) / samePosition.length;
  const radius = 0.00018;
  return [
    latitude + Math.cos(angle) * radius,
    longitude + Math.sin(angle) * radius,
  ];
}

function formatRouteDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`
    : `${Math.round(meters).toLocaleString("pt-BR")} m`;
}

function formatRouteDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min estimados`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min estimados`;
}

const registrationInputClass =
  "rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const registrationButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0a3a90] sm:col-span-2";

function ClientVisibilityPanel({
  clients,
  companies,
  onUpdated,
}: {
  clients: DemoContact[];
  companies: Array<{ id: string; name: string; cnpj: string; status: string }>;
  onUpdated: (clientId: string, companyIds: string[]) => void;
}) {
  const [selectedCompanies, setSelectedCompanies] = useState<
    Record<string, string[]>
  >({});
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSelectedCompanies((current) => {
      const next = { ...current };
      const clientIds = new Set(clients.map((client) => client.id));
      clients.forEach((client) => {
        if (!(client.id in next)) {
          next[client.id] = client.company_ids ?? [];
        }
      });
      Object.keys(next).forEach((clientId) => {
        if (!clientIds.has(clientId)) delete next[clientId];
      });
      return next;
    });
  }, [clients]);

  const toggleCompany = (clientId: string, companyId: string) => {
    setSelectedCompanies((current) => {
      const selected = current[clientId] ?? [];
      return {
        ...current,
        [clientId]: selected.includes(companyId)
          ? selected.filter((id) => id !== companyId)
          : [...selected, companyId],
      };
    });
    setMessage("");
  };

  const saveVisibility = async (client: DemoContact) => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token || !client.kind) {
      setMessage("Este cliente ainda não possui um ponto operacional salvo.");
      return;
    }
    setSavingClientId(client.id);
    setMessage("");
    const response = await apiFetch(`/api/operations/locations/${client.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kind: client.kind,
        name: client.name,
        email: client.email,
        phone: client.phone,
        address: client.address,
        city: client.city,
        state: client.state,
        latitude: client.latitude,
        longitude: client.longitude,
        companyIds: selectedCompanies[client.id] ?? [],
        active: true,
      }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setMessage(body.error ?? "Não foi possível salvar as permissões.");
      setSavingClientId(null);
      return;
    }
    onUpdated(client.id, selectedCompanies[client.id] ?? []);
    setMessage("Permissões atualizadas com sucesso.");
    setSavingClientId(null);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[#0b1d3a]">
          Visibilidade dos clientes para transportadoras
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Escolha quais transportadoras poderão visualizar cada cliente final ou
          posto de coleta no mapa.
        </p>
      </div>
      {message && (
        <p className="mb-4 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
          {message}
        </p>
      )}
      {clients.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhum cliente operacional cadastrado.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <div
              key={client.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-[#0b1d3a]">
                    {client.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {client.kind === "collection_point"
                      ? "Posto de coleta"
                      : "Cliente final"}
                    {client.city ? ` · ${client.city}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">
                  {(selectedCompanies[client.id] ?? []).length} liberada(s)
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {companies.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nenhuma transportadora cadastrada.
                  </p>
                ) : (
                  companies.map((company) => (
                    <label
                      key={company.id}
                      className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={(selectedCompanies[client.id] ?? []).includes(
                          company.id,
                        )}
                        onChange={() => toggleCompany(client.id, company.id)}
                      />
                      <span className="min-w-0 truncate">{company.name}</span>
                    </label>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => void saveVisibility(client)}
                disabled={savingClientId === client.id}
                className="mt-3 w-full rounded-xl bg-[#0e4db7] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {savingClientId === client.id
                  ? "Salvando..."
                  : "Salvar visibilidade"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RegistrationCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Truck;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={18} className="text-[#1052c7]" />
        <h2 className="text-lg font-bold text-[#0b1d3a]">{title}</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function RegistrationList({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Truck;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={18} className="text-[#1052c7]" />
        <h2 className="text-lg font-bold text-[#0b1d3a]">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RegistryRow({
  title,
  detail,
  status,
  onEdit,
  onDelete,
}: {
  title: string;
  detail: string;
  status: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const labels: Record<string, string> = {
    active: "Ativo",
    in_analysis: "Em análise",
    rejected: "Reprovado",
    blocked: "Bloqueado",
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#0b1d3a]">{title}</p>
        <p className="truncate text-xs text-slate-500">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
          {labels[status] ?? status}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700"
            aria-label={`Editar ${title}`}
            title="Editar motorista"
          >
            <Pencil size={15} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
            aria-label={`Excluir ${title}`}
            title="Excluir motorista"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function LocationMapView({
  drivers,
  clients,
  clientSearch,
  setClientSearch,
  onClearClientSelection,
  selectedClientIds,
  routePath,
  routeSummary,
  routeLoading,
  routeError,
  onToggleClient,
  onCalculateRoute,
  selectedDriverId,
  cityFilter,
  setCityFilter,
  statusFilter,
  setStatusFilter,
  onSelectDriver,
  canOpenChat = false,
  isSuperAdmin = false,
  showRoutePanel = true,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
  clientSearch: string;
  setClientSearch: (value: string) => void;
  onClearClientSelection: () => void;
  selectedClientIds: string[];
  routePath: LatLngTuple[];
  routeSummary: { distance: number; duration: number } | null;
  routeLoading: boolean;
  routeError: string;
  onToggleClient: (clientId: string) => void;
  onCalculateRoute: () => void;
  selectedDriverId: string | null;
  cityFilter: string;
  setCityFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onSelectDriver: (value: string | null) => void;
  canOpenChat?: boolean;
  isSuperAdmin?: boolean;
  showRoutePanel?: boolean;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [driverFocusVersion, setDriverFocusVersion] = useState(0);

  const selectDriver = (driverId: string) => {
    onSelectDriver(driverId);
    setDriverFocusVersion((version) => version + 1);
  };

  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedDriverId]);

  const cities = [
    "Todas",
    ...Array.from(
      new Set(
        drivers
          .map((driver) => driver.availability_city ?? driver.city)
          .filter(Boolean),
      ),
    ),
  ];
  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ??
    drivers[0] ??
    null;
  const chatCollectionPoint = clients.find(
    (client) =>
      selectedClientIds.includes(client.id) &&
      client.kind === "collection_point",
  );
  const chatFinalCustomer = clients.find(
    (client) =>
      selectedClientIds.includes(client.id) && client.kind === "final_customer",
  );
  const openingFreightContext =
    selectedDriver && routeSummary && chatCollectionPoint && chatFinalCustomer
      ? {
          key: `${selectedDriver.id}:${chatCollectionPoint.id}:${chatFinalCustomer.id}:${routeSummary.distance}`,
          collectionPointId: chatCollectionPoint.id,
          collectionPointName: chatCollectionPoint.name,
          finalCustomerId: chatFinalCustomer.id,
          finalCustomerName: chatFinalCustomer.name,
        }
      : undefined;
  const openingChatProposal =
    selectedDriver && routeSummary && openingFreightContext
      ? {
          key: openingFreightContext.key,
          message: `Olá ${selectedDriver.full_name}, tenho uma proposta de frete para a rota ${openingFreightContext.collectionPointName} → ${openingFreightContext.finalCustomerName}. A distância estimada é ${formatRouteDistance(routeSummary.distance)}. Podemos conversar sobre o valor e as condições?`,
        }
      : undefined;
  const locatedDrivers = drivers.filter(
    (driver) =>
      Number.isFinite(driver.latitude) && Number.isFinite(driver.longitude),
  );
  const routeFocusActive = Boolean(
    selectedDriverId && selectedClientIds.length === 2,
  );
  const normalizeClientSearch = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const normalizedClientSearch = normalizeClientSearch(clientSearch);
  const searchedClients = normalizedClientSearch
    ? clients.filter((client) =>
        normalizeClientSearch(
          `${client.name} ${client.email} ${client.region}`,
        ).includes(normalizedClientSearch),
      )
    : [];
  const locatedClients = searchedClients.filter(
    (client) =>
      Number.isFinite(client.latitude) && Number.isFinite(client.longitude),
  );
  const searchedClientFocus = locatedClients[0] ?? null;
  const visibleDrivers = routeFocusActive
    ? locatedDrivers.filter((driver) => driver.id === selectedDriverId)
    : locatedDrivers;
  const visibleClients = routeFocusActive
    ? clients.filter(
        (client) =>
          selectedClientIds.includes(client.id) &&
          Number.isFinite(client.latitude) &&
          Number.isFinite(client.longitude),
      )
    : locatedClients;
  const mapPoints: LatLngTuple[] = [
    ...visibleDrivers.map(
      (driver) =>
        [driver.latitude as number, driver.longitude as number] as LatLngTuple,
    ),
    ...visibleClients.map(
      (client) =>
        [client.latitude as number, client.longitude as number] as LatLngTuple,
    ),
  ];
  const getStatusColor = (status: DemoDriver["status"]) => {
    if (status === "available") return "bg-emerald-500";
    if (status === "in_transit") return "bg-blue-500";
    if (status === "awaiting_documents") return "bg-rose-500";
    if (status === "awaiting_loading" || status === "awaiting_unloading") {
      return "bg-amber-500";
    }
    return "bg-slate-400";
  };
  const getStatusLabel = (status: DemoDriver["status"]) => statusLabel(status);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <MapPin className="text-[#1052c7]" size={18} />
          <h2 className="text-lg font-bold text-[#0b1d3a]">
            Localização dos motoristas
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Cidade
          </label>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-auto"
          >
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-auto"
          >
            <option value="Todos">Todos os status</option>
            <option value="available">Disponível</option>
            <option value="awaiting_loading">Aguardando carregamento</option>
            <option value="awaiting_documents">Aguardando documentação</option>
            <option value="in_transit">Em trânsito</option>
            <option value="awaiting_unloading">Aguardando descarga</option>
          </select>
          <input
            type="search"
            value={clientSearch}
            onChange={(event) => {
              const value = event.target.value;
              setClientSearch(value);
              if (!value.trim()) onClearClientSelection();
            }}
            placeholder="Buscar cliente ou posto"
            aria-label="Buscar cliente ou posto no mapa"
            className="w-full min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-80 sm:flex-none"
          />
        </div>
      </div>

      {!clientSearch.trim() && (
        <p className="mb-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {routeFocusActive
            ? "Rota em foco: motorista, posto e cliente final selecionados."
            : "Busque um cliente por nome, e-mail ou região para exibi-lo no mapa."}
        </p>
      )}
      {clientSearch.trim() && (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          {searchedClients.length === 0 ? (
            <p>Nenhum cliente encontrado para essa busca.</p>
          ) : (
            <div className="space-y-1">
              <p className="font-semibold">
                {searchedClients.length} cliente
                {searchedClients.length === 1 ? "" : "s"} encontrado
                {searchedClients.length === 1 ? "" : "s"}.
              </p>
              {searchedClients.map((client) => (
                <p key={client.id}>
                  {client.name} · {client.region || "Região não informada"}
                  {!Number.isFinite(client.latitude) ||
                  !Number.isFinite(client.longitude)
                    ? " · sem localização GPS"
                    : " · exibido no mapa"}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_0.8fr]">
        <div className="relative h-[420px] overflow-hidden rounded-2xl border border-slate-200">
          <MapContainer
            className="h-full w-full"
            center={mapPoints[0] ?? [-14.235, -51.9253]}
            zoom={4}
            scrollWheelZoom
            zoomControl
          >
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com/">Esri</a>, World Street Map'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
            />
            <MapViewport
              drivers={visibleDrivers}
              clients={visibleClients}
              selectedDriver={selectedDriver}
              focusedClient={searchedClientFocus}
              driverFocusVersion={driverFocusVersion}
            />
            {visibleDrivers.map((driver) => {
              const isSelected = selectedDriver?.id === driver.id;
              return (
                <Marker
                  key={driver.id}
                  position={driverMarkerPosition(driver, locatedDrivers)}
                  icon={truckMarkerIcon(isSelected)}
                  eventHandlers={{
                    click: () => selectDriver(driver.id),
                    mouseover: (event) => event.target.openPopup(),
                    mouseout: (event) => event.target.closePopup(),
                  }}
                >
                  <Popup>
                    <strong>{driver.full_name}</strong>
                    <br />
                    {driver.city ?? "Localização GPS atual"}
                    {driver.state ? ` · ${driver.state}` : ""}
                    <br />
                    Transportadora: {driver.carrier?.name ?? "Não informada"}
                    <br />
                    {driver.availability_city
                      ? `Previsto em ${driver.availability_city} · ${formatAvailabilityForecast(driver.availability_at)}`
                      : "Previsão de cidade não informada"}
                    <br />
                    Atualizado às {formatAvailabilityTime(driver.last_seen)}
                  </Popup>
                </Marker>
              );
            })}
            {visibleClients.map((client) => (
              <Marker
                key={client.id}
                position={[
                  client.latitude as number,
                  client.longitude as number,
                ]}
                icon={clientMarkerIcon(client.kind)}
                eventHandlers={{
                  click: () => onToggleClient(client.id),
                  mouseover: (event) => event.target.openPopup(),
                  mouseout: (event) => event.target.closePopup(),
                }}
              >
                <Popup>
                  <strong>{client.name}</strong>
                  <br />
                  {client.kind === "collection_point"
                    ? "Posto de coleta"
                    : "Cliente final"}{" "}
                  · {client.region}
                  <br />
                  {client.email}
                  <br />
                  {selectedClientIds.includes(client.id)
                    ? "Ponto selecionado"
                    : "Clique para selecionar este ponto"}
                </Popup>
              </Marker>
            ))}
            {routePath.length > 1 && (
              <Polyline
                positions={routePath}
                pathOptions={{ color: "#16a34a", weight: 5, opacity: 0.9 }}
              />
            )}
          </MapContainer>
          {visibleDrivers.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-5 z-[1000] -translate-x-1/2 rounded-2xl border border-amber-200 bg-white/95 px-4 py-3 text-center shadow-lg backdrop-blur">
              <p className="text-sm font-bold text-amber-800">
                Nenhum motorista disponível
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {clientSearch.trim()
                  ? "Nenhum cliente localizado com essa busca."
                  : "Busque um cliente para exibi-lo no mapa."}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {selectedDriver ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div
                className="flex cursor-pointer items-center justify-between gap-3"
                onClick={() => setDetailsExpanded((expanded) => !expanded)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDetailsExpanded((expanded) => !expanded);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={detailsExpanded}
                aria-label="Exibir detalhes do motorista selecionado"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Motorista selecionado
                  </p>
                  <h3 className="mt-1 text-xl font-bold text-[#0b1d3a]">
                    {selectedDriver.full_name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedDriver.city || "Localização não informada"} ·{" "}
                    {selectedDriver.capacity || "Capacidade não informada"}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-blue-700">
                    Transportadora:{" "}
                    {selectedDriver.carrier?.name ?? "Não informada"}
                  </p>
                  {selectedDriver.availability_city && (
                    <p className="mt-1 text-xs font-semibold text-emerald-700">
                      Previsto em {selectedDriver.availability_city} ·{" "}
                      {formatAvailabilityForecast(
                        selectedDriver.availability_at,
                      )}
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${selectedDriver.is_online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${getStatusColor(selectedDriver.status)}`}
                  />
                  {selectedDriver.is_online
                    ? getStatusLabel(selectedDriver.status)
                    : "Não disponível"}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <span>
                  {selectedDriver.status === "in_transit"
                    ? "Rastreamento de rota ativo"
                    : "Última posição informada pelo motorista"}
                </span>
                {selectedDriver.last_seen && (
                  <strong>
                    {new Date(selectedDriver.last_seen).toLocaleTimeString(
                      "pt-BR",
                    )}
                  </strong>
                )}
              </div>

              {detailsExpanded && (
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>E-mail</span>
                    <strong className="max-w-[65%] truncate text-right text-[#0b1d3a]">
                      {selectedDriver.email || "E-mail não informado"}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Veículo</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.vehicle_model}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Placa</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.plate}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Telefone</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.phone}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Capacidade</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.capacity}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Compartimentação</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.compartments}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Local</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.city} / {selectedDriver.state}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                    <span>Avaliação</span>
                    <strong className="text-[#0b1d3a]">
                      {selectedDriver.rating.toFixed(1)}
                    </strong>
                  </div>
                </div>
              )}
              {detailsExpanded && selectedDriver.notes && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {selectedDriver.notes}
                </p>
              )}
              {whatsappHref(
                selectedDriver.phone,
                buildFreightNegotiationMessage(
                  selectedDriver,
                  clients,
                  selectedClientIds,
                  routeSummary,
                ),
              ) ? (
                <a
                  href={
                    whatsappHref(
                      selectedDriver.phone,
                      buildFreightNegotiationMessage(
                        selectedDriver,
                        clients,
                        selectedClientIds,
                        routeSummary,
                      ),
                    ) ?? undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700"
                >
                  <MessageCircle size={17} />
                  Negociar frete pelo WhatsApp
                </a>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-center text-xs text-slate-500">
                  Telefone do motorista não informado para negociar o frete.
                </p>
              )}
              {canOpenChat && (
                <div className="mt-2">
                  <DriverChat
                    key={selectedDriver.id}
                    driverId={selectedDriver.id}
                    participantName={selectedDriver.full_name}
                    openingProposal={openingChatProposal}
                    freightContext={openingFreightContext}
                  />
                </div>
              )}
              {isSuperAdmin && (
                <div className="mt-3">
                  <DriverChatArchive
                    headers={{
                      Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Selecione um motorista para ver os detalhes.
            </div>
          )}

          {showRoutePanel && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h3 className="font-bold text-orange-950">
                    Rota para clientes
                  </h3>
                  <p className="mt-1 text-xs text-orange-800">
                    Selecione um posto de coleta e um cliente final no mapa.
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-bold text-orange-800">
                  {selectedClientIds.length} destino
                  {selectedClientIds.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {clients
                  .filter((client) => selectedClientIds.includes(client.id))
                  .map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => onToggleClient(client.id)}
                      className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700"
                    >
                      <span>{client.name}</span>
                      <span className="text-orange-600">Remover</span>
                    </button>
                  ))}
              </div>
              <button
                type="button"
                onClick={onCalculateRoute}
                disabled={routeLoading || selectedClientIds.length !== 2}
                className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {routeLoading ? "Calculando rota..." : "Calcular rota"}
              </button>
              {routeSummary && (
                <p className="mt-3 text-xs font-semibold text-orange-900">
                  {formatRouteDistance(routeSummary.distance)} ·{" "}
                  {formatRouteDuration(routeSummary.duration)}
                </p>
              )}
              {routeError && (
                <p className="mt-3 text-xs font-semibold text-rose-700">
                  {routeError}
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
              Motoristas da cidade
            </h3>
            <div className="space-y-3">
              {drivers.map((driver) => (
                <button
                  key={driver.id}
                  type="button"
                  onClick={() => selectDriver(driver.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                    selectedDriver?.id === driver.id
                      ? "border-blue-200 bg-blue-50"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <div>
                    <p className="font-semibold text-[#0b1d3a]">
                      {driver.full_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {driver.vehicle_model}
                    </p>
                  </div>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${getStatusColor(driver.status)}`}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapViewport({
  drivers,
  clients,
  selectedDriver,
  focusedClient,
  driverFocusVersion,
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
  selectedDriver: DemoDriver | null;
  focusedClient: DemoContact | null;
  driverFocusVersion: number;
}) {
  const map = useMap();
  const hasFitted = useRef(false);
  const hasInitializedDriverSelection = useRef(false);
  const previousSelectedId = useRef<string | null>(null);
  const previousDriverFocusVersion = useRef(0);
  const previousFocusedClientId = useRef<string | null>(null);

  useEffect(() => {
    if (hasFitted.current || (drivers.length === 0 && clients.length === 0))
      return;
    const points: LatLngTuple[] = [
      ...drivers.map(
        (driver) =>
          [
            driver.latitude as number,
            driver.longitude as number,
          ] as LatLngTuple,
      ),
      ...clients.map(
        (client) =>
          [
            client.latitude as number,
            client.longitude as number,
          ] as LatLngTuple,
      ),
    ];
    map.fitBounds(points, { padding: [32, 32], maxZoom: 14 });
    hasFitted.current = true;
  }, [clients, drivers, map]);

  useEffect(() => {
    if (!focusedClient) {
      previousFocusedClientId.current = null;
      return;
    }
    if (previousFocusedClientId.current !== focusedClient.id) {
      map.flyTo(
        [focusedClient.latitude as number, focusedClient.longitude as number],
        Math.max(map.getZoom(), 14),
        { duration: 0.6 },
      );
    }
    previousFocusedClientId.current = focusedClient.id;
  }, [focusedClient, map]);

  useEffect(() => {
    const hasLocation =
      selectedDriver &&
      Number.isFinite(selectedDriver.latitude) &&
      Number.isFinite(selectedDriver.longitude);
    if (!hasInitializedDriverSelection.current && selectedDriver) {
      hasInitializedDriverSelection.current = true;
      previousSelectedId.current = selectedDriver.id;
      previousDriverFocusVersion.current = driverFocusVersion;
      return;
    }
    const shouldFocus =
      hasLocation &&
      (previousSelectedId.current !== selectedDriver.id ||
        previousDriverFocusVersion.current !== driverFocusVersion);
    if (shouldFocus) {
      map.flyTo(
        [selectedDriver.latitude as number, selectedDriver.longitude as number],
        16,
        { duration: 0.8 },
      );
    }
    previousSelectedId.current = selectedDriver?.id ?? null;
    previousDriverFocusVersion.current = driverFocusVersion;
  }, [driverFocusVersion, map, selectedDriver]);

  return null;
}

function statusLabel(status: DemoDriver["status"]): string {
  const labels: Record<DemoDriver["status"], string> = {
    offline: "Não disponível",
    available: "Estou disponível",
    awaiting_loading: "Aguardando carregamento",
    awaiting_documents: "Aguardando documentação",
    in_transit: "Em trânsito",
    awaiting_unloading: "Aguardando descarga",
    in_negotiation: "Negociando",
  };
  return labels[status] ?? status;
}

function formatAvailabilityTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString("pt-BR") : "agora";
}

function formatAvailabilityForecast(value: string | null | undefined): string {
  if (!value) return "Data/hora não informada";
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Data/hora não informada";
  const today = new Date();
  const dateOnly = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
  ).getTime();
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const dayDifference = Math.round((dateOnly - todayOnly) / 86_400_000);
  const dayLabel =
    dayDifference === 0
      ? "Hoje"
      : dayDifference === 1
        ? "Amanhã"
        : timestamp.toLocaleDateString("pt-BR");
  return `${dayLabel} às ${timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function whatsappHref(
  phone: string | null | undefined,
  message?: string,
): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  const international = digits.startsWith("55") ? digits : `55${digits}`;
  const encodedMessage = message ? `&text=${encodeURIComponent(message)}` : "";
  return `https://web.whatsapp.com/send?phone=${international}${encodedMessage}`;
}

function buildFreightNegotiationMessage(
  driver: DemoDriver,
  clients: DemoContact[],
  selectedClientIds: string[],
  routeSummary: { distance: number; duration: number } | null,
): string {
  const destinations = clients
    .filter((client) => selectedClientIds.includes(client.id))
    .map((client) => client.name)
    .join(", ");
  const route = routeSummary
    ? ` A rota estimada tem ${formatRouteDistance(routeSummary.distance)} e ${formatRouteDuration(routeSummary.duration).replace(" estimados", " estimados")}.`
    : " Ainda estou confirmando os detalhes da rota.";
  const destinationText = destinations
    ? ` O frete envolve os destinos: ${destinations}.`
    : " Gostaria de confirmar sua disponibilidade para um frete.";

  return `Olá, ${driver.full_name}! Gostaria de negociar um frete com você.${destinationText}${route} Podemos conversar sobre o valor e as condições?`;
}

export default App;
