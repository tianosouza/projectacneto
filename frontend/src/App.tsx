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
import { AuthScreen } from "@/components/AuthScreen";
import { DriverPortal } from "@/components/DriverPortal";
import { AccountCenter } from "@/components/AccountCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DirectoryPanel, MetricCard } from "@/components/DashboardPrimitives";
import { DirectorySearch as ReusableDirectorySearch } from "@/components/DirectorySearch";
import { RegistrationRequestsPanel as ReusableRegistrationRequestsPanel } from "@/components/RegistrationRequestsPanel";
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

  return <DriverPortal />;
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
  const [region, setRegion] = useState("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(
    role === "admin" ? "operador" : "cliente",
  );
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
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [registrationRequests, setRegistrationRequests] = useState<
    PendingUser[]
  >([]);
  const [approvalRoles, setApprovalRoles] = useState<
    Record<string, "driver" | "operator" | "admin">
  >({});
  const [approvalDriverFields, setApprovalDriverFields] = useState<
    Record<string, ApprovalDriverFields>
  >({});
  const [directory, setDirectory] = useState<
    "clients" | "operators" | "drivers"
  >("clients");
  const [searchTerm, setSearchTerm] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [driverFormError, setDriverFormError] = useState("");

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
            }>,
        )
        .then(
          ({
            drivers: apiDrivers,
            all_drivers: apiAllDrivers,
            operators: apiOperators,
          }) => {
            setDrivers(apiDrivers);
            setDirectoryDrivers(apiAllDrivers);
            setDirectoryOperators(apiOperators);
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
              }>,
          )
          .then(
            ({
              drivers: apiDrivers,
              all_drivers: apiAllDrivers,
              operators: apiOperators,
            }) => {
              setDrivers(apiDrivers);
              setDirectoryDrivers(apiAllDrivers);
              setDirectoryOperators(apiOperators);
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
              if (!next[pendingUser.id]) {
                next[pendingUser.id] = {
                  full_name: pendingUser.full_name ?? "",
                  phone: pendingUser.phone ?? "",
                  vehicle_model: "",
                  plate: "",
                  city: "",
                  state: "",
                  capacity: "",
                  compartments: "",
                };
              }
            });
            return next;
          });
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
    if (
      role === "driver" &&
      (!fields || Object.values(fields).some((value) => !value.trim()))
    ) {
      window.alert(
        "Preencha todos os campos obrigatórios do motorista antes de aprovar.",
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
      window.alert(body.error ?? "Não foi possível finalizar a aprovação.");
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

  const onlineDrivers = drivers.filter(isDriverCurrentlyOnline);
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
    if (
      !selectedDriver ||
      selectedDriver.latitude == null ||
      selectedDriver.longitude == null ||
      selectedClients.length === 0
    ) {
      setRouteError("Selecione um motorista com GPS e pelo menos um cliente.");
      return;
    }

    setRouteLoading(true);
    setRouteError("");
    try {
      const waypoints = [
        [selectedDriver.longitude, selectedDriver.latitude],
        ...selectedClients.map((client) => [
          client.longitude as number,
          client.latitude as number,
        ]),
      ];
      const response = await apiFetch(
        `https://router.project-osrm.org/route/v1/driving/${waypoints
          .map(([longitude, latitude]) => `${longitude},${latitude}`)
          .join(";")}?overview=full&geometries=geojson&steps=false`,
      );
      if (!response.ok) throw new Error("Rota indisponível");
      const body = (await response.json()) as {
        code: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: number[][] };
        }>;
      };
      const route = body.routes?.[0];
      if (body.code !== "Ok" || !route) throw new Error("Rota indisponível");
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
      setSelectedDriverId(null);
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

    setSelectedClientIds([]);
    setRoutePath([]);
    setRouteSummary(null);
    setRouteError("");
  }, [filteredDrivers, selectedDriverId]);

  const handleAdd = () => {
    if (!name.trim() || !email.trim()) return;

    const newEntry: DemoContact = {
      id: `${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      region: region.trim(),
      accessLevel,
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
    } else if (accessLevel === "cliente") {
      setClients((prev) => [newEntry, ...prev]);
    } else {
      setOperators((prev) => [newEntry, ...prev]);
    }

    setName("");
    setEmail("");
    setRegion("");
    setAccessLevel(role === "admin" ? "operador" : "cliente");
  };

  const editContact = (contact: DemoContact) => {
    setEditingContactId(contact.id);
    setName(contact.name);
    setEmail(contact.email);
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
      driverForm.vehicle_model,
      driverForm.city,
      driverForm.state,
      driverForm.plate,
      driverForm.phone,
      driverForm.capacity,
      driverForm.compartments,
    ];
    if (requiredDriverFields.some((field) => !field.trim())) {
      setDriverFormError("Preencha todos os campos obrigatórios do motorista.");
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
            <button
              onClick={() => onSignOut()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
            >
              <LogOut size={16} /> Sair
            </button>
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
          <MetricCard
            icon={Briefcase}
            label="Operadores"
            value={String(totalOperators)}
            active={directory === "operators"}
            onClick={() => setDirectory("operators")}
          />
          <MetricCard
            icon={Truck}
            label="Motoristas online"
            value={String(activeDrivers)}
            active={directory === "drivers"}
            onClick={() => setDirectory("drivers")}
          />
        </section>

        <div
          className={`mb-6 grid gap-1 rounded-xl bg-slate-100 p-1 ${role === "admin" ? "grid-cols-5" : "grid-cols-4"}`}
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
          <button
            onClick={() => setTab("cadastros")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === "cadastros"
                ? "bg-white text-[#0b1d3a] shadow-sm"
                : "text-slate-500"
            }`}
          >
            Cadastros
          </button>
          <button
            onClick={() => {
              setLocationSearch("");
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
          {role === "admin" && (
            <button
              onClick={() => setTab("solicitacoes")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                tab === "solicitacoes"
                  ? "bg-white text-[#0b1d3a] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <span>Solicitações</span>
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
              matchedOperators={locationOperators}
              onEditDriver={editDriver}
            />
            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <UserPlus size={18} className="text-[#1052c7]" />
                  <h2 className="text-lg font-bold text-[#0b1d3a]">
                    {role === "admin"
                      ? "Cadastrar operador ou cliente"
                      : "Cadastrar cliente"}
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
                  <select
                    value={accessLevel}
                    onChange={(e) =>
                      setAccessLevel(e.target.value as AccessLevel)
                    }
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {role === "admin" ? (
                      <>
                        <option value="operador">Operador</option>
                        <option value="cliente">Cliente</option>
                      </>
                    ) : (
                      <option value="cliente">Cliente</option>
                    )}
                  </select>
                </div>

                <button
                  onClick={handleAdd}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0a3a90]"
                >
                  Salvar cadastro <ArrowRight size={15} />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <Bell size={18} className="text-emerald-600" />
                  <h2 className="text-lg font-bold text-[#0b1d3a]">
                    Motoristas visíveis
                  </h2>
                </div>

                <div className="space-y-3">
                  {onlineDrivers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      Nenhum motorista online no momento.
                    </div>
                  ) : (
                    onlineDrivers
                      .filter((driver) => driver.is_online)
                      .map((driver) => (
                        <div
                          key={driver.id}
                          className="rounded-xl border border-slate-200 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-[#0b1d3a]">
                                {driver.full_name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {driver.city} · {driver.state}
                              </p>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${driver.is_online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${driver.is_online ? "bg-emerald-500" : "bg-slate-400"}`}
                              />
                              {statusLabel(driver.status)}
                            </span>
                          </div>
                          <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-2">
                            {role === "admin" && (
                              <div
                                className="mr-auto flex items-center gap-0.5"
                                aria-label={`Avaliação: ${driver.rating} de 5 estrelas`}
                              >
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    onClick={() =>
                                      void rateDriver(driver, star)
                                    }
                                    className="rounded p-1 text-amber-400 transition hover:bg-amber-50"
                                    aria-label={`Dar ${star} estrela${star > 1 ? "s" : ""}`}
                                    title={`Avaliar com ${star} estrela${star > 1 ? "s" : ""}`}
                                  >
                                    <Star
                                      size={15}
                                      fill={
                                        star <= Math.round(driver.rating)
                                          ? "currentColor"
                                          : "none"
                                      }
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => editDriver(driver)}
                              className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700"
                              aria-label={`Editar ${driver.full_name}`}
                              title="Editar motorista"
                            >
                              <Pencil size={15} />
                            </button>
                            {role === "admin" && (
                              <button
                                type="button"
                                onClick={() => void removeDriver(driver)}
                                className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                                aria-label={`Excluir ${driver.full_name}`}
                                title="Excluir motorista"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                            <span>
                              {driver.vehicle_model} · {driver.plate}
                            </span>
                            <span>
                              {driver.capacity} · {driver.compartments}
                            </span>
                            {whatsappHref(driver.phone) ? (
                              <a
                                href={whatsappHref(driver.phone) ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:text-emerald-700"
                                title="Abrir conversa no WhatsApp Web"
                              >
                                <Phone size={13} /> {driver.phone}
                              </a>
                            ) : (
                              <span>Telefone não informado</span>
                            )}
                            <span className="text-right">
                              Desde{" "}
                              {formatAvailability(driver.availability_since)}
                            </span>
                          </div>
                          {driver.notes && (
                            <p className="mt-2 text-xs text-slate-500">
                              {driver.notes}
                            </p>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </section>

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
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                    setDriverForm((prev) => ({ ...prev, city: e.target.value }))
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

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <UserPlus size={18} className="text-[#1052c7]" />
                <h2 className="text-lg font-bold text-[#0b1d3a]">
                  {role === "admin"
                    ? "Cadastrar operador ou administrador"
                    : "Cadastrar acessos do operador"}
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
                <select
                  value={accessLevel}
                  onChange={(e) =>
                    setAccessLevel(e.target.value as AccessLevel)
                  }
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  {role === "admin" ? (
                    <>
                      <option value="admin">Administrador</option>
                      <option value="operador">Operador</option>
                      <option value="cliente">Cliente</option>
                    </>
                  ) : (
                    <>
                      <option value="cliente">Cliente</option>
                      <option value="operador">Operador</option>
                    </>
                  )}
                </select>
              </div>

              <button
                onClick={handleAdd}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0a3a90]"
              >
                Salvar acesso <ArrowRight size={15} />
              </button>
            </div>
          </div>
        ) : tab === "localizacao" ? (
          <LocationMapView
            drivers={filteredDrivers}
            clients={clients}
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
          <ReusableRegistrationRequestsPanel
            requests={registrationRequests}
            approvalRoles={approvalRoles}
            approvalDriverFields={approvalDriverFields}
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
            onClose={(userId) => void setApprovalClosed(userId, true)}
            onReopen={(userId) => void setApprovalClosed(userId, false)}
          />
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
  approvalRoles: Record<string, "driver" | "operator" | "admin">;
  approvalDriverFields: Record<string, ApprovalDriverFields>;
  onRoleChange: (
    userId: string,
    value: "driver" | "operator" | "admin",
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

function clientMarkerIcon() {
  return divIcon({
    className: "client-map-marker",
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -38],
    html: renderToStaticMarkup(
      <div
        style={{
          alignItems: "center",
          background: "#d97706",
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
          <UsersRound size={20} strokeWidth={2.4} />
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

function LocationMapView({
  drivers,
  clients,
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
  const locatedClients = clients.filter(
    (client) =>
      Number.isFinite(client.latitude) && Number.isFinite(client.longitude),
  );
  const mapPoints: LatLngTuple[] = [
    ...locatedDrivers.map(
      (driver) =>
        [driver.latitude as number, driver.longitude as number] as LatLngTuple,
    ),
    ...locatedClients.map(
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
        <div className="flex items-center gap-2">
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
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="Todos">Todos os status</option>
            <option value="available">Disponível</option>
            <option value="awaiting_loading">Aguardando carregamento</option>
            <option value="awaiting_documents">Aguardando documentação</option>
            <option value="in_transit">Em trânsito</option>
            <option value="awaiting_unloading">Aguardando descarga</option>
          </select>
        </div>
      </div>

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
              drivers={locatedDrivers}
              clients={locatedClients}
              selectedDriver={selectedDriver}
            />
            {locatedDrivers.map((driver) => {
              const isSelected = selectedDriver?.id === driver.id;
              return (
                <Marker
                  key={driver.id}
                  position={driverMarkerPosition(driver, locatedDrivers)}
                  icon={truckMarkerIcon(isSelected)}
                  eventHandlers={{ click: () => onSelectDriver(driver.id) }}
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
            {locatedClients.map((client) => (
              <Marker
                key={client.id}
                position={[
                  client.latitude as number,
                  client.longitude as number,
                ]}
                icon={clientMarkerIcon()}
                eventHandlers={{ click: () => onToggleClient(client.id) }}
              >
                <Popup>
                  <strong>{client.name}</strong>
                  <br />
                  Cliente · {client.region}
                  <br />
                  {client.email}
                  <br />
                  {selectedClientIds.includes(client.id)
                    ? "Destino selecionado"
                    : "Clique para selecionar como destino"}
                </Popup>
              </Marker>
            ))}
            {routePath.length > 1 && (
              <Polyline
                positions={routePath}
                pathOptions={{ color: "#f97316", weight: 5, opacity: 0.85 }}
              />
            )}
          </MapContainer>
          {locatedDrivers.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-5 z-[1000] -translate-x-1/2 rounded-2xl border border-amber-200 bg-white/95 px-4 py-3 text-center shadow-lg backdrop-blur">
              <p className="text-sm font-bold text-amber-800">
                Nenhum motorista online
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                O mapa continuará disponível para visualizar os clientes.
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-orange-950">
                  Rota para clientes
                </h3>
                <p className="mt-1 text-xs text-orange-800">
                  Clique nos clientes do mapa para selecionar destinos.
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-orange-800">
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
              disabled={routeLoading || selectedClientIds.length === 0}
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
