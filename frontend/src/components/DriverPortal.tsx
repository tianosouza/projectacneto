import { useEffect, useRef, useState } from "react";
import {
  Truck,
  MapPin,
  Navigation,
  Star,
  TrendingUp,
  Clock,
  Zap,
  LogOut,
  User,
  Phone,
  Mail,
  Calendar,
  Settings,
  ChevronRight,
  Power,
  CheckCircle2,
  Loader2,
  Edit3,
  Save,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Driver } from "@/lib/types";
import { AccountCenter } from "@/components/AccountCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch } from "@/lib/api";

type Tab = "home" | "profile" | "history" | "settings";
const accessToken = () => localStorage.getItem("acneto-access-token");
const apiHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${accessToken() ?? ""}`,
});

type ReverseGeocodeAddress = {
  city?: string;
  town?: string;
  municipality?: string;
  village?: string;
  state_code?: string;
  "ISO3166-2-lvl4"?: string;
};

const reverseGeocode = async (latitude: number, longitude: number) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: latitude.toString(),
    lon: longitude.toString(),
    zoom: "10",
    addressdetails: "1",
  });
  const response = await apiFetch(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { address?: ReverseGeocodeAddress };
  const address = body.address;
  if (!address) return null;

  const stateCode =
    address.state_code?.replace(/^br-/i, "").toUpperCase() ||
    address["ISO3166-2-lvl4"]?.split("-").pop()?.toUpperCase() ||
    null;
  return {
    city:
      address.city ??
      address.town ??
      address.municipality ??
      address.village ??
      null,
    state: stateCode,
  };
};

export function DriverPortal() {
  const { user, profile, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("home");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "tracking" | "denied" | "unavailable"
  >("idle");
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const lastReverseGeocode = useRef({ key: "", timestamp: 0 });
  const driverId = driver?.id;
  const locationPermissionKey = driverId
    ? `acneto-location-permission:${driverId}`
    : null;

  useEffect(() => {
    const token = accessToken();
    if (token) {
      let active = true;
      apiFetch("/api/drivers/me", { headers: apiHeaders() })
        .then(async (response) => {
          if (!response.ok) throw new Error("Motorista não encontrado");
          return response.json() as Promise<{ driver: Driver }>;
        })
        .then(({ driver: apiDriver }) => {
          if (active) {
            setDriver(apiDriver);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    const saved = localStorage.getItem("acneto-driver");
    if (!saved) {
      setDriver(null);
      setLoading(false);
      return;
    }

    try {
      setDriver(JSON.parse(saved) as Driver);
    } catch {
      setDriver(null);
    }
    setLoading(false);
  }, [profile?.user_id, profile?.full_name]);

  useEffect(() => {
    if (!driverId || !navigator.geolocation) return;
    let active = true;

    const checkLocationPermission = async () => {
      if (
        locationPermissionKey &&
        localStorage.getItem(locationPermissionKey) === "granted"
      ) {
        setLocationPromptOpen(false);
        return;
      }

      try {
        const permission = await navigator.permissions.query({
          name: "geolocation",
        });
        if (!active) return;
        if (permission.state === "granted") {
          localStorage.setItem(locationPermissionKey ?? "", "granted");
          setLocationPromptOpen(false);
          return;
        }
        if (permission.state === "prompt") setLocationPromptOpen(true);
        if (permission.state === "denied") setLocationStatus("denied");
      } catch {
        // Browsers sem Permissions API continuam usando o aviso normalmente.
        if (active) setLocationPromptOpen(true);
      }
    };

    void checkLocationPermission();
    return () => {
      active = false;
    };
  }, [driverId, locationPermissionKey]);

  const requestLocationAccess = () => {
    // Fecha o aviso próprio antes do prompt nativo do navegador abrir.
    setLocationPromptOpen(false);

    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        if (locationPermissionKey) {
          localStorage.setItem(locationPermissionKey, "granted");
        }
        setLocationStatus("idle");
      },
      (error) => {
        setLocationStatus(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  };

  useEffect(() => {
    if (!driver?.is_online) {
      setLocationStatus("idle");
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }

    let active = true;
    const locationOptions = {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 20_000,
    };
    const handleLocationError = (error: GeolocationPositionError) => {
      if (!active) return;
      setLocationStatus(
        error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
      );
    };
    const syncPosition = (position: GeolocationPosition) => {
      if (!active) return;
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        last_seen: new Date().toISOString(),
      };

      setDriver((current) => {
        if (!current) return current;
        const updated = { ...current, ...location };
        if (accessToken()) {
          void apiFetch("/api/drivers/me/location", {
            method: "PATCH",
            headers: apiHeaders(),
            body: JSON.stringify(location),
          });
        } else {
          localStorage.setItem("acneto-driver", JSON.stringify(updated));
          syncOperatorDriver(updated);
          window.dispatchEvent(new Event("acneto-driver-location"));
        }
        return updated;
      });
      const geocodeKey = `${position.coords.latitude.toFixed(3)},${position.coords.longitude.toFixed(3)}`;
      const now = Date.now();
      if (
        lastReverseGeocode.current.key !== geocodeKey ||
        now - lastReverseGeocode.current.timestamp > 60_000
      ) {
        lastReverseGeocode.current = { key: geocodeKey, timestamp: now };
        void reverseGeocode(position.coords.latitude, position.coords.longitude)
          .then((address) => {
            if (!address || !active) return;
            setDriver((current) => {
              if (!current) return current;
              const updated = {
                ...current,
                city: address.city ?? current.city,
                state: address.state ?? current.state,
              };
              if (!accessToken()) {
                localStorage.setItem("acneto-driver", JSON.stringify(updated));
                syncOperatorDriver(updated);
              }
              return updated;
            });
            if (accessToken()) {
              void apiFetch("/api/drivers/me", {
                method: "PATCH",
                headers: apiHeaders(),
                body: JSON.stringify(address),
              });
            }
          })
          .catch(() => undefined);
      }
      setLocationStatus("tracking");
    };
    const requestCurrentPosition = () => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        syncPosition,
        handleLocationError,
        locationOptions,
      );
    };
    const watchId = navigator.geolocation.watchPosition(
      syncPosition,
      handleLocationError,
      locationOptions,
    );
    const refreshTimer = window.setInterval(requestCurrentPosition, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") requestCurrentPosition();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [driver?.is_online]);

  const toggleOnline = async () => {
    if (!driver || toggling) return;
    setToggling(true);
    const newOnline = !driver.is_online;
    const newStatus = newOnline ? "available" : "offline";

    const updated = {
      ...driver,
      is_online: newOnline,
      status: newStatus,
      last_seen: new Date().toISOString(),
      availability_since: newOnline
        ? new Date().toISOString()
        : driver.availability_since,
    } as Driver;

    if (accessToken()) {
      await apiFetch("/api/drivers/me/status", {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({ isOnline: newOnline, status: newStatus }),
      });
    } else {
      localStorage.setItem("acneto-driver", JSON.stringify(updated));
      syncOperatorDriver(updated);
      window.dispatchEvent(new Event("acneto-driver-location"));
    }
    setDriver(updated);
    setToggling(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa]">
        <Loader2 className="animate-spin text-[#1052c7]" size={32} />
      </div>
    );
  }

  if (!driver) {
    return <OnboardingView fullName={profile?.full_name ?? "Motorista"} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f7fa]">
      <TopBar driver={driver} onSignOut={signOut} />

      {locationPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <MapPin size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0b1d3a]">
                  Para permitir acesso a sua localização
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Autorize a localização para que os operadores encontrem você
                  no mapa quando estiver online.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setLocationPromptOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={requestLocationAccess}
                className="flex-1 rounded-xl bg-[#1052c7] px-4 py-3 text-sm font-semibold text-white"
              >
                Permitir localização
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-28 sm:px-6 lg:pb-10">
        {tab === "home" && (
          <HomeView
            driver={driver}
            locationStatus={locationStatus}
            onToggle={toggleOnline}
            onUpdate={(updates) => {
              const updated = { ...driver, ...updates };
              if (accessToken()) {
                void apiFetch("/api/drivers/me/status", {
                  method: "PATCH",
                  headers: apiHeaders(),
                  body: JSON.stringify({
                    isOnline: updated.is_online,
                    status: updated.status,
                    notes: updated.notes,
                  }),
                });
              } else {
                localStorage.setItem("acneto-driver", JSON.stringify(updated));
                syncOperatorDriver(updated);
                window.dispatchEvent(new Event("acneto-driver-location"));
              }
              setDriver(updated);
            }}
            toggling={toggling}
          />
        )}
        {tab === "profile" && (
          <AccountCenter
            user={{
              email: user?.email ?? driver.email ?? "",
              full_name: user?.user_metadata.full_name ?? driver.full_name,
              phone: driver.phone,
            }}
            profile={profile}
            driver={driver}
          />
        )}
        {tab === "history" && <HistoryView />}
        {tab === "settings" && <SettingsView onSignOut={signOut} />}
      </main>

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

function syncOperatorDriver(driver: Driver) {
  const saved = localStorage.getItem("acneto-drivers");
  if (!saved) return;

  try {
    const drivers = JSON.parse(saved) as Array<Record<string, unknown>>;
    const updatedDrivers = drivers.map((item) => {
      if (item.plate !== driver.plate && item.full_name !== driver.full_name) {
        return item;
      }

      return {
        ...item,
        full_name: driver.full_name,
        city: driver.city ?? "",
        state: driver.state ?? "",
        vehicle_model: driver.vehicle_model ?? "",
        plate: driver.plate ?? "",
        phone: driver.phone ?? "Não informado",
        capacity: driver.capacity ?? "Não informado",
        compartments: driver.compartments ?? "Não informado",
        notes: driver.notes ?? "",
        is_online: driver.is_online,
        status: driver.status,
        availability_since:
          driver.availability_since ?? new Date().toISOString(),
        latitude: driver.latitude,
        longitude: driver.longitude,
        last_seen: driver.last_seen ?? new Date().toISOString(),
      };
    });

    localStorage.setItem("acneto-drivers", JSON.stringify(updatedDrivers));
    window.dispatchEvent(new Event("acneto-driver-location"));
  } catch {
    return;
  }
}

function TopBar({
  driver,
  onSignOut,
}: {
  driver: Driver;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <img
            src="/assets/image.png"
            alt="A C Neto Transportes"
            className="h-9 w-24 rounded-md object-contain"
          />
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              driver.is_online
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${driver.is_online ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`}
            />
            {driver.is_online ? "Online" : "Offline"}
          </div>
          <button
            onClick={onSignOut}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
            aria-label="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function HomeView({
  driver,
  locationStatus,
  onToggle,
  onUpdate,
  toggling,
}: {
  driver: Driver;
  locationStatus: "idle" | "tracking" | "denied" | "unavailable";
  onToggle: () => void;
  onUpdate: (updates: Partial<Driver>) => void;
  toggling: boolean;
}) {
  const operationalStatuses: { value: Driver["status"]; label: string }[] = [
    { value: "available", label: "Disponível" },
    { value: "awaiting_loading", label: "Aguardando carregamento" },
    { value: "awaiting_documents", label: "Aguardando documentação" },
    { value: "in_transit", label: "Em trânsito" },
    { value: "awaiting_unloading", label: "Aguardando descarga" },
  ];

  return (
    <div className="space-y-6">
      {/* Status hero */}
      <div
        className={`overflow-hidden rounded-2xl p-6 text-white shadow-lg transition ${
          driver.is_online
            ? "bg-gradient-to-br from-emerald-600 to-emerald-700"
            : "bg-gradient-to-br from-[#1052c7] to-[#0b3f9f]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white/80">Olá,</p>
            <h1 className="mt-0.5 text-2xl font-bold">
              {driver.full_name.split(" ")[0]}
            </h1>
            <p className="mt-2 text-sm text-white/70">
              {driver.is_online
                ? "Você está visível para os operadores."
                : "Fique online para receber propostas de frete."}
            </p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Truck size={26} />
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={toggling}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl bg-white py-3.5 text-sm font-bold text-[#0b1d3a] shadow-md transition hover:bg-white/90 disabled:opacity-70"
        >
          {toggling ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Power size={18} />
          )}
          {driver.is_online ? "Ficar Offline" : "Ficar Online"}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-[#0b1d3a]">Status operacional</h2>
            <p className="mt-1 text-xs text-slate-500">
              Atualize sua situação para orientar a equipe comercial.
            </p>
          </div>
          <Clock size={18} className="text-[#1052c7]" />
        </div>
        <select
          value={driver.is_online ? driver.status : "offline"}
          disabled={!driver.is_online}
          onChange={(event) =>
            onUpdate({
              status: event.target.value as Driver["status"],
              last_seen: new Date().toISOString(),
            })
          }
          className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
        >
          {!driver.is_online && <option value="offline">Offline</option>}
          {operationalStatuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-xs font-semibold text-slate-500">
          Observações para o comercial
          <textarea
            value={driver.notes ?? ""}
            onChange={(event) => onUpdate({ notes: event.target.value })}
            placeholder="Manutenção, documentos ou previsão de liberação"
            rows={3}
            className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat
          icon={Star}
          label="Avaliação"
          value={Number(driver.rating).toFixed(1)}
          tone="amber"
        />
        <MiniStat
          icon={TrendingUp}
          label="Viagens"
          value={String(driver.total_trips)}
          tone="blue"
        />
        <MiniStat
          icon={Clock}
          label="Status"
          value={statusLabel(driver.status)}
          tone="navy"
        />
        <MiniStat
          icon={MapPin}
          label="Cidade"
          value={driver.city ?? "—"}
          tone="green"
        />
      </div>

      {/* Location card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-[#0b1d3a]">Sua localização</h2>
            <p className="mt-1 text-xs text-slate-500">
              Atualizada a cada 30 segundos enquanto o app estiver ativo e ao
              retornar para esta tela
            </p>
          </div>
          <Navigation size={18} className="text-[#1052c7]" />
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <MapPin size={18} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">
              {driver.city
                ? `${driver.city}${driver.state ? " · " + driver.state : ""}`
                : locationStatus === "tracking"
                  ? "Identificando localização atual..."
                  : "Localização não definida"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {driver.latitude != null && driver.longitude != null
                ? `${driver.is_online ? "GPS atual" : "Última posição"}: ${Number(driver.latitude).toFixed(4)}, ${Number(driver.longitude).toFixed(4)}`
                : "Nenhuma posição GPS recebida ainda"}
            </p>
            <p
              className={`mt-2 text-xs font-semibold ${
                locationStatus === "tracking"
                  ? "text-emerald-600"
                  : locationStatus === "denied"
                    ? "text-rose-600"
                    : "text-amber-600"
              }`}
            >
              {locationStatus === "tracking"
                ? "Localização compartilhada com o operador"
                : locationStatus === "denied"
                  ? "Permissão de localização negada"
                  : locationStatus === "unavailable"
                    ? "Localização indisponível neste dispositivo"
                    : "Aguardando localização"}
            </p>
            {driver.last_seen && (
              <p className="mt-1 text-[11px] text-slate-400">
                Atualizado às{" "}
                {new Date(driver.last_seen).toLocaleTimeString("pt-BR")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Vehicle card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-[#0b1d3a]">Seu veículo</h2>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Truck size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {driver.vehicle_model ?? "Veículo não cadastrado"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {driver.vehicle_year ? `${driver.vehicle_year} · ` : ""}
              {driver.plate ?? "Sem placa"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Star;
  label: string;
  value: string;
  tone: "amber" | "blue" | "navy" | "green";
}) {
  const colors = {
    amber: "bg-amber-50 text-amber-600",
    blue: "bg-blue-50 text-blue-600",
    navy: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[tone]}`}
      >
        <Icon size={17} />
      </div>
      <p className="mt-3 text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-[#0b1d3a]">{value}</p>
    </div>
  );
}

export function ProfileView({ driver }: { driver: Driver }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: driver.full_name,
    cpf: driver.cpf ?? "",
    phone: driver.phone ?? "",
    email: driver.email ?? "",
    vehicle_model: driver.vehicle_model ?? "",
    vehicle_year: driver.vehicle_year?.toString() ?? "",
    plate: driver.plate ?? "",
    cnh: driver.cnh ?? "",
    city: driver.city ?? "",
    state: driver.state ?? "",
  });

  const save = async () => {
    setSaving(true);

    const updatedDriver: Driver = {
      ...driver,
      full_name: form.full_name,
      cpf: form.cpf || null,
      phone: form.phone || null,
      email: form.email || null,
      vehicle_model: form.vehicle_model || null,
      vehicle_year: form.vehicle_year ? parseInt(form.vehicle_year) : null,
      plate: form.plate || null,
      cnh: form.cnh || null,
      city: form.city || null,
      state: form.state || null,
    };

    if (accessToken()) {
      await apiFetch("/api/drivers/me", {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({
          fullName: updatedDriver.full_name,
          cpf: updatedDriver.cpf,
          phone: updatedDriver.phone,
          email: updatedDriver.email,
          vehicleModel: updatedDriver.vehicle_model,
          vehicleYear: updatedDriver.vehicle_year,
          plate: updatedDriver.plate,
          cnh: updatedDriver.cnh,
          city: updatedDriver.city,
          state: updatedDriver.state,
        }),
      });
    } else {
      localStorage.setItem("acneto-driver", JSON.stringify(updatedDriver));
    }
    setEditing(false);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0b1d3a]">Meu perfil</h1>
          <p className="mt-1 text-sm text-slate-500">
            Mantenha seus dados sempre atualizados.
          </p>
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Edit3 size={15} /> Editar
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <X size={15} /> Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#1052c7] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b3f9f] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="animate-spin" size={15} />
              ) : (
                <Save size={15} />
              )}{" "}
              Salvar
            </button>
          </div>
        )}
      </div>

      {/* Avatar header */}
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1052c7] text-xl font-bold text-white">
          {driver.full_name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-lg font-bold text-[#0b1d3a]">{driver.full_name}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {driver.email ?? "Sem e-mail"}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <Star size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-slate-600">
              {Number(driver.rating).toFixed(1)}
            </span>
            <span className="text-xs text-slate-400">
              · {driver.total_trips} viagens
            </span>
          </div>
        </div>
      </div>

      {/* Personal data */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0b1d3a]">Dados pessoais</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField
            icon={User}
            label="Nome completo"
            value={form.full_name}
            editing={editing}
            onChange={(v) => setForm({ ...form, full_name: v })}
          />
          <ProfileField
            icon={User}
            label="CPF"
            value={form.cpf}
            editing={editing}
            onChange={(v) => setForm({ ...form, cpf: v })}
          />
          <ProfileField
            icon={Phone}
            label="Telefone"
            value={form.phone}
            editing={editing}
            onChange={(v) => setForm({ ...form, phone: v })}
          />
          <ProfileField
            icon={Mail}
            label="E-mail"
            value={form.email}
            editing={editing}
            onChange={(v) => setForm({ ...form, email: v })}
          />
          <ProfileField
            icon={Calendar}
            label="CNH"
            value={form.cnh}
            editing={editing}
            onChange={(v) => setForm({ ...form, cnh: v })}
          />
        </div>
      </div>

      {/* Vehicle data */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0b1d3a]">Veículo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField
            icon={Truck}
            label="Modelo"
            value={form.vehicle_model}
            editing={editing}
            onChange={(v) => setForm({ ...form, vehicle_model: v })}
          />
          <ProfileField
            icon={Calendar}
            label="Ano"
            value={form.vehicle_year}
            editing={editing}
            onChange={(v) => setForm({ ...form, vehicle_year: v })}
          />
          <ProfileField
            icon={Truck}
            label="Placa"
            value={form.plate}
            editing={editing}
            onChange={(v) => setForm({ ...form, plate: v })}
          />
        </div>
      </div>

      {/* Location */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-bold text-[#0b1d3a]">Localização</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField
            icon={MapPin}
            label="Cidade"
            value={form.city}
            editing={editing}
            onChange={(v) => setForm({ ...form, city: v })}
          />
          <ProfileField
            icon={MapPin}
            label="Estado (UF)"
            value={form.state}
            editing={editing}
            onChange={(v) => setForm({ ...form, state: v })}
          />
        </div>
      </div>
    </div>
  );
}

export function ProfileField({
  icon: Icon,
  label,
  value,
  editing,
  onChange,
}: {
  icon: typeof User;
  label: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      {editing ? (
        <div className="relative mt-1.5">
          <Icon
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={16}
          />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5">
          <Icon className="text-slate-400" size={16} />
          <span className="text-sm font-medium text-slate-800">
            {value || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

function HistoryView() {
  const trips = [
    {
      route: "Ribeirão Preto → São Paulo",
      date: "28/08/2026",
      value: "R$ 4.200",
      status: "Concluída",
    },
    {
      route: "Campinas → Belo Horizonte",
      date: "24/08/2026",
      value: "R$ 3.800",
      status: "Concluída",
    },
    {
      route: "Uberlândia → Goiânia",
      date: "20/08/2026",
      value: "R$ 2.900",
      status: "Concluída",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0b1d3a]">
          Histórico de viagens
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Suas últimas viagens realizadas.
        </p>
      </div>
      <div className="space-y-3">
        {trips.map((trip, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Truck size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {trip.route}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{trip.date}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-[#0b1d3a]">{trip.value}</p>
                <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                  <CheckCircle2 size={12} /> {trip.status}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView({ onSignOut }: { onSignOut: () => void }) {
  const items = [
    { icon: Settings, label: "Preferências da conta" },
    { icon: Phone, label: "Notificações por WhatsApp" },
    { icon: Mail, label: "Notificações por e-mail" },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0b1d3a]">Configurações</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gerencie suas preferências.
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {items.map((item, i) => (
          <button
            key={item.label}
            className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50 ${
              i < items.length - 1 ? "border-b border-slate-100" : ""
            }`}
          >
            <item.icon size={18} className="text-slate-500" />
            <span className="flex-1 text-sm font-medium text-slate-700">
              {item.label}
            </span>
            <ChevronRight size={16} className="text-slate-300" />
          </button>
        ))}
      </div>
      <button
        onClick={onSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 py-3.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
      >
        <LogOut size={17} /> Sair da conta
      </button>
    </div>
  );
}

function OnboardingView({ fullName }: { fullName: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f7fa] p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Truck size={28} />
        </div>
        <h1 className="mt-5 text-xl font-bold text-[#0b1d3a]">
          Bem-vindo, {fullName.split(" ")[0]}!
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Sua conta foi criada. Complete seu cadastro no perfil para começar a
          ficar online e receber propostas de frete.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-[#1052c7]">
          <Zap size={16} /> Aguardando liberação do administrador
        </div>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: { key: Tab; label: string; icon: typeof Truck }[] = [
    { key: "home", label: "Início", icon: Zap },
    { key: "profile", label: "Perfil", icon: User },
    { key: "history", label: "Viagens", icon: TrendingUp },
    { key: "settings", label: "Ajustes", icon: Settings },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-around px-2 py-2">
        {items.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 transition ${
              tab === key ? "text-[#1052c7]" : "text-slate-400"
            }`}
          >
            <Icon size={20} strokeWidth={tab === key ? 2.4 : 1.8} />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    offline: "Offline",
    available: "Disponível",
    in_negotiation: "Negociando",
    on_trip: "Em viagem",
  };
  return labels[status] ?? status;
}
