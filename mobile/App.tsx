import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { DriverChat } from "./DriverChat";

type MobileScreen =
  | "home"
  | "driver-data"
  | "vehicle"
  | "routes"
  | "freights"
  | "chat"
  | "settings";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const LOCATION_TASK = "acneto-driver-location";
const TOKEN_KEY = "acneto-access-token";
const DRIVER_KEY = "acneto-driver";
let foregroundSubscription: Location.LocationSubscription | null = null;
let lastGeocodeKey = "";
let lastGeocodeAt = 0;

async function apiFetch(path: string, init?: RequestInit) {
  if (!API_URL) {
    throw new Error(
      "Defina EXPO_PUBLIC_API_URL apontando para o mesmo backend usado pelo frontend.",
    );
  }
  return fetch(`${API_URL}${path}`, init);
}

type Driver = {
  id: string;
  user_id?: string;
  full_name: string;
  cpf?: string | null;
  email: string | null;
  phone: string | null;
  cnh?: string | null;
  city: string | null;
  state: string | null;
  is_online: boolean;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
  status: string;
  availability_city?: string | null;
  availability_at?: string | null;
  vehicle_model: string | null;
  plate: string | null;
  capacity: string | null;
  compartments: string | null;
  notes?: string | null;
  rating: number;
  total_trips?: number;
  vehicle_year?: number | null;
  cnh_category?: string | null;
  cnh_expires_at?: string | null;
  employment_type?: "autonomous" | "carrier" | string;
  carrier?: {
    id: string;
    name?: string;
    legal_name?: string;
    cnpj: string;
  } | null;
  homologation_status?: string;
};

type DriverFreightSettlement = {
  id: string;
  status: "pending" | "approved" | "paid";
  driver_claimed_amount_cents: number | null;
  confirmed_amount_cents: number | null;
  driver_notes: string | null;
  paid_at: string | null;
  assignment: {
    ended_at: string | null;
    route: {
      distance_km: number | null;
      collection_point: { name: string };
      final_customer: { name: string };
    };
  };
};

type DriverFreightRoute = {
  id: string;
  status: string;
  distance_km: number | null;
  collection_point: { name: string } | null;
  final_customer: { name: string } | null;
  my_assignment: {
    id: string;
    status: "active" | "completed" | "cancelled";
    progress_status:
      | "assigned"
      | "en_route_collection"
      | "awaiting_collection_confirmation"
      | "collection_confirmed"
      | "en_route_customer"
      | "awaiting_customer_confirmation"
      | "completed";
  } | null;
};

type DriverFreightProgress = NonNullable<
  DriverFreightRoute["my_assignment"]
>["progress_status"];

const statusLabels: Record<string, string> = {
  available: "Disponível",
  awaiting_loading: "Aguardando carregamento",
  awaiting_documents: "Aguardando documentação",
  in_transit: "Frete em andamento",
  awaiting_unloading: "Aguardando descarga",
  offline: "Offline",
};

async function sendLocation(location: Location.LocationObject) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await apiFetch("/api/drivers/me/location", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      last_seen: new Date().toISOString(),
    }),
  });
}

async function reverseGeocode(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const now = Date.now();
  if (key === lastGeocodeKey && now - lastGeocodeAt < 60_000) return null;
  lastGeocodeKey = key;
  lastGeocodeAt = now;

  const query = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "10",
    addressdetails: "1",
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?${query.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    address?: {
      city?: string;
      town?: string;
      municipality?: string;
      village?: string;
      state_code?: string;
      "ISO3166-2-lvl4"?: string;
    };
  };
  const address = body.address;
  if (!address) return null;
  return {
    city:
      address.city ??
      address.town ??
      address.municipality ??
      address.village ??
      null,
    state:
      address.state_code?.replace(/^br-/i, "").toUpperCase() ??
      address["ISO3166-2-lvl4"]?.split("-").pop()?.toUpperCase() ??
      null,
  };
}

async function syncForegroundLocation(location: Location.LocationObject) {
  await sendLocation(location);
  try {
    const address = await reverseGeocode(
      location.coords.latitude,
      location.coords.longitude,
    );
    if (!address?.city && !address?.state) return;
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const driverJson = await AsyncStorage.getItem(DRIVER_KEY);
    const driver = driverJson ? (JSON.parse(driverJson) as Driver) : null;
    if (!driver) return;
    const updated = {
      ...driver,
      city: address.city ?? driver.city,
      state: address.state ?? driver.state,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      last_seen: new Date().toISOString(),
    };
    if (token) {
      await apiFetch("/api/drivers/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ city: updated.city, state: updated.state }),
      });
    }
    await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(updated));
  } catch {
    // A próxima posição tenta atualizar a cidade novamente.
  }
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)
    ?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  try {
    const driverJson = await AsyncStorage.getItem(DRIVER_KEY);
    const driver = driverJson ? (JSON.parse(driverJson) as Driver) : null;
    if (driver?.is_online) await sendLocation(latest);
  } catch {
    // A próxima atualização tenta novamente quando a rede estiver disponível.
  }
});

async function startLocationTracking(): Promise<"foreground"> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    throw new Error("Permissão de localização em primeiro plano negada.");
  }

  foregroundSubscription?.remove();
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 30_000,
      distanceInterval: 50,
    },
    (location) => void syncForegroundLocation(location),
  );
  return "foreground";
}

async function stopLocationTracking() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  try {
    const started =
      await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // The background task may not exist in Expo Go or older installed builds.
  }
}

function AppContent() {
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [trackingMode, setTrackingMode] = useState<
    "background" | "foreground" | null
  >(null);
  const [screen, setScreen] = useState<MobileScreen>("home");
  const seenOfferIds = useRef(new Set<string>());
  const seenAlertIds = useRef(new Set<string>());

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      // Só retoma o rastreamento ao voltar ao primeiro plano, e apenas se
      // ele ainda não estiver ativo, evitando pedidos de permissão duplicados.
      if (state === "active" && driver?.is_online && token && !trackingMode) {
        try {
          const mode = await startLocationTracking();
          setTrackingMode(mode);
        } catch {
          setTrackingMode(null);
        }
      }
    });

    return () => subscription.remove();
  }, [driver?.is_online, token, trackingMode]);

  useEffect(() => {
    if (!driver?.id || !token) return;
    let active = true;
    let requestInFlight = false;
    const checkFreightOffers = async () => {
      if (!active || AppState.currentState !== "active" || requestInFlight)
        return;
      requestInFlight = true;
      try {
        const response = await apiFetch(
          `/api/drivers/${driver.id}/chat/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          messages?: Array<{
            id: string;
            body: string;
            kind?: string;
            created_at: string;
            freight_offer?: { id: string; status: string } | null;
          }>;
        };
        const pendingOffers = (body.messages ?? []).filter(
          (message) =>
            message.freight_offer?.status === "offered" &&
            !seenOfferIds.current.has(message.freight_offer.id),
        );
        // Alertas de rotas: só os recentes (15 min) e uma única vez por mensagem.
        const recentAlerts = (body.messages ?? []).filter(
          (message) =>
            message.kind === "route_alert" &&
            !seenAlertIds.current.has(message.id) &&
            Date.now() - new Date(message.created_at).getTime() <
              15 * 60 * 1000,
        );
        for (const message of body.messages ?? [])
          if (message.kind === "route_alert")
            seenAlertIds.current.add(message.id);
        if (recentAlerts.length > 0) {
          Alert.alert(
            "Rotas disponíveis",
            recentAlerts[recentAlerts.length - 1].body,
            [
              { text: "Depois", style: "cancel" },
              { text: "Abrir chat", onPress: () => setScreen("chat") },
            ],
          );
        }
        for (const message of pendingOffers) {
          const offerId = message.freight_offer?.id;
          if (offerId) seenOfferIds.current.add(offerId);
        }
        if (pendingOffers.length > 0) {
          Alert.alert(
            "Nova oferta de frete",
            pendingOffers[pendingOffers.length - 1].body,
            [
              { text: "Depois", style: "cancel" },
              { text: "Ver oferta", onPress: () => setScreen("chat") },
            ],
          );
        }
      } catch {
        // A próxima verificação tenta novamente quando a conexão voltar.
      } finally {
        requestInFlight = false;
      }
    };
    void checkFreightOffers();
    const timer = setInterval(() => void checkFreightOffers(), 5000);
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") void checkFreightOffers();
      },
    );
    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [driver?.id, token]);

  useEffect(() => {
    if (screen !== "chat") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setScreen("home");
        return true;
      },
    );
    return () => subscription.remove();
  }, [screen]);

  async function restoreSession() {
    try {
      const savedToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (!savedToken) return;
      const response = await apiFetch("/api/drivers/me", {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!response.ok) throw new Error("Sessão expirada");
      const body = (await response.json()) as { driver: Driver };
      setToken(savedToken);
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    } catch {
      await AsyncStorage.multiRemove([TOKEN_KEY, DRIVER_KEY]);
    } finally {
      setLoading(false);
    }
  }

  async function login() {
    if (!email.trim() || !password) {
      Alert.alert("Dados incompletos", "Informe seu e-mail e senha.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await response.json()) as {
        access_token?: string;
        user?: { role?: string };
        error?: string;
      };
      if (!response.ok || !body.access_token) {
        throw new Error(body.error ?? "Não foi possível entrar.");
      }
      if (body.user?.role !== "driver") {
        throw new Error("Esta versão mobile é exclusiva para motoristas.");
      }
      await AsyncStorage.setItem(TOKEN_KEY, body.access_token);
      setToken(body.access_token);
      await restoreSession();
    } catch (error) {
      Alert.alert("Não foi possível entrar", (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleOnline(
    value: boolean,
    availability?: { city: string; at: string },
  ): Promise<boolean> {
    if (!driver || !token || (value && !availability)) return false;
    setSubmitting(true);
    try {
      if (value) setTrackingMode(await startLocationTracking());
      else {
        await stopLocationTracking();
        setTrackingMode(null);
      }
      const status = value ? "available" : "offline";
      const response = await apiFetch("/api/drivers/me/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isOnline: value,
          status,
          ...(availability && {
            availabilityCity: availability.city,
            availabilityAt: availability.at,
          }),
        }),
      });
      if (!response.ok)
        throw new Error("Não foi possível atualizar seu status.");
      const body = (await response.json()) as { driver: Driver };
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
      return true;
    } catch (error) {
      Alert.alert(
        "Não foi possível atualizar o status",
        (error as Error).message,
      );
      if (value) await stopLocationTracking().catch(() => undefined);
      if (value) setTrackingMode(null);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function updateDriverStatus(status: string) {
    if (!driver || !token || submitting) return;
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/drivers/me/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isOnline: driver.is_online,
          status,
          notes: driver.notes,
        }),
      });
      const body = (await response.json()) as {
        driver?: Driver;
        error?: string;
      };
      if (!response.ok || !body.driver)
        throw new Error(body.error ?? "Não foi possível atualizar o status.");
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    } catch (error) {
      Alert.alert("Status", (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await stopLocationTracking().catch(() => undefined);
    await AsyncStorage.multiRemove([TOKEN_KEY, DRIVER_KEY]);
    setToken(null);
    setDriver(null);
  }

  async function saveDriverProfile(updates: Partial<Driver>) {
    if (!driver) return;
    const updated = { ...driver, ...updates } as Driver;
    setSubmitting(true);
    try {
      if (token) {
        const response = await apiFetch("/api/drivers/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fullName: updated.full_name,
            cpf: updated.cpf,
            phone: updated.phone,
            email: updated.email,
            vehicleModel: updated.vehicle_model,
            vehicleYear: updated.vehicle_year,
            plate: updated.plate,
            capacity: updated.capacity,
            compartments: updated.compartments,
            cnh: updated.cnh,
            cnhCategory: updated.cnh_category,
            cnhExpiresAt: updated.cnh_expires_at,
            city: updated.city,
            state: updated.state,
            notes: updated.notes,
          }),
        });
        if (!response.ok)
          throw new Error("Não foi possível salvar seus dados.");
        const body = (await response.json()) as { driver?: Driver };
        setDriver(body.driver ?? updated);
        await AsyncStorage.setItem(
          DRIVER_KEY,
          JSON.stringify(body.driver ?? updated),
        );
      } else {
        setDriver(updated);
        await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(updated));
      }
      Alert.alert("Dados atualizados", "Seu cadastro foi salvo com sucesso.");
    } catch (error) {
      Alert.alert("Não foi possível salvar", (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen />;
  if (!token || !driver) {
    return (
      <LoginScreen
        email={email}
        password={password}
        setEmail={setEmail}
        setPassword={setPassword}
        onLogin={login}
        submitting={submitting}
      />
    );
  }

  if (screen === "driver-data") {
    return (
      <DriverDataScreen
        driver={driver}
        saving={submitting}
        onSave={saveDriverProfile}
        onBack={() => setScreen("home")}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
      />
    );
  }

  if (screen === "vehicle") {
    return (
      <VehicleScreen
        driver={driver}
        onBack={() => setScreen("home")}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
      />
    );
  }
  if (screen === "routes") {
    return (
      <DriverRoutesScreen
        token={token}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
      />
    );
  }
  if (screen === "freights") {
    return (
      <DriverFreightsScreen
        token={token}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        onBack={() => setScreen("home")}
        onLogout={logout}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <DriverHome
        driver={driver}
        submitting={submitting}
        onToggle={toggleOnline}
        onLogout={logout}
        onOpenDriverData={() => setScreen("driver-data")}
        onOpenVehicle={() => setScreen("vehicle")}
        onOpenChat={() => setScreen("chat")}
        onStatusChange={(status) => void updateDriverStatus(status)}
        onNavigateScreen={(nextScreen) => setScreen(nextScreen)}
      />
      {screen === "chat" && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityLabel="Minimizar chat"
            onPress={() => setScreen("home")}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(2, 8, 23, 0.45)" },
            ]}
          />
          <View
            style={{
              backgroundColor: "#f5f7fa",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              bottom: 0,
              height: "82%",
              left: 0,
              overflow: "hidden",
              position: "absolute",
              right: 0,
            }}
          >
            <DriverChat
              driverId={driver.id}
              driverUserId={driver.user_id ?? ""}
              participantName="Operação"
              token={token}
              onBack={() => setScreen("home")}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function DriverFreightsScreen({
  token,
  onNavigate,
}: {
  token: string;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const [settlements, setSettlements] = useState<DriverFreightSettlement[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch("/api/driver/freight-settlements", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
          throw new Error("Não foi possível carregar seus fretes.");
        const body = (await response.json()) as {
          settlements: DriverFreightSettlement[];
        };
        if (!active) return;
        setSettlements(body.settlements);
        setAmounts((current) => {
          const next = { ...current };
          for (const settlement of body.settlements) {
            if (next[settlement.id] === undefined) {
              next[settlement.id] = settlement.driver_claimed_amount_cents
                ? (settlement.driver_claimed_amount_cents / 100).toFixed(2)
                : "";
            }
          }
          return next;
        });
        setNotes((current) => {
          const next = { ...current };
          for (const settlement of body.settlements) {
            if (next[settlement.id] === undefined)
              next[settlement.id] = settlement.driver_notes ?? "";
          }
          return next;
        });
        setError("");
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token]);

  const saveClaim = async (settlement: DriverFreightSettlement) => {
    const amountCents = Math.round(
      Number((amounts[settlement.id] ?? "").replace(",", ".")) * 100,
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            claimedAmountCents: amountCents,
            driverNotes: notes[settlement.id] ?? "",
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível enviar o valor.");
      setSettlements((current) =>
        current.map((item) =>
          item.id === settlement.id
            ? { ...item, driver_claimed_amount_cents: amountCents }
            : item,
        ),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const formatCents = (amount: number | null) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format((amount ?? 0) / 100);
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
    <SafeAreaView style={styles.safeLight}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader
          title="Meus fretes"
          onBack={() => onNavigate("home")}
        />
        <Text style={styles.infoText}>
          Informe o valor dos fretes concluídos e acompanhe a conferência e o
          pagamento.
        </Text>
        <View style={styles.dataCard}>
          <View style={styles.dataRow}>
            <Text style={styles.dataRowLabel}>A receber após conferência</Text>
            <Text style={styles.dataRowValue}>
              {formatCents(pendingTotal + approvedTotal)}
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.dataRowLabel}>Em conferência</Text>
            <Text style={styles.dataRowValue}>{formatCents(pendingTotal)}</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.dataRowLabel}>Já recebido</Text>
            <Text style={styles.dataRowValue}>{formatCents(paidTotal)}</Text>
          </View>
        </View>
        {error ? <Text style={{ color: "#dc2626" }}>{error}</Text> : null}
        {settlements.map((settlement) => {
          const statusLabel = {
            pending: settlement.driver_claimed_amount_cents
              ? "Em conferência"
              : "Informe o valor",
            approved: "Aprovado · aguardando pagamento",
            paid: "Pago",
          }[settlement.status];
          const editable = settlement.status === "pending";
          return (
            <View key={settlement.id} style={styles.dataCard}>
              <Text style={styles.dataRowLabel}>
                {settlement.assignment.route.collection_point.name} →{"\n"}
                {settlement.assignment.route.final_customer.name}
              </Text>
              <Text style={styles.infoText}>
                {statusLabel}
                {settlement.assignment.ended_at &&
                  ` · ${new Date(settlement.assignment.ended_at).toLocaleDateString("pt-BR")}`}
                {settlement.assignment.route.distance_km !== null &&
                  ` · ${settlement.assignment.route.distance_km.toFixed(1)} km`}
              </Text>
              {editable ? (
                <>
                  <TextInput
                    keyboardType="decimal-pad"
                    editable={savingId !== settlement.id}
                    placeholder="Valor a receber em R$"
                    value={amounts[settlement.id] ?? ""}
                    onChangeText={(value) =>
                      setAmounts((current) => ({
                        ...current,
                        [settlement.id]: value,
                      }))
                    }
                    style={styles.input}
                  />
                  <TextInput
                    editable={savingId !== settlement.id}
                    maxLength={1000}
                    placeholder="Observação (opcional)"
                    value={notes[settlement.id] ?? ""}
                    onChangeText={(value) =>
                      setNotes((current) => ({
                        ...current,
                        [settlement.id]: value,
                      }))
                    }
                    style={styles.input}
                  />
                  <TouchableOpacity
                    disabled={savingId === settlement.id}
                    onPress={() => void saveClaim(settlement)}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>
                      {savingId === settlement.id
                        ? "Enviando..."
                        : "Enviar valor"}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.dataRow}>
                  <Text style={styles.dataRowLabel}>Valor confirmado</Text>
                  <Text style={styles.dataRowValue}>
                    {formatCents(settlement.confirmed_amount_cents)}
                  </Text>
                </View>
              )}
              {settlement.status === "paid" && settlement.paid_at && (
                <Text style={styles.infoText}>
                  Pago em{" "}
                  {new Date(settlement.paid_at).toLocaleDateString("pt-BR")}
                </Text>
              )}
            </View>
          );
        })}
        {!settlements.length && !error && (
          <View style={styles.dataCard}>
            <Text style={styles.infoText}>
              Seus fretes concluídos aparecerão aqui.
            </Text>
          </View>
        )}
      </ScrollView>
      <MobileBottomNav screen="freights" onNavigate={onNavigate} />
    </SafeAreaView>
  );
}

function DriverRoutesScreen({
  token,
  onNavigate,
}: {
  token: string;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const [routes, setRoutes] = useState<DriverFreightRoute[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const response = await apiFetch("/api/driver/routes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok)
        throw new Error("Não foi possível carregar seus fretes.");
      const body = (await response.json()) as {
        routes: DriverFreightRoute[];
      };
      setRoutes(body.routes);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [token]);

  const advance = async (
    routeId: string,
    assignmentId: string,
    action:
      | "start_collection"
      | "arrive_collection"
      | "start_customer"
      | "arrive_customer",
  ) => {
    setSavingId(assignmentId);
    setError("");
    try {
      const response = await apiFetch(
        `/api/freight-routes/${routeId}/assignments/${assignmentId}/progress`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível atualizar o frete.");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const labels: Record<DriverFreightProgress, string> = {
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
  const nextActions: Partial<
    Record<
      DriverFreightProgress,
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
      label: "Iniciar · a caminho do posto",
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
    <SafeAreaView style={styles.safeLight}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader
          title="Minhas rotas"
          onBack={() => onNavigate("home")}
        />
        <Text style={styles.infoText}>
          Atualize cada etapa do frete. As chegadas precisam ser confirmadas
          pela operação.
        </Text>
        {error ? <Text style={{ color: "#dc2626" }}>{error}</Text> : null}
        {routes.map((route) => {
          const assignment = route.my_assignment;
          if (!assignment) return null;
          const nextAction = nextActions[assignment.progress_status];
          return (
            <View key={route.id} style={styles.dataCard}>
              <Text style={styles.dataRowLabel}>
                {route.collection_point?.name ?? "Origem"} →{"\n"}
                {route.final_customer?.name ?? "Destino"}
              </Text>
              {route.distance_km !== null && (
                <Text style={styles.infoText}>
                  Distância: {route.distance_km.toFixed(1)} km
                </Text>
              )}
              <View style={styles.dataRow}>
                <Text style={styles.dataRowValue}>
                  {assignment.status === "cancelled"
                    ? "Frete cancelado"
                    : labels[assignment.progress_status]}
                </Text>
              </View>
              {nextAction && assignment.status === "active" && (
                <TouchableOpacity
                  disabled={savingId === assignment.id}
                  onPress={() =>
                    void advance(route.id, assignment.id, nextAction.action)
                  }
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {savingId === assignment.id
                      ? "Atualizando..."
                      : nextAction.label}
                  </Text>
                </TouchableOpacity>
              )}
              {[
                "awaiting_collection_confirmation",
                "awaiting_customer_confirmation",
              ].includes(assignment.progress_status) && (
                <Text style={{ color: "#b45309", fontSize: 12, marginTop: 10 }}>
                  Aguardando confirmação de chegada pela operação.
                </Text>
              )}
            </View>
          );
        })}
        {!routes.length && !error && (
          <View style={styles.dataCard}>
            <Text style={styles.infoText}>
              Nenhuma rota atribuída no momento.
            </Text>
          </View>
        )}
      </ScrollView>
      <MobileBottomNav screen="routes" onNavigate={onNavigate} />
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView style={styles.loading}>
      <ActivityIndicator color="#0e4db7" size="large" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function LoginScreen({
  email,
  password,
  setEmail,
  setPassword,
  onLogin,
  submitting,
}: {
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onLogin: () => void;
  submitting: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.loginTop}>
        <Image source={logo} style={styles.logo} />
        <Text style={styles.eyebrow}>NEXT DRIVER</Text>
        <Text style={styles.loginTitle}>Para motoristas em movimento.</Text>
        <Text style={styles.loginSubtitle}>
          Entre para receber propostas e compartilhar sua posição com segurança.
        </Text>
      </View>
      <View style={styles.loginCard}>
        <Text style={styles.cardTitle}>Acessar conta</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Seu e-mail"
          placeholderTextColor="#94a3b8"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          placeholder="Sua senha"
          placeholderTextColor="#94a3b8"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          disabled={submitting}
          onPress={onLogin}
          style={styles.primaryButton}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Entrar no painel</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function DriverHome({
  driver,
  submitting,
  onToggle,
  onLogout,
  onOpenDriverData,
  onOpenVehicle,
  onOpenChat,
  onStatusChange,
  onNavigateScreen,
}: {
  driver: Driver;
  submitting: boolean;
  onToggle: (
    value: boolean,
    availability?: { city: string; at: string },
  ) => Promise<boolean>;
  onLogout: () => void;
  onOpenDriverData: () => void;
  onOpenVehicle: () => void;
  onOpenChat: () => void;
  onStatusChange: (status: string) => void;
  onNavigateScreen: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const [availabilityFormOpen, setAvailabilityFormOpen] = useState(false);
  const [availabilityCity, setAvailabilityCity] = useState("");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityTime, setAvailabilityTime] = useState("");
  const coordinates =
    driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`
      : "Aguardando primeira posição";

  function openAvailabilityForm() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    setAvailabilityCity(driver.availability_city ?? driver.city ?? "");
    setAvailabilityDate(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );
    setAvailabilityTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setAvailabilityFormOpen(true);
  }

  async function confirmAvailability() {
    const at = new Date(`${availabilityDate}T${availabilityTime}`);
    if (
      !availabilityCity.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(availabilityDate) ||
      !/^\d{2}:\d{2}$/.test(availabilityTime) ||
      !Number.isFinite(at.getTime())
    ) {
      Alert.alert(
        "Disponibilidade",
        "Informe uma cidade, data e hora válidas.",
      );
      return;
    }
    const activated = await onToggle(true, {
      city: availabilityCity.trim(),
      at: at.toISOString(),
    });
    if (activated) setAvailabilityFormOpen(false);
  }

  return (
    <SafeAreaView style={styles.safeLight}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.home,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onOpenDriverData}>
            <Text style={styles.eyebrowDark}>PAINEL DO MOTORISTA</Text>
            <Text style={styles.greeting}>
              Olá, {driver.full_name.split(" ")[0]}
            </Text>
            <Text style={styles.profileLink}>Meus dados ›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          disabled={submitting}
          onPress={() => {
            if (driver.is_online) void onToggle(false);
            else openAvailabilityForm();
          }}
          style={[
            styles.availabilityHero,
            driver.is_online && styles.availabilityActive,
          ]}
        >
          <View
            style={[
              styles.availabilityRing,
              submitting && styles.availabilityBusy,
            ]}
          >
            <View
              style={[
                styles.availabilityCore,
                driver.is_online &&
                  !submitting &&
                  styles.availabilityCoreActive,
                submitting && styles.availabilityCoreLoading,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#07399f" />
              ) : (
                <Text
                  style={[
                    styles.availabilityPin,
                    driver.is_online && styles.availabilityPinActive,
                  ]}
                >
                  ●
                </Text>
              )}
              <Text
                style={[
                  styles.availabilityHint,
                  driver.is_online &&
                    !submitting &&
                    styles.availabilityHintActive,
                ]}
              >
                {submitting ? "AGUARDE" : driver.is_online ? "ATIVO" : "TOQUE"}
              </Text>
            </View>
          </View>
          <Text style={styles.availabilityTitle}>
            {submitting
              ? "CAPTURANDO GPS..."
              : driver.is_online
                ? "DISPONÍVEL"
                : "INATIVO"}
          </Text>
          <Text style={styles.availabilityDescription}>
            {driver.is_online
              ? "Visível para a central de vendas"
              : "Não aparece no painel do operador"}
          </Text>
          <Text style={styles.availabilityLocation}>
            ● {driver.city || "Localização aguardando GPS"}
            {driver.state ? `, ${driver.state}` : ""}
            {driver.latitude !== null && driver.longitude !== null
              ? ` — ${coordinates}`
              : ""}
          </Text>
        </TouchableOpacity>

        {availabilityFormOpen && !driver.is_online && (
          <View style={styles.availabilityForm}>
            <Text style={styles.availabilityFormTitle}>
              Previsão para ficar disponível
            </Text>
            <TextInput
              accessibilityLabel="Cidade de disponibilidade"
              autoCapitalize="words"
              onChangeText={setAvailabilityCity}
              placeholder="Cidade"
              placeholderTextColor="#718096"
              style={styles.availabilityInput}
              value={availabilityCity}
            />
            <View style={styles.availabilityInputRow}>
              <TextInput
                accessibilityLabel="Data de disponibilidade"
                keyboardType="numbers-and-punctuation"
                onChangeText={setAvailabilityDate}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#718096"
                style={[styles.availabilityInput, styles.availabilityInputHalf]}
                value={availabilityDate}
              />
              <TextInput
                accessibilityLabel="Hora de disponibilidade"
                keyboardType="numbers-and-punctuation"
                onChangeText={setAvailabilityTime}
                placeholder="HH:MM"
                placeholderTextColor="#718096"
                style={[styles.availabilityInput, styles.availabilityInputHalf]}
                value={availabilityTime}
              />
            </View>
            <View style={styles.availabilityActions}>
              <TouchableOpacity
                disabled={submitting}
                onPress={() => setAvailabilityFormOpen(false)}
                style={styles.availabilityCancelButton}
              >
                <Text style={styles.availabilityCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={submitting}
                onPress={() => void confirmAvailability()}
                style={styles.availabilityConfirmButton}
              >
                {submitting ? (
                  <ActivityIndicator color="#07399f" />
                ) : (
                  <Text style={styles.availabilityConfirmText}>
                    Ficar online
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.statusListCard}>
          <Text style={styles.statusListTitle}>MEU STATUS ATUAL</Text>
          {[
            ["available", "DISPONÍVEL", "#fff000"],
            ["awaiting_loading", "AG. CARREGAMENTO", "#ffb347"],
            ["in_transit", "EM TRÂNSITO", "#6ccdf5"],
            ["at_collection", "NO POSTO DE COLETA", "#f59e0b"],
            ["awaiting_unloading", "AG. DESCARGA", "#d5a6ff"],
            ["driver_completed", "AG. CONFERÊNCIA", "#86efac"],
            ["maintenance", "MANUTENÇÃO", "#ff5d6c"],
          ].map(([value, label, color]) => (
            <TouchableOpacity
              key={value}
              onPress={() => onStatusChange(value)}
              disabled={submitting || !driver.is_online}
              style={[
                styles.statusOption,
                driver.status === value && styles.statusOptionActive,
                (!driver.is_online || submitting) &&
                  styles.statusOptionDisabled,
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: color }]} />
              <Text style={styles.statusOptionText}>{label}</Text>
              {driver.status === value && (
                <Text style={styles.statusCheck}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.quickGrid}>
          <TouchableOpacity onPress={onOpenChat} style={styles.quickCard}>
            <Text style={styles.quickIcon}>✉</Text>
            <Text style={styles.quickTitle}>Chat com operação</Text>
            <Text style={styles.quickSubtitle}>Converse com a central</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenVehicle} style={styles.quickCard}>
            <Text style={styles.quickIcon}>▣</Text>
            <Text style={styles.quickTitle}>Meu veículo</Text>
            <Text style={styles.quickSubtitle}>Dados e capacidade</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <MobileBottomNav screen="home" onNavigate={onNavigateScreen} />
    </SafeAreaView>
  );
}

function MobileBottomNav({
  screen,
  onNavigate,
}: {
  screen: MobileScreen;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const items = [
    ["home", "⌂", "Início"],
    ["driver-data", "♙", "Perfil"],
    ["routes", "↗", "Rotas"],
    ["freights", "$", "Fretes"],
    ["chat", "✉", "Chat"],
    ["settings", "⚙", "Ajustes"],
  ] as const;
  return (
    <View style={[styles.mobileBottomNav, { bottom: insets.bottom }]}>
      {items.map(([key, icon, label]) => (
        <TouchableOpacity
          key={key}
          onPress={() => {
            onNavigate(key);
          }}
          style={styles.mobileNavItem}
        >
          <Text
            style={[
              styles.mobileNavIcon,
              screen === key && styles.mobileNavActive,
            ]}
          >
            {icon}
          </Text>
          <Text
            style={[
              styles.mobileNavLabel,
              screen === key && styles.mobileNavActive,
            ]}
          >
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SettingsScreen({
  onBack,
  onLogout,
  onNavigate,
}: {
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader title="Ajustes" onBack={onBack} />
        <Text style={styles.dataSectionLabel}>CONTA</Text>
        <View style={styles.dataCard}>
          <TouchableOpacity onPress={onLogout} style={styles.settingsAction}>
            <Text style={styles.settingsActionText}>Sair da conta</Text>
          </TouchableOpacity>
          <Text style={styles.settingsInfo}>
            A localização e as mensagens são sincronizadas com a operação quando
            o aplicativo está online.
          </Text>
        </View>
      </ScrollView>
      <MobileBottomNav screen="settings" onNavigate={onNavigate} />
    </SafeAreaView>
  );
}

function DriverDataScreen({
  driver,
  saving,
  onSave,
  onBack,
  onNavigate,
}: {
  driver: Driver;
  saving: boolean;
  onSave: (updates: Partial<Driver>) => Promise<void>;
  onBack: () => void;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    full_name: driver.full_name,
    cpf: driver.cpf ?? "",
    email: driver.email ?? "",
    phone: driver.phone ?? "",
    cnh: driver.cnh ?? "",
    cnh_category: driver.cnh_category ?? "",
    cnh_expires_at: driver.cnh_expires_at?.slice(0, 10) ?? "",
    vehicle_model: driver.vehicle_model ?? "",
    vehicle_year: driver.vehicle_year?.toString() ?? "",
    plate: driver.plate ?? "",
    capacity: driver.capacity ?? "",
    compartments: driver.compartments ?? "",
    city: driver.city ?? "",
    state: driver.state ?? "",
    notes: driver.notes ?? "",
  });
  const updateField = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const save = async () => {
    await onSave({
      full_name: form.full_name,
      cpf: form.cpf || null,
      email: form.email || null,
      phone: form.phone || null,
      cnh: form.cnh || null,
      cnh_category: form.cnh_category || null,
      cnh_expires_at: form.cnh_expires_at || null,
      vehicle_model: form.vehicle_model || null,
      vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : null,
      plate: form.plate || null,
      capacity: form.capacity || null,
      compartments: form.compartments || null,
      city: form.city || null,
      state: form.state || null,
      notes: form.notes || null,
    });
    setEditing(false);
  };

  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <View style={styles.dataHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.dataHeaderCopy}>
            <Text style={styles.dataEyebrow}>PERFIL</Text>
            <Text style={styles.dataTitle}>Dados do motorista</Text>
          </View>
          {!editing ? (
            <TouchableOpacity
              onPress={() => setEditing(true)}
              style={styles.headerAction}
            >
              <Text style={styles.headerActionText}>Editar</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setEditing(false)}
                style={styles.headerAction}
              >
                <Text style={styles.headerActionText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={saving}
                onPress={() => void save()}
                style={styles.headerActionPrimary}
              >
                {saving ? (
                  <ActivityIndicator color="#07399f" />
                ) : (
                  <Text style={styles.headerActionPrimaryText}>Salvar</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.profileHero}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {driver.full_name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileHeroCopy}>
            <Text style={styles.profileName}>{driver.full_name}</Text>
            <Text style={styles.profileRole}>MOTORISTA ACNETO</Text>
          </View>
        </View>

        <Text style={styles.dataSectionLabel}>DADOS PESSOAIS</Text>
        <View style={styles.dataCard}>
          <EditableRow
            label="Nome completo"
            value={form.full_name}
            editing={editing}
            onChange={(value) => updateField("full_name", value)}
          />
          <EditableRow
            label="CPF"
            value={form.cpf}
            editing={editing}
            onChange={(value) => updateField("cpf", value)}
          />
          <EditableRow
            label="E-mail"
            value={form.email}
            editing={editing}
            onChange={(value) => updateField("email", value)}
            keyboardType="email-address"
          />
          <EditableRow
            label="Telefone"
            value={form.phone}
            editing={editing}
            onChange={(value) => updateField("phone", value)}
            keyboardType="phone-pad"
          />
          <EditableRow
            label="CNH"
            value={form.cnh}
            editing={editing}
            onChange={(value) => updateField("cnh", value)}
          />
          <EditableRow
            label="Categoria da CNH"
            value={form.cnh_category}
            editing={editing}
            onChange={(value) => updateField("cnh_category", value)}
          />
          <EditableRow
            label="Validade da CNH"
            value={form.cnh_expires_at}
            editing={editing}
            onChange={(value) => updateField("cnh_expires_at", value)}
          />
        </View>

        <Text style={styles.dataSectionLabel}>VÍNCULO PROFISSIONAL</Text>
        <View style={styles.dataCard}>
          <DataRow
            label="Tipo"
            value={
              driver.employment_type === "carrier"
                ? "Motorista de transportadora"
                : "Autônomo"
            }
          />
          {driver.employment_type === "carrier" && (
            <DataRow
              label="Transportadora"
              value={
                driver.carrier?.name ??
                driver.carrier?.legal_name ??
                "Não informada"
              }
            />
          )}
        </View>

        <Text style={styles.dataSectionLabel}>LOCALIZAÇÃO</Text>
        <View style={styles.dataCard}>
          <EditableRow
            label="Cidade"
            value={form.city}
            editing={editing}
            onChange={(value) => updateField("city", value)}
          />
          <EditableRow
            label="Estado (UF)"
            value={form.state}
            editing={editing}
            onChange={(value) => updateField("state", value)}
          />
          <DataRow
            label="Status"
            value={statusLabels[driver.status] ?? driver.status}
            accent={driver.is_online}
          />
        </View>

        <Text style={styles.dataSectionLabel}>VEÍCULO</Text>
        <View style={styles.dataCard}>
          <EditableRow
            label="Modelo"
            value={form.vehicle_model}
            editing={editing}
            onChange={(value) => updateField("vehicle_model", value)}
          />
          <EditableRow
            label="Ano"
            value={form.vehicle_year}
            editing={editing}
            onChange={(value) => updateField("vehicle_year", value)}
            keyboardType="numeric"
          />
          <EditableRow
            label="Placa"
            value={form.plate}
            editing={editing}
            onChange={(value) => updateField("plate", value)}
          />
          <EditableRow
            label="Capacidade"
            value={form.capacity}
            editing={editing}
            onChange={(value) => updateField("capacity", value)}
          />
          <EditableRow
            label="Compartimentos"
            value={form.compartments}
            editing={editing}
            onChange={(value) => updateField("compartments", value)}
          />
          <EditableRow
            label="Observações"
            value={form.notes}
            editing={editing}
            onChange={(value) => updateField("notes", value)}
            multiline
          />
        </View>
      </ScrollView>
      <MobileBottomNav screen="driver-data" onNavigate={onNavigate} />
    </SafeAreaView>
  );
}

function DataRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataRowLabel}>{label}</Text>
      <Text style={[styles.dataRowValue, accent && styles.dataRowAccent]}>
        {value}
      </Text>
    </View>
  );
}

function EditableRow({
  label,
  value,
  editing,
  onChange,
  keyboardType = "default",
  multiline = false,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
  multiline?: boolean;
}) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataRowLabel}>{label}</Text>
      {editing ? (
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          multiline={multiline}
          placeholderTextColor="#6f9bdc"
          style={[styles.dataInput, multiline && styles.dataInputMultiline]}
        />
      ) : (
        <Text style={styles.dataRowValue}>{value || "Não informado"}</Text>
      )}
    </View>
  );
}

function VehicleScreen({
  driver,
  onBack,
  onNavigate,
}: {
  driver: Driver;
  onBack: () => void;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader title="Dados do veículo" onBack={onBack} />
        <Text style={styles.dataSectionLabel}>INFORMAÇÕES DO VEÍCULO</Text>
        <View style={styles.dataCard}>
          <DataRow label="Placa" value={driver.plate || "Não informada"} />
          <DataRow
            label="Tipo do veículo"
            value={driver.vehicle_model || "Não informado"}
          />
          <DataRow
            label="Capacidade (litros)"
            value={driver.capacity || "Não informada"}
          />
          <DataRow
            label="Compartimentos"
            value={driver.compartments || "Não informado"}
          />
          <DataRow
            label="Observações"
            value={driver.notes || "Nenhuma observação"}
          />
        </View>
      </ScrollView>
      <MobileBottomNav screen="vehicle" onNavigate={onNavigate} />
    </SafeAreaView>
  );
}

function DataScreenHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.dataHeader}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>‹</Text>
      </TouchableOpacity>
      <View style={styles.dataHeaderCopy}>
        <Text style={styles.dataEyebrow}>NEXT DRIVER</Text>
        <Text style={styles.dataTitle}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07399f" },
  safeLight: { flex: 1, backgroundColor: "#07399f" },
  loading: {
    alignItems: "center",
    backgroundColor: "#07399f",
    flex: 1,
    justifyContent: "center",
  },
  loginTop: { paddingHorizontal: 25, paddingTop: 38, paddingBottom: 20 },
  logo: { alignSelf: "center", height: 92, marginBottom: 8, width: 170 },
  eyebrow: {
    color: "#f3d32e",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 18,
  },
  eyebrowDark: {
    color: "#0e4db7",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  loginTitle: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 10 },
  loginSubtitle: {
    color: "#8eb6ff",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  loginCard: {
    backgroundColor: "#07399f",
    flex: 1,
    padding: 25,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 18,
  },
  input: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 2,
    borderWidth: 1,
    color: "#fff",
    fontSize: 15,
    marginBottom: 12,
    paddingHorizontal: 15,
    paddingVertical: 15,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#fff000",
    borderRadius: 2,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  primaryButtonText: {
    color: "#07399f",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  hint: { color: "#6f9bdc", fontSize: 9, marginTop: 18, textAlign: "center" },
  home: {
    alignSelf: "center",
    maxWidth: 720,
    padding: 18,
    paddingBottom: 112,
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  greeting: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 6 },
  profileLink: {
    color: "#8eb6ff",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
  },
  logoutButton: {
    borderColor: "#2251ad",
    borderRadius: 2,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  logoutText: { color: "#8eb6ff", fontSize: 12, fontWeight: "700" },
  statusPanel: { backgroundColor: "#062c83", borderRadius: 2, padding: 18 },
  statusOnline: { backgroundColor: "#062c83" },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusLabel: {
    color: "#6f9bdc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  statusValue: {
    color: "#fff000",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 8,
  },
  statusDescription: {
    color: "#8eb6ff",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: 250,
  },
  locationCard: {
    alignItems: "center",
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 2,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 16,
    padding: 17,
  },
  locationIcon: {
    alignItems: "center",
    backgroundColor: "#07399f",
    borderRadius: 28,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  locationIconText: { color: "#fff000", fontSize: 11, fontWeight: "900" },
  locationContent: { flex: 1, marginLeft: 14 },
  sectionLabel: {
    color: "#8eb6ff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  locationCity: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  coordinates: { color: "#6f9bdc", fontSize: 11, marginTop: 4 },
  liveText: { color: "#fff000", fontSize: 11, fontWeight: "700", marginTop: 8 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  quickGrid: { flexDirection: "row", gap: 10, marginTop: 16 },
  quickCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    flex: 1,
    minHeight: 96,
    padding: 14,
  },
  quickIcon: { color: "#fff000", fontSize: 20, fontWeight: "900" },
  quickTitle: { color: "#fff", fontSize: 14, fontWeight: "900", marginTop: 7 },
  quickSubtitle: { color: "#6f9bdc", fontSize: 9, marginTop: 4 },
  availabilityHero: {
    alignItems: "center",
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    minHeight: 260,
    padding: 20,
  },
  availabilityActive: { backgroundColor: "#062c83" },
  availabilityRing: {
    alignItems: "center",
    borderColor: "#1749a9",
    borderRadius: 58,
    borderWidth: 5,
    height: 116,
    justifyContent: "center",
    width: 116,
  },
  availabilityBusy: { borderColor: "#3468c5" },
  availabilityCore: {
    alignItems: "center",
    borderColor: "#3767be",
    borderRadius: 43,
    borderWidth: 1,
    height: 86,
    justifyContent: "center",
    width: 86,
  },
  availabilityCoreActive: {
    backgroundColor: "#fff000",
    borderColor: "#fff000",
  },
  availabilityCoreLoading: {
    backgroundColor: "#1648a4",
    borderColor: "#4a78ce",
  },
  availabilityPin: { color: "#fff000", fontSize: 27, lineHeight: 27 },
  availabilityPinActive: { color: "#07399f" },
  availabilityHint: {
    color: "#8eb6ff",
    fontSize: 7,
    fontWeight: "800",
    marginTop: 4,
  },
  availabilityHintActive: { color: "#07399f" },
  availabilityTitle: {
    color: "#fff000",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 17,
  },
  availabilityDescription: { color: "#6f9bdc", fontSize: 10, marginTop: 5 },
  availabilityLocation: {
    color: "#fff000",
    fontSize: 10,
    marginTop: 16,
    textAlign: "center",
  },
  availabilityForm: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  availabilityFormTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
  },
  availabilityInput: {
    backgroundColor: "#07399f",
    borderColor: "#4274cf",
    borderWidth: 1,
    color: "#fff",
    fontSize: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  availabilityInputRow: { flexDirection: "row", gap: 8 },
  availabilityInputHalf: { flex: 1 },
  availabilityActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  availabilityCancelButton: {
    alignItems: "center",
    borderColor: "#4274cf",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  availabilityCancelText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  availabilityConfirmButton: {
    alignItems: "center",
    backgroundColor: "#fff000",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  availabilityConfirmText: {
    color: "#07399f",
    fontSize: 12,
    fontWeight: "900",
  },
  statusListCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
  },
  statusListTitle: {
    color: "#6f9bdc",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginBottom: 9,
  },
  statusOption: {
    alignItems: "center",
    borderColor: "#1749a9",
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 7,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  statusOptionActive: { backgroundColor: "#183e83", borderColor: "#fff000" },
  statusOptionDisabled: { opacity: 0.55 },
  statusDot: { borderRadius: 5, height: 8, width: 8 },
  statusOptionText: {
    color: "#8eb6ff",
    flex: 1,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginLeft: 10,
  },
  statusCheck: { color: "#fff000", fontSize: 16, fontWeight: "900" },
  mobileBottomNav: {
    backgroundColor: "#f8fafc",
    borderTopColor: "#dbe4f0",
    borderTopWidth: 1,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 0,
    elevation: 12,
    paddingBottom: 10,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
  mobileNavItem: {
    alignItems: "center",
    flex: 1,
    minHeight: 42,
    paddingVertical: 3,
  },
  mobileNavIcon: { color: "#94a3b8", fontSize: 22, lineHeight: 24 },
  mobileNavLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  mobileNavActive: { color: "#1052c7" },
  stat: {
    backgroundColor: "#fff",
    borderColor: "#e1eae8",
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 84,
    padding: 14,
  },
  statLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statValue: {
    color: "#12343b",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 9,
  },
  infoCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 2,
    borderWidth: 1,
    marginTop: 16,
    padding: 18,
  },
  infoText: { color: "#8eb6ff", fontSize: 12, lineHeight: 19 },
  settingsButton: {
    borderColor: "#4274cf",
    borderRadius: 2,
    borderWidth: 1,
    marginTop: 15,
    padding: 12,
  },
  settingsButtonText: {
    color: "#fff000",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  settingsAction: {
    backgroundColor: "#07399f",
    borderColor: "#4274cf",
    borderRadius: 3,
    borderWidth: 1,
    padding: 14,
  },
  settingsActionText: {
    color: "#fff000",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  settingsInfo: {
    color: "#8eb6ff",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  dataSafe: { backgroundColor: "#07399f", flex: 1 },
  dataScreen: {
    alignSelf: "center",
    maxWidth: 720,
    padding: 22,
    paddingBottom: 112,
    width: "100%",
  },
  dataHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 26,
  },
  backButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  backButtonText: {
    color: "#b9d5ff",
    fontSize: 34,
    fontWeight: "300",
    lineHeight: 34,
  },
  dataHeaderCopy: { marginLeft: 4 },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginLeft: "auto",
  },
  headerAction: {
    borderColor: "#4274cf",
    borderRadius: 3,
    borderWidth: 1,
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerActionText: { color: "#b9d5ff", fontSize: 11, fontWeight: "800" },
  headerActionPrimary: {
    backgroundColor: "#fff000",
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerActionPrimaryText: {
    color: "#07399f",
    fontSize: 11,
    fontWeight: "900",
  },
  dataEyebrow: {
    color: "#8eb6ff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  dataTitle: { color: "#fff", fontSize: 23, fontWeight: "800", marginTop: 3 },
  profileHero: {
    alignItems: "center",
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 3,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 24,
    padding: 18,
  },
  profileAvatar: {
    alignItems: "center",
    backgroundColor: "#fff000",
    borderRadius: 30,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  profileAvatarText: { color: "#07399f", fontSize: 25, fontWeight: "900" },
  profileHeroCopy: { marginLeft: 15 },
  profileName: { color: "#fff", fontSize: 17, fontWeight: "800" },
  profileRole: {
    color: "#8eb6ff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 5,
  },
  dataSectionLabel: {
    color: "#8eb6ff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 8,
    marginTop: 16,
  },
  dataCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 3,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  negotiationCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 3,
    borderWidth: 1,
    marginBottom: 12,
    padding: 15,
  },
  negotiationHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  negotiationTitle: { color: "#fff", flex: 1, fontSize: 15, fontWeight: "800" },
  negotiationStatus: { color: "#fff000", fontSize: 10, fontWeight: "800" },
  negotiationRoute: { color: "#b9d5ff", fontSize: 13, marginTop: 5 },
  negotiationDetail: { color: "#8eb6ff", fontSize: 11, marginTop: 10 },
  negotiationValue: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "900",
    marginTop: 10,
  },
  freightStartButton: {
    backgroundColor: "#2563eb",
    borderRadius: 3,
    marginTop: 12,
    padding: 12,
  },
  freightArriveButton: {
    backgroundColor: "#d97706",
    borderRadius: 3,
    marginTop: 12,
    padding: 12,
  },
  freightFinishButton: {
    backgroundColor: "#16a34a",
    borderRadius: 3,
    marginTop: 12,
    padding: 12,
  },
  freightStartButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  freightActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  negotiationMessage: {
    backgroundColor: "#07399f",
    color: "#dbeafe",
    fontSize: 12,
    marginTop: 8,
    padding: 9,
  },
  negotiationActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  acceptButton: {
    backgroundColor: "#16a34a",
    borderRadius: 3,
    flex: 1,
    padding: 12,
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  rejectButton: {
    borderColor: "#f87171",
    borderRadius: 3,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  rejectButtonText: {
    color: "#fecaca",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  offerRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  offerInput: {
    backgroundColor: "#07399f",
    borderColor: "#4274cf",
    borderRadius: 3,
    borderWidth: 1,
    color: "#fff",
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  offerButton: {
    backgroundColor: "#fff000",
    borderRadius: 3,
    justifyContent: "center",
    paddingHorizontal: 13,
  },
  offerButtonText: { color: "#07399f", fontSize: 11, fontWeight: "900" },
  dataRow: {
    borderBottomColor: "#1b499f",
    borderBottomWidth: 1,
    paddingVertical: 14,
  },
  dataRowLabel: {
    color: "#6f9bdc",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dataRowValue: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  dataInput: {
    backgroundColor: "#07399f",
    borderColor: "#4274cf",
    borderRadius: 3,
    borderWidth: 1,
    color: "#fff",
    fontSize: 15,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  dataInputMultiline: { minHeight: 76, textAlignVertical: "top" },
  walletSummary: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 3,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  walletEntry: {
    alignItems: "stretch",
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderRadius: 3,
    borderWidth: 1,
    flexDirection: "column",
    marginBottom: 10,
    padding: 14,
  },
  walletEntryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  walletEntryCopy: { flex: 1, marginRight: 10 },
  walletEntryRoute: { color: "#fff", fontSize: 13, fontWeight: "800" },
  walletEntryDate: { color: "#8eb6ff", fontSize: 10, marginTop: 5 },
  walletEntryAmount: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
  },
  walletEntryStatus: {
    color: "#fff000",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "right",
  },
  walletDetails: {
    borderTopColor: "#1b499f",
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
    width: "100%",
  },
  walletProofLink: {
    color: "#b9d5ff",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
  },
  dataRowAccent: { color: "#fff000" },
  historyCard: {
    alignItems: "center",
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 10,
    padding: 14,
  },
  historyDot: { borderRadius: 6, height: 12, width: 12 },
  historyCopy: { flex: 1, marginLeft: 12 },
  historyStatus: { color: "#fff", fontSize: 11, fontWeight: "900" },
  historyPlace: { color: "#8eb6ff", fontSize: 11, marginTop: 5 },
  historyTime: { color: "#6f9bdc", fontSize: 10 },
});
