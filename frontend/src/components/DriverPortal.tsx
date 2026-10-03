import { useEffect, useRef, useState } from "react";
import {
  Truck,
  MapPin,
  Navigation,
  Star,
  TrendingUp,
  Clock,
  Zap,
  User,
  Phone,
  Mail,
  Calendar,
  ArrowLeft,
  Settings,
  ChevronRight,
  Power,
  Loader2,
  Edit3,
  Save,
  X,
  LogOut,
  MessageCircle,
  DollarSign,
  Route as RouteIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Driver } from "@/lib/types";
import type { FreightRoute, FreightSettlement } from "@/lib/dashboardTypes";
import { AccountCenter } from "@/components/AccountCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsMenu } from "@/components/SettingsMenu";
import { DriverChat } from "@/components/DriverChat";
import { FreightChatHistory } from "@/components/FreightChatHistory";
import { apiEventSource, apiFetch } from "@/lib/api";

type Tab = "home" | "profile" | "chat" | "routes" | "recebimentos" | "settings";
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
  const [freightOfferNotice, setFreightOfferNotice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "tracking" | "denied" | "unavailable"
  >("idle");
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [availabilityFormOpen, setAvailabilityFormOpen] = useState(false);
  const [availabilityCity, setAvailabilityCity] = useState("");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityTime, setAvailabilityTime] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const lastReverseGeocode = useRef({ key: "", timestamp: 0 });
  const driverId = driver?.id;
  const locationPermissionKey = driverId
    ? `acneto-location-permission:${driverId}`
    : null;

  useEffect(() => {
    const goHome = () => setTab("home");
    window.addEventListener("acneto-driver-go-home", goHome);
    return () => window.removeEventListener("acneto-driver-go-home", goHome);
  }, []);

  useEffect(() => {
    const token = accessToken();
    if (!driverId || !token) return;
    const events = apiEventSource(
      `/api/events?token=${encodeURIComponent(token)}`,
    );
    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type === "nearest-driver-freight-offer")
          setFreightOfferNotice(true);
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    events.addEventListener("message", handleEvent);
    return () => {
      events.removeEventListener("message", handleEvent);
      events.close();
    };
  }, [driverId]);

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
    if (!driver.is_online) {
      setAvailabilityCity(driver.availability_city ?? driver.city ?? "");
      setAvailabilityDate(
        driver.availability_at
          ? new Date(driver.availability_at).toISOString().slice(0, 10)
          : "",
      );
      setAvailabilityTime(
        driver.availability_at
          ? new Date(driver.availability_at).toTimeString().slice(0, 5)
          : "",
      );
      setAvailabilityError("");
      setAvailabilityFormOpen(true);
      return;
    }

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
        body: JSON.stringify({
          isOnline: newOnline,
          status: newStatus,
          availabilityCity: null,
          availabilityAt: null,
        }),
      });
    } else {
      localStorage.setItem("acneto-driver", JSON.stringify(updated));
      syncOperatorDriver(updated);
      window.dispatchEvent(new Event("acneto-driver-location"));
    }
    setDriver(updated);
    setToggling(false);
  };

  const confirmAvailability = async () => {
    if (!driver || toggling) return;
    if (!availabilityCity.trim() || !availabilityDate || !availabilityTime) {
      setAvailabilityError("Informe a cidade, data e hora previstas.");
      return;
    }
    const availabilityAt = new Date(`${availabilityDate}T${availabilityTime}`);
    if (!Number.isFinite(availabilityAt.getTime())) {
      setAvailabilityError("Informe uma data e hora válidas.");
      return;
    }

    setToggling(true);
    const now = new Date().toISOString();
    const updated = {
      ...driver,
      is_online: true,
      status: "available",
      last_seen: now,
      availability_since: now,
      availability_city: availabilityCity.trim(),
      availability_at: availabilityAt.toISOString(),
    } as Driver;
    if (accessToken()) {
      const response = await apiFetch("/api/drivers/me/status", {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({
          isOnline: true,
          status: "available",
          availabilityCity: availabilityCity.trim(),
          availabilityAt: availabilityAt.toISOString(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setAvailabilityError(
          body.error ?? "Não foi possível atualizar sua disponibilidade.",
        );
        setToggling(false);
        return;
      }
    } else {
      localStorage.setItem("acneto-driver", JSON.stringify(updated));
      syncOperatorDriver(updated);
      window.dispatchEvent(new Event("acneto-driver-location"));
    }
    setDriver(updated);
    setAvailabilityFormOpen(false);
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
      {freightOfferNotice && (
        <div className="fixed inset-x-4 top-20 z-40 mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-blue-200 bg-white p-4 shadow-lg">
          <MessageCircle className="shrink-0 text-blue-700" size={22} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#0b1d3a]">
              Nova oferta de frete
            </p>
            <p className="text-xs text-slate-500">
              A operação enviou uma oferta para você.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setFreightOfferNotice(false);
              setTab("chat");
            }}
            className="shrink-0 rounded-lg bg-[#1052c7] px-3 py-2 text-xs font-semibold text-white"
          >
            Ver oferta
          </button>
          <button
            type="button"
            onClick={() => setFreightOfferNotice(false)}
            aria-label="Fechar aviso de nova oferta"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>
      )}

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
                  no mapa quando estiver disponível.
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

      {availabilityFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
                  Disponibilidade
                </p>
                <h2 className="mt-1 text-xl font-bold text-[#0b1d3a]">
                  Onde e quando você estará disponível?
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Essas informações ajudam a operação a oferecer fretes antes da
                  sua chegada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAvailabilityFormOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Fechar disponibilidade"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-semibold text-slate-600">
                Cidade prevista *
                <input
                  value={availabilityCity}
                  onChange={(event) => setAvailabilityCity(event.target.value)}
                  placeholder="Ex.: Fortaleza"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-600">
                  Data prevista *
                  <input
                    type="date"
                    value={availabilityDate}
                    onChange={(event) =>
                      setAvailabilityDate(event.target.value)
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Hora prevista *
                  <input
                    type="time"
                    value={availabilityTime}
                    onChange={(event) =>
                      setAvailabilityTime(event.target.value)
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
              {availabilityError && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {availabilityError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void confirmAvailability()}
                disabled={toggling}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {toggling ? "Atualizando..." : "Confirmar disponibilidade"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-28 sm:px-6 lg:pb-10">
        {(tab === "home" || tab === "chat") && (
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
                    availabilityCity: updated.availability_city,
                    availabilityAt: updated.availability_at,
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
            onOpenChat={() => setTab("chat")}
            onOpenFreights={() => setTab("recebimentos")}
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
        {tab === "chat" && driver && (
          <DriverChat
            driverId={driver.id}
            participantName="Operação"
            initiallyOpen
          />
        )}
        {tab === "routes" && <DriverRoutesView />}
        {tab === "recebimentos" && (
          <DriverFreightSettlementsView onBack={() => setTab("home")} />
        )}
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
        availability_city: driver.availability_city ?? null,
        availability_at: driver.availability_at ?? null,
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
          <SettingsMenu onSignOut={onSignOut} />
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
            {driver.is_online ? "Estou disponível" : "Não disponível"}
          </div>
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
  onOpenChat,
  onOpenFreights,
}: {
  driver: Driver;
  locationStatus: "idle" | "tracking" | "denied" | "unavailable";
  onToggle: () => void;
  onUpdate: (updates: Partial<Driver>) => void;
  toggling: boolean;
  onOpenChat: () => void;
  onOpenFreights: () => void;
}) {
  const operationalStatuses: { value: Driver["status"]; label: string }[] = [
    { value: "available", label: "Estou disponível" },
    { value: "awaiting_loading", label: "Aguardando carregamento" },
    { value: "awaiting_documents", label: "Aguardando documentação" },
    { value: "awaiting_loading", label: "Aguardando carregamento" },
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
                ? "Você está disponível para os operadores."
                : "Fique disponível para receber propostas de frete."}
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
          {driver.is_online ? "Ficar não disponível" : "Ficar disponível"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onOpenChat}
          className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-left transition hover:bg-blue-100"
        >
          <div>
            <p className="text-sm font-bold text-blue-900">Chat com operação</p>
            <p className="mt-1 text-xs text-blue-700">
              Converse diretamente com a equipe.
            </p>
          </div>
          <MessageCircle className="text-blue-700" size={20} />
        </button>
        <button
          type="button"
          onClick={onOpenFreights}
          className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left transition hover:bg-emerald-100"
        >
          <div>
            <p className="text-sm font-bold text-emerald-900">
              Fretes e recebimentos
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              Confira valores pendentes e pagamentos.
            </p>
          </div>
          <DollarSign className="text-emerald-700" size={20} />
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
          {!driver.is_online && <option value="offline">Não disponível</option>}
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

const driverRouteStatusLabels: Record<string, string> = {
  open: "Aberta",
  assigned: "Designada",
  in_progress: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
};

function DriverRoutesView() {
  const [routes, setRoutes] = useState<
    Array<
      FreightRoute & {
        my_assignment: {
          id: string;
          capacity: string | null;
          status: string;
          progress_status: FreightRoute["assignments"][number]["progress_status"];
        } | null;
      }
    >
  >([]);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await apiFetch("/api/driver/routes", {
      headers: apiHeaders(),
    });
    if (!response.ok) {
      setError("Não foi possível carregar suas rotas.");
      return;
    }
    const body = (await response.json()) as { routes: typeof routes };
    setRoutes(body.routes);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    const token = accessToken();
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    const refreshOnEvent = () => void load();
    events?.addEventListener("message", refreshOnEvent);
    return () => {
      window.clearInterval(timer);
      events?.removeEventListener("message", refreshOnEvent);
      events?.close();
    };
  }, []);

  const endAssignment = async (
    routeId: string,
    assignmentId: string,
    status: "cancelled",
  ) => {
    const response = await apiFetch(
      `/api/freight-routes/${routeId}/assignments/${assignmentId}`,
      {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar a rota.");
      return;
    }
    await load();
  };

  const advanceFreight = async (
    routeId: string,
    assignmentId: string,
    action:
      | "start_collection"
      | "arrive_collection"
      | "start_customer"
      | "arrive_customer",
  ) => {
    const response = await apiFetch(
      `/api/freight-routes/${routeId}/assignments/${assignmentId}/progress`,
      {
        method: "PATCH",
        headers: apiHeaders(),
        body: JSON.stringify({ action }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Não foi possível atualizar o status do frete.");
      return;
    }
    await load();
  };

  const progressLabels: Record<
    FreightRoute["assignments"][number]["progress_status"],
    string
  > = {
    assigned: "Aguardando início da viagem",
    en_route_collection: "A caminho do posto de coleta",
    awaiting_collection_confirmation:
      "Chegada ao posto aguardando confirmação da operação",
    collection_confirmed: "Posto de coleta confirmado",
    en_route_customer: "A caminho do cliente final",
    awaiting_customer_confirmation:
      "Chegada ao cliente aguardando confirmação da operação",
    completed: "Frete concluído",
  };
  const nextProgressAction: Partial<
    Record<
      FreightRoute["assignments"][number]["progress_status"],
      {
        action:
          | "start_collection"
          | "arrive_collection"
          | "start_customer"
          | "arrive_customer";
        label: string;
      }
    >
  > = {
    assigned: {
      action: "start_collection",
      label: "Iniciar frete · a caminho do posto",
    },
    en_route_collection: {
      action: "arrive_collection",
      label: "Cheguei ao posto de coleta",
    },
    collection_confirmed: {
      action: "start_customer",
      label: "A caminho do cliente final",
    },
    en_route_customer: {
      action: "arrive_customer",
      label: "Cheguei ao cliente final",
    },
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
          Minhas rotas
        </p>
        <h2 className="mt-1 text-xl font-bold text-[#0b1d3a]">
          Rotas atribuídas a você
        </h2>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {routes.map((route) => {
        const progressStatus =
          route.my_assignment?.progress_status ?? "assigned";
        const nextAction = nextProgressAction[progressStatus];
        return (
          <article
            key={route.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-[#0b1d3a]">
                  {route.collection_point?.name ?? "?"} →{" "}
                  {route.final_customer?.name ?? "?"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Distância: {route.distance_km?.toFixed(1) ?? "—"} km
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                {driverRouteStatusLabels[route.status] ?? route.status}
              </span>
            </div>
            {route.my_assignment?.status === "active" && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-700">
                    {progressLabels[progressStatus]}
                  </p>
                </div>
                {nextAction && (
                  <button
                    type="button"
                    onClick={() =>
                      void advanceFreight(
                        route.id,
                        route.my_assignment!.id,
                        nextAction.action,
                      )
                    }
                    className="rounded-lg bg-[#1052c7] px-3 py-2 text-xs font-semibold text-white"
                  >
                    {nextAction.label}
                  </button>
                )}
                {[
                  "awaiting_collection_confirmation",
                  "awaiting_customer_confirmation",
                ].includes(progressStatus) && (
                  <p className="text-xs text-amber-700">
                    A operação precisa confirmar sua chegada para liberar a
                    próxima etapa.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void endAssignment(
                      route.id,
                      route.my_assignment!.id,
                      "cancelled",
                    )
                  }
                  className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700"
                >
                  Cancelar minha parte
                </button>
              </div>
            )}
          </article>
        );
      })}
      {!routes.length && (
        <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          Nenhuma rota atribuída a você no momento.
        </p>
      )}
    </div>
  );
}

const formatSettlementCents = (amount: number | null) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((amount ?? 0) / 100);

function DriverFreightSettlementsView({ onBack }: { onBack: () => void }) {
  const [settlements, setSettlements] = useState<FreightSettlement[]>([]);
  const [drafts, setDrafts] = useState<
    Record<string, { amount: string; notes: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch("/api/driver/freight-settlements", {
          headers: apiHeaders(),
        });
        if (!response.ok)
          throw new Error("Não foi possível carregar seus fretes.");
        const body = (await response.json()) as {
          settlements: FreightSettlement[];
        };
        if (!active) return;
        setSettlements(body.settlements);
        setDrafts((current) => {
          const next = { ...current };
          for (const settlement of body.settlements) {
            if (!next[settlement.id]) {
              next[settlement.id] = {
                amount: settlement.driver_claimed_amount_cents
                  ? (settlement.driver_claimed_amount_cents / 100).toFixed(2)
                  : "",
                notes: settlement.driver_notes ?? "",
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
  }, []);

  const saveClaim = async (settlement: FreightSettlement) => {
    const draft = drafts[settlement.id];
    const amountCents = Math.round(
      Number(draft?.amount.replace(",", ".")) * 100,
    );
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setError("Informe um valor válido maior que zero.");
      return;
    }
    setSavingId(settlement.id);
    setError("");
    try {
      const response = await apiFetch(
        `/api/driver/freight-settlements/${settlement.id}`,
        {
          method: "PATCH",
          headers: apiHeaders(),
          body: JSON.stringify({
            claimedAmountCents: amountCents,
            driverNotes: draft.notes,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível enviar o valor.");
      setSettlements((current) =>
        current.map((item) =>
          item.id === settlement.id
            ? {
                ...item,
                driver_claimed_amount_cents: amountCents,
                driver_notes: draft.notes,
              }
            : item,
        ),
      );
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
        { headers: apiHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Não foi possível baixar o comprovante.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download =
        settlement.payment_proof_file_name ?? "comprovante-pagamento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const pendingTotal = settlements
    .filter((item) => item.status === "pending")
    .reduce(
      (total, item) => total + (item.driver_claimed_amount_cents ?? 0),
      0,
    );
  const approvedTotal = settlements
    .filter((item) => item.status === "approved")
    .reduce((total, item) => total + (item.confirmed_amount_cents ?? 0), 0);
  const paidTotal = settlements
    .filter((item) => item.status === "paid")
    .reduce((total, item) => total + (item.confirmed_amount_cents ?? 0), 0);

  return (
    <section className="freight-settlements space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
            Financeiro de fretes
          </p>
          <h2 className="mt-1 text-xl font-bold text-[#0b1d3a]">
            Meus recebimentos
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Informe o valor de cada frete concluído e acompanhe a conferência e
            o pagamento.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft size={16} /> Voltar ao painel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Em conferência",
            total: pendingTotal,
            color: "text-amber-700",
          },
          { label: "A receber", total: approvedTotal, color: "text-blue-700" },
          { label: "Recebido", total: paidTotal, color: "text-emerald-700" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-xs font-semibold text-slate-500">{item.label}</p>
            <p className={`mt-1 text-lg font-bold ${item.color}`}>
              {formatSettlementCents(item.total)}
            </p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {settlements.map((settlement) => {
        const draft = drafts[settlement.id] ?? { amount: "", notes: "" };
        const statusLabel = {
          pending: settlement.driver_claimed_amount_cents
            ? "Em conferência"
            : "Informe o valor",
          approved: "Aprovado · aguardando pagamento",
          paid: "Pago",
        }[settlement.status];
        return (
          <article
            key={settlement.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-[#0b1d3a]">
                  {settlement.assignment.route.collection_point.name} →{" "}
                  {settlement.assignment.route.final_customer.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Concluído em{" "}
                  {settlement.assignment.ended_at
                    ? new Date(
                        settlement.assignment.ended_at,
                      ).toLocaleDateString("pt-BR")
                    : "—"}
                  {settlement.assignment.route.distance_km !== null &&
                    ` · ${settlement.assignment.route.distance_km.toFixed(1)} km`}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {statusLabel}
              </span>
            </div>
            {settlement.status === "paid" && settlement.has_payment_proof && (
              <button
                type="button"
                onClick={() => void downloadPaymentProof(settlement)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Baixar comprovante
              </button>
            )}
            <FreightChatHistory
              routeId={settlement.assignment.route.id}
              assignmentId={settlement.assignment.id}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <label className="text-xs font-semibold text-slate-600">
                Valor que tem a receber (R$)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  disabled={
                    settlement.status !== "pending" ||
                    savingId === settlement.id
                  }
                  value={draft.amount}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [settlement.id]: { ...draft, amount: event.target.value },
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Observação (opcional)
                <input
                  maxLength={1000}
                  disabled={
                    settlement.status !== "pending" ||
                    savingId === settlement.id
                  }
                  value={draft.notes}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [settlement.id]: { ...draft, notes: event.target.value },
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </label>
              {settlement.status === "pending" ? (
                <button
                  type="button"
                  disabled={savingId === settlement.id}
                  onClick={() => void saveClaim(settlement)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1052c7] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <DollarSign size={16} />
                  {savingId === settlement.id ? "Enviando..." : "Enviar valor"}
                </button>
              ) : (
                <p className="text-sm font-bold text-[#0b1d3a]">
                  Confirmado:{" "}
                  {formatSettlementCents(settlement.confirmed_amount_cents)}
                </p>
              )}
            </div>
          </article>
        );
      })}
      {!settlements.length && !error && (
        <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          Seus fretes concluídos aparecerão aqui para conferência dos valores.
        </p>
      )}
    </section>
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
        {items.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50 ${index < items.length - 1 ? "border-b border-slate-100" : ""}`}
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
        type="button"
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
          ficar disponível e receber propostas de frete.
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
    { key: "routes", label: "Rotas", icon: RouteIcon },
    { key: "recebimentos", label: "Fretes", icon: DollarSign },
    { key: "chat", label: "Chat", icon: MessageCircle },
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
    offline: "Não disponível",
    available: "Estou disponível",
    in_negotiation: "Negociando",
    on_trip: "Em viagem",
  };
  return labels[status] ?? status;
}
