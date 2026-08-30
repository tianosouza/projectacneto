import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Shield,
  Briefcase,
  Truck,
  LogOut,
  UserPlus,
  Users,
  MapPin,
  Bell,
  ArrowRight,
  Route,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthScreen } from "@/components/AuthScreen";
import { DriverPortal } from "@/components/DriverPortal";

type AccessLevel = "cliente" | "operador" | "admin";

type DemoContact = {
  id: string;
  name: string;
  email: string;
  region: string;
  accessLevel: AccessLevel;
  status: "ativo" | "pendente";
};

type DemoDriver = {
  id: string;
  full_name: string;
  city: string;
  state: string;
  vehicle_model: string;
  plate: string;
  is_online: boolean;
  rating: number;
  status: "available" | "offline" | "in_negotiation";
  latitude: number;
  longitude: number;
};

const DEFAULT_CLIENTS: DemoContact[] = [
  {
    id: "c1",
    name: "Transportes Vale Verde",
    email: "contato@valeverde.com",
    region: "SP",
    accessLevel: "cliente",
    status: "ativo",
  },
  {
    id: "c2",
    name: "Logística Norte",
    email: "op@lognorte.com",
    region: "MG",
    accessLevel: "cliente",
    status: "pendente",
  },
];

const DEFAULT_OPERATORS: DemoContact[] = [
  {
    id: "o1",
    name: "Marcos Silva",
    email: "marcos@acneto.com",
    region: "SP",
    accessLevel: "operador",
    status: "ativo",
  },
  {
    id: "o2",
    name: "Patrícia Costa",
    email: "patricia@acneto.com",
    region: "MG",
    accessLevel: "operador",
    status: "ativo",
  },
];

const FAKE_DRIVERS: DemoDriver[] = [
  {
    id: "driver-demo-1",
    full_name: "João Ferreira",
    city: "Ribeirão Preto",
    state: "SP",
    vehicle_model: "Mercedes Actros",
    plate: "ABC-1234",
    is_online: true,
    rating: 4.9,
    status: "available",
    latitude: -21.1775,
    longitude: -47.8103,
  },
  {
    id: "driver-demo-2",
    full_name: "Carlos Mendes",
    city: "Campinas",
    state: "SP",
    vehicle_model: "Volvo FH",
    plate: "DEF-5678",
    is_online: true,
    rating: 4.8,
    status: "in_negotiation",
    latitude: -22.9056,
    longitude: -47.0578,
  },
  {
    id: "driver-demo-3",
    full_name: "Pedro Santos",
    city: "Belo Horizonte",
    state: "MG",
    vehicle_model: "Scania R",
    plate: "GHI-9912",
    is_online: false,
    rating: 4.7,
    status: "offline",
    latitude: -19.9167,
    longitude: -43.9345,
  },
];

const loadList = <T,>(key: string, fallback: T[]) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T[];
  } catch {
    return fallback;
  }
};

const saveList = <T,>(key: string, value: T[]) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const getOnlineDrivers = (): DemoDriver[] => {
  if (typeof window === "undefined") return FAKE_DRIVERS;

  const saved = localStorage.getItem("acneto-demo-drivers");
  if (!saved) {
    localStorage.setItem("acneto-demo-drivers", JSON.stringify(FAKE_DRIVERS));
    return FAKE_DRIVERS;
  }

  try {
    const parsed = JSON.parse(saved) as DemoDriver[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallback silencioso para dados fake
  }

  return FAKE_DRIVERS;
};

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
  onSignOut,
}: {
  role: "operator" | "admin";
  title: string;
  subtitle: string;
  onSignOut: () => Promise<void>;
}) {
  const [clients, setClients] = useState<DemoContact[]>(() =>
    loadList("acneto-demo-clients", DEFAULT_CLIENTS),
  );
  const [operators, setOperators] = useState<DemoContact[]>(() =>
    loadList("acneto-demo-operators", DEFAULT_OPERATORS),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState("SP");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(
    role === "admin" ? "operador" : "cliente",
  );
  const [drivers, setDrivers] = useState<DemoDriver[]>(() =>
    getOnlineDrivers(),
  );
  const [driverForm, setDriverForm] = useState({
    full_name: "",
    city: "Ribeirão Preto",
    state: "SP",
    vehicle_model: "",
    plate: "",
  });
  const [tab, setTab] = useState<"resumo" | "cadastros" | "localizacao">(
    "resumo",
  );
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string>("Todas");

  useEffect(() => {
    saveList("acneto-demo-clients", clients);
  }, [clients]);

  useEffect(() => {
    saveList("acneto-demo-operators", operators);
  }, [operators]);

  useEffect(() => {
    saveList("acneto-demo-drivers", drivers);
  }, [drivers]);

  const onlineDrivers = drivers;
  const filteredDrivers = useMemo(() => {
    if (cityFilter === "Todas") {
      return onlineDrivers.filter((driver) => driver.is_online);
    }

    return onlineDrivers.filter(
      (driver) => driver.is_online && driver.city === cityFilter,
    );
  }, [cityFilter, onlineDrivers]);
  const totalClients = clients.length;
  const totalOperators = operators.length;
  const activeDrivers = onlineDrivers.filter(
    (driver) => driver.is_online,
  ).length;

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

  const handleAdd = () => {
    if (!name.trim() || !email.trim()) return;

    const newEntry: DemoContact = {
      id: `${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      region: region.trim() || "SP",
      accessLevel,
      status: "ativo",
    };

    if (accessLevel === "cliente") {
      setClients((prev) => [newEntry, ...prev]);
    } else {
      setOperators((prev) => [newEntry, ...prev]);
    }

    setName("");
    setEmail("");
    setRegion("SP");
    setAccessLevel(role === "admin" ? "operador" : "cliente");
  };

  const handleAddDriver = () => {
    if (!driverForm.full_name.trim() || !driverForm.vehicle_model.trim())
      return;

    const citySeed: Record<string, { latitude: number; longitude: number }> = {
      "Ribeirão Preto": { latitude: -21.1775, longitude: -47.8103 },
      Campinas: { latitude: -22.9056, longitude: -47.0578 },
      "Belo Horizonte": { latitude: -19.9167, longitude: -43.9345 },
      "São Paulo": { latitude: -23.5505, longitude: -46.6333 },
      Curitiba: { latitude: -25.4284, longitude: -49.2733 },
      "Porto Alegre": { latitude: -30.0346, longitude: -51.2177 },
    };

    const coords = citySeed[driverForm.city] ?? {
      latitude: -23.5505,
      longitude: -46.6333,
    };

    const newDriver: DemoDriver = {
      id: `driver-${Date.now()}`,
      full_name: driverForm.full_name.trim(),
      city: driverForm.city,
      state: driverForm.state,
      vehicle_model: driverForm.vehicle_model.trim(),
      plate: driverForm.plate.trim() || "NOVO-0000",
      is_online: true,
      rating: 4.8,
      status: "available",
      latitude: coords.latitude,
      longitude: coords.longitude,
    };

    setDrivers((prev) => [newDriver, ...prev]);
    setDriverForm({
      full_name: "",
      city: "Ribeirão Preto",
      state: "SP",
      vehicle_model: "",
      plate: "",
    });
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
                Acesso demo
              </p>
              <h1 className="text-2xl font-bold text-[#0c1017]">{title}</h1>
            </div>
          </div>

          <button
            onClick={() => onSignOut()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
          >
            <LogOut size={16} /> Sair
          </button>
        </header>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            icon={Users}
            label="Clientes"
            value={String(totalClients)}
          />
          <MetricCard
            icon={Briefcase}
            label="Operadores"
            value={String(totalOperators)}
          />
          <MetricCard
            icon={Truck}
            label="Motoristas online"
            value={String(activeDrivers)}
          />
        </section>

        <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
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
            onClick={() => setTab("localizacao")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === "localizacao"
                ? "bg-white text-[#0b1d3a] shadow-sm"
                : "text-slate-500"
            }`}
          >
            Localização
          </button>
        </div>

        {tab === "resumo" ? (
          <>
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
                    onlineDrivers.map((driver) => (
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
                            {driver.is_online ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{driver.vehicle_model}</span>
                          <span>{driver.plate}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
              <ListPanel title="Clientes" items={clients} />
              <ListPanel
                title={role === "admin" ? "Operadores" : "Acesso do operador"}
                items={operators}
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
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <input
                  value={driverForm.city}
                  onChange={(e) =>
                    setDriverForm((prev) => ({ ...prev, city: e.target.value }))
                  }
                  placeholder="Cidade"
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
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                />
              </div>

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
        ) : (
          <LocationMapView
            drivers={filteredDrivers}
            selectedDriverId={selectedDriverId}
            cityFilter={cityFilter}
            setCityFilter={setCityFilter}
            onSelectDriver={setSelectedDriverId}
          />
        )}
      </div>
    </div>
  );
}

function LocationMapView({
  drivers,
  selectedDriverId,
  cityFilter,
  setCityFilter,
  onSelectDriver,
}: {
  drivers: DemoDriver[];
  selectedDriverId: string | null;
  cityFilter: string;
  setCityFilter: (value: string) => void;
  onSelectDriver: (value: string | null) => void;
}) {
  const cities = [
    "Todas",
    ...Array.from(new Set(drivers.map((driver) => driver.city))),
  ];
  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ??
    drivers[0] ??
    null;

  const getStatusColor = (status: DemoDriver["status"]) => {
    if (status === "available") return "bg-emerald-500";
    if (status === "in_negotiation") return "bg-amber-500";
    return "bg-slate-400";
  };

  const getStatusLabel = (status: DemoDriver["status"]) => {
    if (status === "available") return "Disponível";
    if (status === "in_negotiation") return "Negociando";
    return "Offline";
  };

  const routeTarget = {
    latitude: -23.55,
    longitude: -46.63,
  };

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
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_0.8fr]">
        <div className="relative h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-100 via-slate-100 to-emerald-100">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.35) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-300/60" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300/60" />

          {selectedDriver && (
            <svg className="absolute inset-0 h-full w-full">
              <line
                x1={`${((selectedDriver.longitude + 49) / 12) * 100}%`}
                y1={`${((24 + selectedDriver.latitude) / 12) * 100}%`}
                x2={`${((routeTarget.longitude + 49) / 12) * 100}%`}
                y2={`${((24 + routeTarget.latitude) / 12) * 100}%`}
                stroke="#1052c7"
                strokeDasharray="7 7"
                strokeWidth="2"
              />
            </svg>
          )}

          {drivers.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
              Nenhum motorista online para exibir no mapa.
            </div>
          ) : (
            drivers.map((driver) => {
              const left = Math.min(
                90,
                Math.max(8, ((driver.longitude + 49) / 12) * 100),
              );
              const top = Math.min(
                90,
                Math.max(8, ((24 + driver.latitude) / 12) * 100),
              );
              const isSelected = selectedDriver?.id === driver.id;

              return (
                <button
                  key={driver.id}
                  type="button"
                  onClick={() => onSelectDriver(driver.id)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 outline-none"
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <div className="relative flex flex-col items-center">
                    <MapPin
                      className={`${isSelected ? "text-blue-600" : "text-rose-500"} drop-shadow`}
                      size={isSelected ? 28 : 24}
                    />
                    <div className="mt-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-700 shadow-sm">
                      {driver.full_name.split(" ")[0]}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          {selectedDriver ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Motorista selecionado
                  </p>
                  <h3 className="mt-1 text-xl font-bold text-[#0b1d3a]">
                    {selectedDriver.full_name}
                  </h3>
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

              <div className="mt-4 space-y-3 text-sm text-slate-600">
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

              <button
                type="button"
                onClick={() => onSelectDriver(selectedDriver.id)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0a3a90]"
              >
                <Route size={16} /> Ver rota
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Selecione um motorista para ver os detalhes.
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

function ListPanel({ title, items }: { title: string; items: DemoContact[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0b1d3a]">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {items.length}
        </span>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
          >
            <div>
              <p className="font-semibold text-[#0b1d3a]">{item.name}</p>
              <p className="text-xs text-slate-500">
                {item.email} · {item.region}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {item.accessLevel}
              </p>
              <span
                className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${item.status === "ativo" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
              >
                {item.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0b1d3a]">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1052c7]">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

export default App;
