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
  LogOut,
  UserPlus,
  Users,
  MapPin,
  Bell,
  ArrowRight,
  MessageCircle,
  Pencil,
  Trash2,
  Phone,
  Star,
  UsersRound,
  Factory,
  Flag,
  Building2,
  FileCheck2,
  Link2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type {
  AccessLevel,
  ApprovalDriverFields,
  DemoContact,
  DemoDriver,
  DirectoryOperator,
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
import { AccountCenter } from "@/components/AccountCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DirectoryPanel, MetricCard } from "@/components/DashboardPrimitives";
import { DirectorySearch as ReusableDirectorySearch } from "@/components/DirectorySearch";
import { RegistrationRequestsPanel as ReusableRegistrationRequestsPanel } from "@/components/RegistrationRequestsPanel";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { AppDownloadButton } from "@/components/AppDownloadButton";
import { apiEventSource, apiFetch } from "@/lib/api";

function App() {
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

  if (profile?.role === "operator") {
    return (
      <RoleDashboard
        role="operator"
        title="Operador"
        subtitle="Painel de operação"
        accountUser={user}
        accountProfile={profile}
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
  const [driverForm, setDriverForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [vehicleForm, setVehicleForm] = useState({
    type: "",
    plate: "",
    capacity: "",
    compartments: "",
    products: "",
  });
  const [error, setError] = useState("");
  const [assignmentDriverIds, setAssignmentDriverIds] = useState<
    Record<string, string>
  >({});
  const headers = {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };

  const refresh = async () => {
    const response = await apiFetch("/api/carrier/registrations", { headers });
    if (response.ok) {
      const body = (await response.json()) as {
        drivers: DemoDriver[];
        vehicles: typeof vehicles;
      };
      setDrivers(body.drivers);
      setVehicles(body.vehicles);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const submitDriver = async () => {
    setError("");
    const response = await apiFetch("/api/carrier/drivers", {
      method: "POST",
      headers,
      body: JSON.stringify(driverForm),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      return setError(body.error ?? "Não foi possível cadastrar o motorista");
    setDriverForm({ fullName: "", email: "", phone: "", password: "" });
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
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10"
        >
          Sair
        </button>
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
        <div className="grid gap-6 xl:grid-cols-2">
          <RegistrationCard title="Solicitar motorista" icon={Users}>
            <input
              value={driverForm.fullName}
              onChange={(e) =>
                setDriverForm((form) => ({ ...form, fullName: e.target.value }))
              }
              placeholder="Nome completo *"
              className={registrationInputClass}
            />
            <input
              value={driverForm.email}
              onChange={(e) =>
                setDriverForm((form) => ({ ...form, email: e.target.value }))
              }
              placeholder="E-mail *"
              type="email"
              className={registrationInputClass}
            />
            <input
              value={driverForm.phone}
              onChange={(e) =>
                setDriverForm((form) => ({ ...form, phone: e.target.value }))
              }
              placeholder="Celular / WhatsApp *"
              className={registrationInputClass}
            />
            <input
              value={driverForm.password}
              onChange={(e) =>
                setDriverForm((form) => ({ ...form, password: e.target.value }))
              }
              placeholder="Senha inicial *"
              type="password"
              className={registrationInputClass}
            />
            <p className="text-xs text-slate-500 sm:col-span-2">
              O vínculo com veículo é opcional e pode ser feito depois da
              aprovação.
            </p>
            <button
              type="button"
              onClick={() => void submitDriver()}
              className={registrationButtonClass}
            >
              Enviar para aprovação <ArrowRight size={15} />
            </button>
          </RegistrationCard>
          <RegistrationCard title="Solicitar veículo" icon={Truck}>
            <input
              value={vehicleForm.type}
              onChange={(e) =>
                setVehicleForm((form) => ({ ...form, type: e.target.value }))
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
          </RegistrationCard>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <RegistrationList title="Motoristas da transportadora" icon={Users}>
            {drivers.map((driver) => (
              <RegistryRow
                key={driver.id}
                title={driver.full_name}
                detail={`${driver.phone ?? "Sem telefone"} · ${driver.current_vehicle?.plate ?? "Sem veículo vinculado"}`}
                status={driver.homologation_status ?? "in_analysis"}
              />
            ))}
          </RegistrationList>
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
                          (driver) => driver.homologation_status === "active",
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
        </div>
      </main>
    </div>
  );
}

function RoleDashboard({
  role,
  title,
  subtitle,
  accountUser,
  accountProfile,
  onSignOut,
}: {
  role: "operator" | "admin";
  title: string;
  subtitle: string;
  accountUser: {
    email: string;
    phone?: string | null;
    user_metadata: { full_name?: string };
  };
  accountProfile: { role: string; created_at: string } | null;
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
  const [locationKind, setLocationKind] = useState<
    "collection_point" | "final_customer"
  >("final_customer");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLatitude, setLocationLatitude] = useState("");
  const [locationLongitude, setLocationLongitude] = useState("");
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
  const [driverForm, setDriverForm] = useState({
    full_name: "",
    email: "",
    city: "",
    state: "",
    vehicle_model: "",
    plate: "",
    phone: "",
    capacity: "",
    compartments: "",
    notes: "",
    cpf: "",
    cnh: "",
    cnh_category: "",
    cnh_expires_at: "",
    location_sharing_authorized: false,
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
    "resumo" | "cadastros" | "localizacao" | "conta" | "solicitacoes"
  >("resumo");
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
    Record<string, "driver" | "carrier" | "operator" | "admin">
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

  const showFormError = (message: string) => setFormError(message);

  useEffect(() => {
    saveList("acneto-clients", clients);
  }, [clients]);

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
              locations: Array<{
                id: string;
                kind: "collection_point" | "final_customer";
                name: string;
                email: string | null;
                phone: string | null;
                address: string | null;
                city: string | null;
                state: string | null;
                latitude: number | null;
                longitude: number | null;
              }>;
            }>,
        )
        .then(
          ({
            drivers: apiDrivers,
            all_drivers: apiAllDrivers,
            operators: apiOperators,
            locations = [],
          }) => {
            setDrivers(apiDrivers);
            setDirectoryDrivers(apiAllDrivers);
            setDirectoryOperators(apiOperators);
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
                locations: Array<{
                  id: string;
                  kind: "collection_point" | "final_customer";
                  name: string;
                  email: string | null;
                  phone: string | null;
                  address: string | null;
                  city: string | null;
                  state: string | null;
                  latitude: number | null;
                  longitude: number | null;
                }>;
              }>,
          )
          .then(
            ({
              drivers: apiDrivers,
              all_drivers: apiAllDrivers,
              operators: apiOperators,
              locations = [],
            }) => {
              setDrivers(apiDrivers);
              setDirectoryDrivers(apiAllDrivers);
              setDirectoryOperators(apiOperators);
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
    const role = approvalRoles[pendingUser.id] ?? pendingUser.requested_role;
    const fields = approvalDriverFields[pendingUser.id];
    const initialPassword = initialPasswords[pendingUser.id] ?? "";
    if (["operator", "admin"].includes(role) && initialPassword.length < 8) {
      showFormError("Informe uma senha inicial com no mínimo 8 caracteres.");
      return;
    }
    const publicDriverRequest = role === "driver" && !pendingUser.company_id;
    const requiredPublicDriverFields = fields
      ? [
          fields.full_name,
          fields.phone,
          fields.cpf,
          fields.cnh,
          fields.cnh_category,
          fields.cnh_expires_at,
          fields.vehicle_model,
          fields.plate,
          fields.vehicle_year,
          fields.city,
          fields.state,
          fields.capacity,
          fields.compartments,
        ]
      : [];
    if (
      role === "driver" &&
      (!fields ||
        (publicDriverRequest
          ? requiredPublicDriverFields.some(
              (value) => !String(value ?? "").trim(),
            )
          : !fields.full_name.trim() || !fields.phone.trim()))
    ) {
      showFormError(
        publicDriverRequest
          ? "Preencha todos os dados pessoais, CNH e veículo do motorista antes de aprovar."
          : "Preencha nome e telefone do motorista antes de aprovar. O veículo é opcional.",
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
                vehicleModel: fields.vehicle_model,
                plate: fields.plate,
                city: fields.city,
                state: fields.state,
                capacity: fields.capacity,
                compartments: fields.compartments,
                cpf: fields.cpf,
                cnh: fields.cnh,
                cnhCategory: fields.cnh_category,
                cnhExpiresAt: fields.cnh_expires_at,
                vehicleYear: fields.vehicle_year,
                locationSharingAuthorized: fields.location_sharing_authorized,
              }
            : undefined,
        }),
      },
    );
    if (response.ok) {
      setPendingUsers((current) =>
        current.filter((user) => user.id !== pendingUser.id),
      );
    } else {
      const body = (await response.json()) as { error?: string };
      showFormError(body.error ?? "Não foi possível finalizar a aprovação.");
    }
  };

  const rejectUser = async (pendingUser: PendingUser) => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token) return;
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
      .filter((driver) => cityFilter === "Todas" || driver.city === cityFilter)
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

  const calculateRoute = async () => {
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
      return;
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
    } catch {
      setRouteError("Não foi possível calcular a rota. Tente novamente.");
      setRoutePath([]);
      setRouteSummary(null);
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

  const geocodeAddress = async (address: string, city: string) => {
    const query = [address, city].filter(Boolean).join(", ");
    if (!query) return null;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
      );
      if (!response.ok) return null;

      const results = (await response.json()) as Array<{
        lat?: string;
        lon?: string;
      }>;
      const match = results[0];
      if (!match?.lat || !match?.lon) return null;

      return {
        latitude: Number(match.lat),
        longitude: Number(match.lon),
      };
    } catch {
      return null;
    }
  };

  const handleAdd = async (requestedAccessLevel: AccessLevel = accessLevel) => {
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

    if (
      requestedAccessLevel === "cliente" &&
      localStorage.getItem("acneto-access-token")
    ) {
      const addressText = locationAddress.trim();
      const cityText = region.trim();

      if (!locationPhone.trim()) {
        showFormError("Informe o WhatsApp do cliente ou posto de coleta.");
        return;
      }

      if (!addressText) {
        showFormError(
          "Informe o endereço completo do cliente antes de salvar.",
        );
        return;
      }

      const coordinates = await geocodeAddress(addressText, cityText);
      if (!coordinates) {
        showFormError(
          "Não foi possível localizar este endereço. Informe um endereço mais completo ou uma rua/cidade válida.",
        );
        return;
      }

      const response = await apiFetch("/api/operations/locations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
        },
        body: JSON.stringify({
          kind: locationKind,
          name: name.trim(),
          email: email.trim(),
          phone: locationPhone.trim(),
          address: addressText,
          city: cityText,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        showFormError(body.error ?? "Não foi possível salvar o cliente.");
        return;
      }
      const body = (await response.json()) as { location: DemoContact };
      setClients((items) => [body.location, ...items]);
      setName("");
      setEmail("");
      setLocationPhone("");
      setRegion("");
      setLocationAddress("");
      setLocationLatitude("");
      setLocationLongitude("");
      setFormSuccess("Cadastro criado com sucesso.");
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
    } else if (requestedAccessLevel === "cliente") {
      setClients((prev) => [newEntry, ...prev]);
    } else {
      setOperators((prev) => [newEntry, ...prev]);
    }

    setName("");
    setEmail("");
    setRegion("");
    setLocationAddress("");
    setLocationLatitude("");
    setLocationLongitude("");
    setAccessLevel(role === "admin" ? "operador" : "cliente");
  };

  const editContact = (contact: DemoContact) => {
    setEditingContactId(contact.id);
    setName(contact.name);
    setEmail(contact.email);
    setLocationPhone(contact.phone ?? "");
    setRegion(contact.region);
    setAccessLevel(contact.accessLevel);
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
      city: driver.city ?? "",
      state: driver.state ?? "",
      vehicle_model: driver.vehicle_model ?? "",
      plate: driver.plate ?? "",
      phone: driver.phone ?? "",
      capacity: driver.capacity ?? "",
      compartments: driver.compartments ?? "",
      notes: driver.notes ?? "",
      cpf: driver.cpf ?? "",
      cnh: driver.cnh ?? "",
      cnh_category: driver.cnh_category ?? "",
      cnh_expires_at: driver.cnh_expires_at?.slice(0, 10) ?? "",
      location_sharing_authorized: driver.location_sharing_authorized ?? false,
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
  };

  const handleAddDriver = () => {
    const requiredDriverFields = [
      driverForm.full_name,
      driverForm.city,
      driverForm.state,
      driverForm.phone,
    ];
    if (requiredDriverFields.some((field) => !field.trim())) {
      setDriverFormError("Preencha todos os campos obrigatórios do motorista.");
      showFormError("Preencha todos os campos obrigatórios do motorista.");
      return;
    }
    setDriverFormError("");

    const newDriver: DemoDriver = {
      id: `driver-${Date.now()}`,
      full_name: driverForm.full_name.trim(),
      email: driverForm.email.trim() || null,
      city: driverForm.city,
      state: driverForm.state,
      vehicle_model: driverForm.vehicle_model.trim(),
      plate: driverForm.plate.trim(),
      phone: driverForm.phone.trim(),
      capacity: driverForm.capacity.trim(),
      compartments: driverForm.compartments.trim(),
      notes: "",
      availability_since: new Date().toISOString(),
      is_online: true,
      rating: 4.8,
      status: "available",
      latitude: null,
      longitude: null,
      cpf: driverForm.cpf.trim() || null,
      cnh: driverForm.cnh.trim() || null,
      cnh_category: driverForm.cnh_category.trim() || null,
      cnh_expires_at: driverForm.cnh_expires_at || null,
      location_sharing_authorized: driverForm.location_sharing_authorized,
      homologation_status: "in_analysis",
      current_vehicle: null,
      carrier: null,
    };

    if (editingDriverId) {
      const token = localStorage.getItem("acneto-access-token");
      if (token) {
        void apiFetch(`/api/admin/drivers/${editingDriverId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fullName: newDriver.full_name,
            email: newDriver.email,
            city: newDriver.city,
            state: newDriver.state,
            vehicleModel: newDriver.vehicle_model,
            plate: newDriver.plate,
            phone: newDriver.phone,
            capacity: newDriver.capacity,
            compartments: newDriver.compartments,
            notes: newDriver.notes,
            cpf: newDriver.cpf,
            cnh: newDriver.cnh,
            cnhCategory: newDriver.cnh_category,
            cnhExpiresAt: newDriver.cnh_expires_at,
            locationSharingAuthorized: newDriver.location_sharing_authorized,
          }),
        });
      }
      setDrivers((prev) =>
        prev.map((item) =>
          item.id === editingDriverId
            ? {
                ...item,
                full_name: newDriver.full_name,
                email: newDriver.email,
                city: newDriver.city,
                state: newDriver.state,
                vehicle_model: newDriver.vehicle_model,
                plate: newDriver.plate,
                phone: newDriver.phone,
                capacity: newDriver.capacity,
                compartments: newDriver.compartments,
                notes: newDriver.notes,
                cpf: newDriver.cpf,
                cnh: newDriver.cnh,
                cnh_category: newDriver.cnh_category,
                cnh_expires_at: newDriver.cnh_expires_at,
                location_sharing_authorized:
                  newDriver.location_sharing_authorized,
              }
            : item,
        ),
      );
      setEditingDriverId(null);
    } else {
      setDrivers((prev) => [newDriver, ...prev]);
    }
    setDriverForm({
      full_name: "",
      email: "",
      city: "",
      state: "",
      vehicle_model: "",
      plate: "",
      phone: "",
      capacity: "",
      compartments: "",
      notes: "",
      cpf: "",
      cnh: "",
      cnh_category: "",
      cnh_expires_at: "",
      location_sharing_authorized: false,
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

  const rateDriver = async (driver: DemoDriver, rating: number) => {
    const nextRating = Math.min(5, Math.max(1, rating));
    setDrivers((items) =>
      items.map((item) =>
        item.id === driver.id ? { ...item, rating: nextRating } : item,
      ),
    );
    const token = localStorage.getItem("acneto-access-token");
    if (token) {
      await apiFetch(`/api/admin/drivers/${driver.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating: nextRating }),
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] p-4 sm:p-6">
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
        onClose={() => {
          if (pendingRejection) void rejectUser(pendingRejection);
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
            <AppDownloadButton />
            <button
              onClick={() => onSignOut()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        </header>

        <section
          className={`mb-6 grid gap-4 ${role === "admin" ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
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
            label="Motoristas online"
            value={String(activeDrivers)}
            active={directory === "drivers"}
            onClick={() => setDirectory("drivers")}
          />
        </section>

        <div
          className={`mb-6 grid gap-1 rounded-xl bg-slate-100 p-1 ${role === "admin" || role === "operator" ? "grid-cols-5" : "grid-cols-4"}`}
        >
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
              onClick={() => setTab("solicitacoes")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "solicitacoes"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <span>{role === "admin" ? "Solicitações" : "Aprovações"}</span>
              {pendingUsers.length > 0 && (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingUsers.length}
                </span>
              )}
            </button>
          )}
        </div>

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
                canDelete={role === "admin"}
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
                        placeholder="Nome do motorista"
                        required
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
                        placeholder="E-mail do cadastro"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.cpf}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            cpf: e.target.value,
                          }))
                        }
                        placeholder="CPF"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.cnh}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            cnh: e.target.value,
                          }))
                        }
                        placeholder="CNH"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.cnh_category}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            cnh_category: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="Categoria da CNH"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600">
                        <span className="text-xs font-semibold">
                          Validade da CNH
                        </span>
                        <input
                          type="date"
                          value={driverForm.cnh_expires_at}
                          onChange={(e) =>
                            setDriverForm((prev) => ({
                              ...prev,
                              cnh_expires_at: e.target.value,
                            }))
                          }
                          className="min-w-0 flex-1 bg-transparent outline-none"
                        />
                      </label>
                      <input
                        value={driverForm.vehicle_model}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            vehicle_model: e.target.value,
                          }))
                        }
                        placeholder="Veículo"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.city}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            city: e.target.value,
                          }))
                        }
                        placeholder="Cidade"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.state}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            state: e.target.value,
                          }))
                        }
                        placeholder="UF"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.plate}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            plate: e.target.value,
                          }))
                        }
                        placeholder="Placa"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                      />
                      <input
                        value={driverForm.phone}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        placeholder="Telefone"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.capacity}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            capacity: e.target.value,
                          }))
                        }
                        placeholder="Capacidade (ex.: 30.000 L)"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <input
                        value={driverForm.compartments}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            compartments: e.target.value,
                          }))
                        }
                        placeholder="Compartimentação"
                        required
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <textarea
                        value={driverForm.notes}
                        onChange={(e) =>
                          setDriverForm((prev) => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                        placeholder="Observações sobre manutenção, documentos ou liberação"
                        rows={2}
                        className="resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                      />
                      <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={driverForm.location_sharing_authorized}
                          onChange={(e) =>
                            setDriverForm((prev) => ({
                              ...prev,
                              location_sharing_authorized: e.target.checked,
                            }))
                          }
                        />
                        Autoriza o compartilhamento da localização
                      </label>
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
                        placeholder="Região"
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
                          <input
                            value={locationAddress}
                            onChange={(e) => setLocationAddress(e.target.value)}
                            placeholder="Endereço completo do ponto"
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                          />
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
          />
        ) : tab === "solicitacoes" ? (
          <div className="space-y-5">
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

export function RegistrationRequestsPanel({
  requests,
  approvalRoles,
  approvalDriverFields,
  onRoleChange,
  onDriverFieldChange,
  onApprove,
  onClose,
  onReopen,
}: {
  requests: PendingUser[];
  approvalRoles: Record<string, "driver" | "carrier" | "operator" | "admin">;
  approvalDriverFields: Record<string, ApprovalDriverFields>;
  onRoleChange: (
    userId: string,
    value: "driver" | "carrier" | "operator" | "admin",
  ) => void;
  onDriverFieldChange: (
    userId: string,
    field: keyof ApprovalDriverFields,
    value: string,
  ) => void;
  onApprove: (request: PendingUser) => void;
  onClose: (userId: string) => void;
  onReopen: (userId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0b1d3a]">
            Solicitações de cadastro
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Consulte solicitações abertas e encerradas para uma nova análise.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          {requests.length}
        </span>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhuma solicitação registrada.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-[#0b1d3a]">
                  {request.full_name || "Nome não informado"}
                </p>
                <p className="text-xs text-slate-500">
                  {request.email} · {request.phone || "Telefone não informado"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Solicitação para{" "}
                  {request.requested_role === "operator"
                    ? "operador"
                    : "motorista"}{" "}
                  · {new Date(request.created_at).toLocaleString("pt-BR")}
                </p>
                {request.registration_notes && (
                  <p className="mt-2 text-sm text-slate-600">
                    {request.registration_notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${request.approval_closed ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}
                >
                  {request.approval_closed ? "Fechada" : "Em análise"}
                </span>
                {!request.approval_closed &&
                  (approvalRoles[request.id] ?? request.requested_role) ===
                    "driver" && (
                    <div className="grid w-full gap-2 sm:absolute sm:mt-48 sm:grid-cols-2">
                      {(
                        [
                          ["full_name", "Nome completo"],
                          ["phone", "Telefone"],
                          ["vehicle_model", "Veículo"],
                          ["plate", "Placa"],
                          ["city", "Cidade"],
                          ["state", "UF"],
                          ["capacity", "Capacidade"],
                          ["compartments", "Compartimentação"],
                        ] as const
                      ).map(([field, placeholder]) => (
                        <input
                          key={field}
                          value={
                            approvalDriverFields[request.id]?.[field] ?? ""
                          }
                          onChange={(event) =>
                            onDriverFieldChange(
                              request.id,
                              field,
                              event.target.value,
                            )
                          }
                          placeholder={`${placeholder} *`}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      ))}
                    </div>
                  )}
                {!request.approval_closed && (
                  <>
                    <select
                      value={
                        approvalRoles[request.id] ?? request.requested_role
                      }
                      onChange={(event) =>
                        onRoleChange(
                          request.id,
                          event.target.value as "driver" | "operator" | "admin",
                        )
                      }
                      className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700"
                      aria-label={`Perfil de ${request.full_name ?? request.email}`}
                    >
                      <option value="driver">Motorista</option>
                      <option value="operator">Operador</option>
                      <option value="admin">Administrador</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onApprove(request)}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Aprovar cadastro
                    </button>
                  </>
                )}
                {request.approval_closed ? (
                  <button
                    type="button"
                    onClick={() => onReopen(request.id)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Reabrir
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onClose(request.id)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Fechar aprovação
                  </button>
                )}
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
}: {
  title: string;
  detail: string;
  status: string;
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
      <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
        {labels[status] ?? status}
      </span>
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
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedDriverId]);

  const cities = [
    "Todas",
    ...Array.from(new Set(drivers.map((driver) => driver.city))),
  ];
  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ??
    drivers[0] ??
    null;
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
            center={mapPoints[0] ?? [-15.7939, -47.8828]}
            zoom={mapPoints.length > 0 ? 12 : 4}
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
            />
            {visibleDrivers.map((driver) => {
              const isSelected = selectedDriver?.id === driver.id;
              return (
                <Marker
                  key={driver.id}
                  position={driverMarkerPosition(driver, locatedDrivers)}
                  icon={truckMarkerIcon(isSelected)}
                  eventHandlers={{
                    click: () => onSelectDriver(driver.id),
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
                Nenhum motorista online
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
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${selectedDriver.is_online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${getStatusColor(selectedDriver.status)}`}
                  />
                  {selectedDriver.is_online
                    ? getStatusLabel(selectedDriver.status)
                    : "Offline"}
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
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Selecione um motorista para ver os detalhes.
            </div>
          )}

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

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
              Motoristas da cidade
            </h3>
            <div className="space-y-3">
              {drivers.map((driver) => (
                <button
                  key={driver.id}
                  type="button"
                  onClick={() => onSelectDriver(driver.id)}
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
}: {
  drivers: DemoDriver[];
  clients: DemoContact[];
  selectedDriver: DemoDriver | null;
}) {
  const map = useMap();
  const hasFitted = useRef(false);
  const previousSelectedId = useRef<string | null>(null);

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
    if (
      selectedDriver &&
      previousSelectedId.current &&
      previousSelectedId.current !== selectedDriver.id
    ) {
      map.flyTo(
        [selectedDriver.latitude as number, selectedDriver.longitude as number],
        Math.max(map.getZoom(), 13),
        { duration: 0.5 },
      );
    }
    previousSelectedId.current = selectedDriver?.id ?? null;
  }, [map, selectedDriver]);

  return null;
}

function statusLabel(status: DemoDriver["status"]): string {
  const labels: Record<DemoDriver["status"], string> = {
    offline: "Offline",
    available: "Disponível",
    awaiting_loading: "Aguardando carregamento",
    awaiting_documents: "Aguardando documentação",
    in_transit: "Em trânsito",
    awaiting_unloading: "Aguardando descarga",
    in_negotiation: "Negociando",
  };
  return labels[status] ?? status;
}

function formatAvailability(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "agora";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

function formatAvailabilityTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString("pt-BR") : "agora";
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
