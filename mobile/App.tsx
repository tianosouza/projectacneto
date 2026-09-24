import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import * as TaskManager from "expo-task-manager";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from "react-native";

type MobileScreen =
  | "home"
  | "driver-data"
  | "vehicle"
  | "history"
  | "negotiations"
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
  availability_city?: string | null;
  availability_at?: string | null;
};

type MobileNegotiation = {
  id: string;
  collection_point: { name: string } | null;
  final_customer: { name: string } | null;
  cargo: string | null;
  product: string | null;
  quantity: string | null;
  distance_km: number | null;
  price_per_km: number | null;
  current_value: number;
  status: string;
  offers: Array<{ id: string; amount: number; message: string | null }>;
  messages: Array<{ id: string; body: string; created_at: string }>;
};

const statusLabels: Record<string, string> = {
  available: "Disponível",
  awaiting_loading: "Aguardando carregamento",
  awaiting_documents: "Aguardando documentação",
  in_transit: "Frete em andamento",
  awaiting_unloading: "Aguardando descarga",
  in_negotiation: "Em negociação",
  offline: "Não disponível",
  pending: "Nova oferta",
  countered: "Contraproposta",
  accepted: "Aceita - aguardando início",
  at_collection: "Chegou ao posto de coleta",
  driver_completed: "Aguardando conferência da operação",
  completed: "Frete finalizado",
};

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatMoneyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits
    ? (Number(digits) / 100).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
      })
    : "";
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
  const [nextAvailabilityPrompt, setNextAvailabilityPrompt] = useState(false);
  const [negotiations, setNegotiations] = useState<MobileNegotiation[]>([]);
  const [walletPreview, setWalletPreview] = useState<{
    total: number;
    pending: number;
    completed_freights: number;
  } | null>(null);

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

  async function refreshNegotiations() {
    if (!token) return;
    try {
      const response = await apiFetch("/api/negotiations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        negotiations: MobileNegotiation[];
      };
      setNegotiations(body.negotiations);
      await AsyncStorage.setItem(
        "acneto-negotiations",
        JSON.stringify(body.negotiations),
      );
    } catch {
      // O cache local continua disponível quando a API estiver indisponível.
    }
  }

  useEffect(() => {
    if (!token) return;
    void AsyncStorage.getItem("acneto-negotiations").then((saved) => {
      if (saved) setNegotiations(JSON.parse(saved) as MobileNegotiation[]);
    });
    void refreshNegotiations();
    const refreshTimer = setInterval(() => void refreshNegotiations(), 2000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshNegotiations();
    });
    return () => {
      clearInterval(refreshTimer);
      subscription.remove();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const loadWalletPreview = async () => {
      const response = await apiFetch("/api/drivers/me/wallet", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const body = (await response.json()) as {
          summary: typeof walletPreview;
        };
        setWalletPreview(body.summary);
      }
    };
    void loadWalletPreview();
    const timer = setInterval(() => void loadWalletPreview(), 10000);
    return () => clearInterval(timer);
  }, [token]);

  async function negotiationAction(
    negotiationId: string,
    action: "accept" | "reject",
  ) {
    if (!token) return;
    const response = await apiFetch(
      `/api/negotiations/${negotiationId}/${action}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      Alert.alert(
        "Negociação",
        body.error ?? "Não foi possível atualizar a negociação.",
      );
      return;
    }
    const driverResponse = await apiFetch("/api/drivers/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driverResponse.ok) {
      const body = (await driverResponse.json()) as { driver: Driver };
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    }
    await refreshNegotiations();
  }

  async function saveNextAvailability(availability: {
    city: string;
    date: string;
    time: string;
  }) {
    if (!driver || !token) return;
    const availabilityAt = new Date(
      `${availability.date}T${availability.time}:00`,
    ).toISOString();
    const response = await apiFetch("/api/drivers/me/status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        isOnline: driver.is_online,
        status: driver.status,
        notes: driver.notes,
        availabilityCity: availability.city,
        availabilityAt,
      }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      Alert.alert(
        "Próxima disponibilidade",
        body.error ?? "Não foi possível salvar o próximo ponto.",
      );
      return;
    }
    const body = (await response.json()) as { driver: Driver };
    setDriver(body.driver);
    await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    setNextAvailabilityPrompt(false);
  }

  async function sendNegotiationOffer(negotiationId: string, amount: number) {
    if (!token || !Number.isFinite(amount) || amount <= 0) return;
    const response = await apiFetch(
      `/api/negotiations/${negotiationId}/offer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      Alert.alert(
        "Negociação",
        body.error ?? "Não foi possível enviar a contraproposta.",
      );
      return;
    }
    await refreshNegotiations();
  }

  async function sendNegotiationMessage(negotiationId: string, body: string) {
    if (!token || !body.trim()) return;
    const response = await apiFetch(
      `/api/negotiations/${negotiationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: body.trim() }),
      },
    );
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      Alert.alert(
        "Negociação",
        result.error ?? "Não foi possível enviar a mensagem.",
      );
      return;
    }
    await refreshNegotiations();
  }

  async function openPaymentProof(data: string, name: string) {
    try {
      const base64 = data.split(",")[1] ?? data;
      const safeName = name.replace(/[^a-z0-9._-]/gi, "_");
      const uri = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: "Comprovante de pagamento",
        });
      } else {
        await Linking.openURL(uri);
      }
    } catch {
      Alert.alert(
        "Comprovante",
        "Não foi possível abrir o comprovante neste dispositivo.",
      );
    }
  }

  async function freightStep(
    negotiationId: string,
    step: "start" | "depart" | "arrive" | "finish",
  ) {
    if (!token) return;
    const response = await apiFetch(
      `/api/negotiations/${negotiationId}/freight/${step}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      Alert.alert("Frete", body.error ?? "Não foi possível atualizar o frete.");
      return;
    }
    const driverResponse = await apiFetch("/api/drivers/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driverResponse.ok) {
      const body = (await driverResponse.json()) as { driver: Driver };
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    }
    await refreshNegotiations();
    if (step === "finish") setNextAvailabilityPrompt(true);
  }

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
    availability?: { city: string; date: string; time: string },
  ) {
    if (!driver || !token) return;
    setSubmitting(true);
    try {
      if (value) setTrackingMode(await startLocationTracking());
      else {
        await stopLocationTracking();
        setTrackingMode(null);
      }
      const status = value ? "available" : "offline";
      const availabilityAt = availability
        ? new Date(`${availability.date}T${availability.time}:00`).toISOString()
        : undefined;
      const response = await apiFetch("/api/drivers/me/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isOnline: value,
          status,
          availabilityCity: availability?.city,
          availabilityAt,
        }),
      });
      if (!response.ok)
        throw new Error("Não foi possível atualizar seu status.");
      const body = (await response.json()) as { driver: Driver };
      setDriver(body.driver);
      await AsyncStorage.setItem(DRIVER_KEY, JSON.stringify(body.driver));
    } catch (error) {
      Alert.alert("Localização necessária", (error as Error).message);
      if (value) await stopLocationTracking().catch(() => undefined);
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

  if (screen === "history") {
    return (
      <WalletScreen
        token={token}
        onBack={() => setScreen("home")}
        onNavigate={(nextScreen) => setScreen(nextScreen)}
        onOpenProof={openPaymentProof}
      />
    );
  }

  if (screen === "negotiations") {
    return (
      <NegotiationsScreen
        negotiations={negotiations}
        onBack={() => setScreen("home")}
        onAccept={(id) => void negotiationAction(id, "accept")}
        onReject={(id) => void negotiationAction(id, "reject")}
        onOffer={(id, amount) => void sendNegotiationOffer(id, amount)}
        onMessage={(id, body) => void sendNegotiationMessage(id, body)}
        onFreightStep={(id, step) => void freightStep(id, step)}
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
    <DriverHome
      driver={driver}
      trackingMode={trackingMode}
      submitting={submitting}
      onToggle={toggleOnline}
      nextAvailabilityPrompt={nextAvailabilityPrompt}
      onSaveAvailability={(availability) =>
        void saveNextAvailability(availability)
      }
      onLogout={logout}
      onOpenDriverData={() => setScreen("driver-data")}
      onOpenVehicle={() => setScreen("vehicle")}
      onOpenHistory={() => setScreen("history")}
      onOpenNegotiations={() => setScreen("negotiations")}
      onStatusChange={(status) => void updateDriverStatus(status)}
      onNavigateScreen={(nextScreen) => setScreen(nextScreen)}
      pendingNegotiations={
        negotiations.filter((item) => item.status === "pending").length
      }
      walletPreview={walletPreview}
    />
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
        <Image source={require("./assets/logo.png")} style={styles.logo} />
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
  trackingMode,
  submitting,
  onToggle,
  nextAvailabilityPrompt,
  onSaveAvailability,
  onLogout,
  onOpenDriverData,
  onOpenVehicle,
  onOpenHistory,
  onOpenNegotiations,
  onStatusChange,
  onNavigateScreen,
  pendingNegotiations,
  walletPreview,
}: {
  driver: Driver;
  trackingMode: "background" | "foreground" | null;
  submitting: boolean;
  onToggle: (
    value: boolean,
    availability?: { city: string; date: string; time: string },
  ) => void;
  nextAvailabilityPrompt: boolean;
  onSaveAvailability: (availability: {
    city: string;
    date: string;
    time: string;
  }) => void;
  onLogout: () => void;
  onOpenDriverData: () => void;
  onOpenVehicle: () => void;
  onOpenHistory: () => void;
  onOpenNegotiations: () => void;
  onStatusChange: (status: string) => void;
  onNavigateScreen: (screen: MobileScreen) => void;
  pendingNegotiations: number;
  walletPreview: {
    total: number;
    pending: number;
    completed_freights: number;
  } | null;
}) {
  const insets = useSafeAreaInsets();
  const [availabilityFormOpen, setAvailabilityFormOpen] = useState(false);
  useEffect(() => {
    if (nextAvailabilityPrompt) setAvailabilityFormOpen(true);
  }, [nextAvailabilityPrompt]);
  const [availabilityCity, setAvailabilityCity] = useState(
    driver.availability_city ?? driver.city ?? "",
  );
  const [availabilityDate, setAvailabilityDate] = useState(
    driver.availability_at?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
  );
  const [availabilityTime, setAvailabilityTime] = useState(
    driver.availability_at?.slice(11, 16) ??
      new Date().toTimeString().slice(0, 5),
  );
  const coordinates =
    driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`
      : "Aguardando primeira posição";

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
            if (driver.is_online) onToggle(false);
            else setAvailabilityFormOpen(true);
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
                ? "ONLINE"
                : "NÃO DISPONÍVEL"}
          </Text>
          <Text style={styles.availabilityDescription}>
            {driver.is_online
              ? "Motorista online e visível para a central de vendas"
              : "Motorista não disponível e oculto do painel do operador"}
          </Text>
          <Text style={styles.availabilityLocation}>
            ● {driver.city || "Localização aguardando GPS"}
            {driver.state ? `, ${driver.state}` : ""}
            {driver.latitude !== null && driver.longitude !== null
              ? ` — ${coordinates}`
              : ""}
          </Text>
        </TouchableOpacity>

        {availabilityFormOpen &&
          (!driver.is_online || nextAvailabilityPrompt) && (
            <View style={styles.availabilityFormCard}>
              <Text style={styles.statusListTitle}>
                {nextAvailabilityPrompt
                  ? "QUAL SERÁ O PRÓXIMO PONTO?"
                  : "ONDE E QUANDO ESTARÁ DISPONÍVEL?"}
              </Text>
              <Text style={styles.availabilityFormHint}>
                Informe cidade, data e hora para a central poder vender o
                próximo frete antes da sua chegada.
              </Text>
              <TextInput
                value={availabilityCity}
                onChangeText={setAvailabilityCity}
                placeholder="Cidade prevista"
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />
              <View style={styles.availabilityFormRow}>
                <TextInput
                  value={availabilityDate}
                  onChangeText={setAvailabilityDate}
                  placeholder="Data (AAAA-MM-DD)"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, styles.availabilityFormHalf]}
                />
                <TextInput
                  value={availabilityTime}
                  onChangeText={setAvailabilityTime}
                  placeholder="Hora (HH:MM)"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, styles.availabilityFormHalf]}
                />
              </View>
              <View style={styles.availabilityFormActions}>
                <TouchableOpacity
                  onPress={() => setAvailabilityFormOpen(false)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={submitting}
                  onPress={() => {
                    if (
                      !availabilityCity.trim() ||
                      !/^\d{4}-\d{2}-\d{2}$/.test(availabilityDate) ||
                      !/^\d{2}:\d{2}$/.test(availabilityTime)
                    ) {
                      Alert.alert(
                        "Dados incompletos",
                        "Informe cidade, data e horário no formato indicado.",
                      );
                      return;
                    }
                    setAvailabilityFormOpen(false);
                    const availability = {
                      city: availabilityCity.trim(),
                      date: availabilityDate,
                      time: availabilityTime,
                    };
                    if (nextAvailabilityPrompt) {
                      onSaveAvailability(availability);
                    } else {
                      onToggle(true, availability);
                    }
                  }}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Ficar disponível</Text>
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
          <TouchableOpacity
            onPress={onOpenNegotiations}
            style={styles.quickCard}
          >
            <Text style={styles.quickIcon}>$</Text>
            <Text style={styles.quickTitle}>Negociações</Text>
            <Text style={styles.quickSubtitle}>
              {pendingNegotiations} proposta(s) pendente(s)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenVehicle} style={styles.quickCard}>
            <Text style={styles.quickIcon}>▣</Text>
            <Text style={styles.quickTitle}>Meu veículo</Text>
            <Text style={styles.quickSubtitle}>Dados e capacidade</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenHistory} style={styles.quickCard}>
            <Text style={styles.quickIcon}>▤</Text>
            <Text style={styles.quickTitle}>Histórico</Text>
            <Text style={styles.quickSubtitle}>
              {walletPreview?.completed_freights ?? 0} frete(s) concluído(s) ·{" "}
              {formatBRL(walletPreview?.pending ?? 0)} a receber
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <MobileBottomNav screen="home" onNavigate={onNavigateScreen} />
    </SafeAreaView>
  );
}

function NegotiationsScreen({
  negotiations,
  onBack,
  onAccept,
  onReject,
  onOffer,
  onMessage,
  onFreightStep,
  onNavigate,
}: {
  negotiations: MobileNegotiation[];
  onBack: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onOffer: (id: string, amount: number) => void;
  onMessage: (id: string, body: string) => void;
  onFreightStep: (
    id: string,
    step: "start" | "depart" | "arrive" | "finish",
  ) => void;
  onNavigate: (screen: MobileScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const [offerValues, setOfferValues] = useState<Record<string, string>>({});
  const [messageValues, setMessageValues] = useState<Record<string, string>>(
    {},
  );
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader title="Negociações" onBack={onBack} />
        {!negotiations.length ? (
          <View style={styles.dataCard}>
            <Text style={styles.infoText}>
              Nenhuma negociação disponível no momento.
            </Text>
          </View>
        ) : (
          negotiations.map((negotiation) => {
            const open =
              negotiation.status === "pending" ||
              negotiation.status === "countered";
            const conversationOpen = [
              "pending",
              "countered",
              "accepted",
              "in_transit",
              "at_collection",
              "driver_completed",
              "completed",
            ].includes(negotiation.status);
            return (
              <View key={negotiation.id} style={styles.negotiationCard}>
                <View style={styles.negotiationHeader}>
                  <Text style={styles.negotiationTitle}>
                    {negotiation.collection_point?.name ?? "Origem"}
                  </Text>
                  <Text style={styles.negotiationStatus}>
                    {statusLabels[negotiation.status] ?? negotiation.status}
                  </Text>
                </View>
                <Text style={styles.negotiationRoute}>
                  → {negotiation.final_customer?.name ?? "Destino"}
                </Text>
                <Text style={styles.negotiationDetail}>
                  {negotiation.product ??
                    negotiation.cargo ??
                    "Produto não informado"}{" "}
                  · {negotiation.quantity ?? "Quantidade não informada"}
                </Text>
                <Text style={styles.negotiationDetail}>
                  {negotiation.distance_km
                    ? `${negotiation.distance_km.toFixed(2)} km`
                    : "Distância não informada"}{" "}
                  ·{" "}
                  {negotiation.price_per_km
                    ? `${formatBRL(negotiation.price_per_km)}/km`
                    : "Tarifa não informada"}
                </Text>
                <Text style={styles.negotiationValue}>
                  {formatBRL(negotiation.current_value)}
                </Text>
                {negotiation.status === "accepted" && (
                  <TouchableOpacity
                    onPress={() => onFreightStep(negotiation.id, "start")}
                    style={styles.freightStartButton}
                  >
                    <Text style={styles.freightStartButtonText}>
                      Iniciar frete
                    </Text>
                  </TouchableOpacity>
                )}
                {negotiation.status === "awaiting_loading" && (
                  <TouchableOpacity
                    onPress={() => onFreightStep(negotiation.id, "depart")}
                    style={styles.freightArriveButton}
                  >
                    <Text style={styles.freightActionText}>
                      Carregamento realizado e iniciar viagem
                    </Text>
                  </TouchableOpacity>
                )}
                {negotiation.status === "in_transit" && (
                  <TouchableOpacity
                    onPress={() => onFreightStep(negotiation.id, "finish")}
                    style={styles.freightFinishButton}
                  >
                    <Text style={styles.freightActionText}>
                      Finalizar viagem e enviar para conferência
                    </Text>
                  </TouchableOpacity>
                )}
                {negotiation.messages.map((item) => (
                  <Text key={item.id} style={styles.negotiationMessage}>
                    {item.body}
                  </Text>
                ))}
                {open && (
                  <View style={styles.offerRow}>
                    <TextInput
                      placeholder="Mensagem para a operação"
                      placeholderTextColor="#6f9bdc"
                      value={messageValues[negotiation.id] ?? ""}
                      onChangeText={(value) =>
                        setMessageValues((current) => ({
                          ...current,
                          [negotiation.id]: value,
                        }))
                      }
                      style={styles.offerInput}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        onMessage(
                          negotiation.id,
                          messageValues[negotiation.id] ?? "",
                        );
                        setMessageValues((current) => ({
                          ...current,
                          [negotiation.id]: "",
                        }));
                      }}
                      style={styles.offerButton}
                    >
                      <Text style={styles.offerButtonText}>Enviar</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {conversationOpen && !open && (
                  <View style={styles.offerRow}>
                    <TextInput
                      placeholder="Mensagem para a operação"
                      placeholderTextColor="#6f9bdc"
                      value={messageValues[negotiation.id] ?? ""}
                      onChangeText={(value) =>
                        setMessageValues((current) => ({
                          ...current,
                          [negotiation.id]: value,
                        }))
                      }
                      style={styles.offerInput}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        onMessage(
                          negotiation.id,
                          messageValues[negotiation.id] ?? "",
                        );
                        setMessageValues((current) => ({
                          ...current,
                          [negotiation.id]: "",
                        }));
                      }}
                      style={styles.offerButton}
                    >
                      <Text style={styles.offerButtonText}>Enviar</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {open && (
                  <>
                    <View style={styles.negotiationActions}>
                      <TouchableOpacity
                        onPress={() => onAccept(negotiation.id)}
                        style={styles.acceptButton}
                      >
                        <Text style={styles.acceptButtonText}>Aceitar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onReject(negotiation.id)}
                        style={styles.rejectButton}
                      >
                        <Text style={styles.rejectButtonText}>Recusar</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.offerRow}>
                      <TextInput
                        keyboardType="decimal-pad"
                        placeholder="Contraproposta"
                        placeholderTextColor="#6f9bdc"
                        value={offerValues[negotiation.id] ?? ""}
                        onChangeText={(value) =>
                          setOfferValues((current) => ({
                            ...current,
                            [negotiation.id]: formatMoneyInput(value),
                          }))
                        }
                        style={styles.offerInput}
                      />
                      <TouchableOpacity
                        onPress={() =>
                          onOffer(
                            negotiation.id,
                            Number(
                              (offerValues[negotiation.id] ?? "")
                                .replace(/\./g, "")
                                .replace(",", "."),
                            ),
                          )
                        }
                        style={styles.offerButton}
                      >
                        <Text style={styles.offerButtonText}>Enviar</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      <MobileBottomNav screen="negotiations" onNavigate={onNavigate} />
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
    ["history", "◷", "Carteira"],
    ["negotiations", "♢", "Ofertas"],
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
            A localização e as negociações são sincronizadas com a operação
            quando o aplicativo está online.
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
            label="Disponibilidade"
            value={driver.is_online ? "Online" : "Não disponível"}
            accent={driver.is_online}
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
  const insets = useSafeAreaInsets();
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

function HistoryScreen({
  driver,
  onBack,
}: {
  driver: Driver;
  onBack: () => void;
}) {
  const status = statusLabels[driver.status] ?? driver.status;
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.dataScreen}>
        <DataScreenHeader title="Histórico de status" onBack={onBack} />
        <View style={styles.historyCard}>
          <View style={[styles.historyDot, { backgroundColor: "#fff000" }]} />
          <View style={styles.historyCopy}>
            <Text style={styles.historyStatus}>{status.toUpperCase()}</Text>
            <Text style={styles.historyPlace}>
              {driver.city || "Localização não informada"}
              {driver.state ? `, ${driver.state}` : ""}
            </Text>
          </View>
          <Text style={styles.historyTime}>Agora</Text>
        </View>
        <View style={styles.historyCard}>
          <View style={[styles.historyDot, { backgroundColor: "#6ccdf5" }]} />
          <View style={styles.historyCopy}>
            <Text style={styles.historyStatus}>LOCALIZAÇÃO</Text>
            <Text style={styles.historyPlace}>Última atualização GPS</Text>
          </View>
          <Text style={styles.historyTime}>
            {driver.last_seen
              ? new Date(driver.last_seen).toLocaleTimeString("pt-BR")
              : "--:--"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function WalletScreen({
  token,
  onBack,
  onNavigate,
  onOpenProof,
}: {
  token: string;
  onBack: () => void;
  onNavigate: (screen: MobileScreen) => void;
  onOpenProof: (data: string, name: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [wallet, setWallet] = useState<{
    summary: {
      total: number;
      pending: number;
      paid: number;
      completed_freights: number;
    };
    entries: Array<{
      id: string;
      amount: number;
      status: string;
      company?: { name?: string; legal_name?: string } | null;
      payment_proof_name?: string | null;
      payment_proof_data?: string | null;
      created_at: string;
      negotiation?: {
        collection_point?: { name?: string } | null;
        final_customer?: { name?: string } | null;
      } | null;
    }>;
  } | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch("/api/drivers/me/wallet", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok || !active) return;
        setWallet((await response.json()) as typeof wallet);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token]);

  const money = (value: number) =>
    `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={[
          styles.dataScreen,
          { paddingBottom: 112 + insets.bottom },
        ]}
      >
        <DataScreenHeader title="Minha carteira" onBack={onBack} />
        <View style={styles.walletSummary}>
          <DataRow
            label="Total concluído"
            value={money(wallet?.summary.total ?? 0)}
          />
          <DataRow
            label="A receber"
            value={money(wallet?.summary.pending ?? 0)}
            accent
          />
          <DataRow
            label="Fretes concluídos"
            value={String(wallet?.summary.completed_freights ?? 0)}
          />
        </View>
        <Text style={styles.dataSectionLabel}>FRETES CONCLUÍDOS</Text>
        {!wallet && <Text style={styles.infoText}>Carregando carteira...</Text>}
        {wallet?.entries.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            activeOpacity={0.8}
            onPress={() =>
              setSelectedEntryId((current) =>
                current === entry.id ? null : entry.id,
              )
            }
            style={styles.walletEntry}
          >
            <View style={styles.walletEntryHeader}>
              <View style={styles.walletEntryCopy}>
                <Text style={styles.walletEntryRoute}>
                  {entry.negotiation?.collection_point?.name ?? "Origem"} →{" "}
                  {entry.negotiation?.final_customer?.name ?? "Destino"}
                </Text>
                <Text style={styles.walletEntryDate}>
                  {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                </Text>
              </View>
              <View>
                <Text style={styles.walletEntryAmount}>
                  {money(entry.amount)}
                </Text>
                <Text style={styles.walletEntryStatus}>
                  {entry.status === "paid"
                    ? "Pago"
                    : entry.status === "approved"
                      ? "Pagamento aprovado"
                      : entry.status === "rejected"
                        ? "Devolvido para conferência"
                        : "Aguardando conferência"}
                </Text>
              </View>
            </View>
            {selectedEntryId === entry.id && (
              <View style={styles.walletDetails}>
                <Text style={styles.walletEntryDate}>
                  Empresa:{" "}
                  {entry.company?.name ??
                    entry.company?.legal_name ??
                    "Autônomo"}
                </Text>
                <Text style={styles.walletEntryDate}>
                  Status:{" "}
                  {entry.status === "paid"
                    ? "Pagamento realizado"
                    : "Aguardando pagamento"}
                </Text>
                {entry.status === "paid" &&
                  entry.payment_proof_name &&
                  entry.payment_proof_data && (
                    <TouchableOpacity
                      onPress={() => {
                        void onOpenProof(
                          entry.payment_proof_data!,
                          entry.payment_proof_name!,
                        );
                      }}
                    >
                      <Text style={styles.walletProofLink}>
                        Abrir comprovante: {entry.payment_proof_name}
                      </Text>
                    </TouchableOpacity>
                  )}
              </View>
            )}
          </TouchableOpacity>
        ))}
        {wallet?.entries.length === 0 && (
          <Text style={styles.infoText}>Nenhum frete concluído.</Text>
        )}
      </ScrollView>
      <MobileBottomNav screen="history" onNavigate={onNavigate} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.statValue}>
        {value}
      </Text>
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
  availabilityFormCard: {
    backgroundColor: "#062c83",
    borderColor: "#2251ad",
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  availabilityFormHint: {
    color: "#8eb6ff",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
    marginTop: 6,
  },
  availabilityFormRow: { flexDirection: "row", gap: 10 },
  availabilityFormHalf: { flex: 1 },
  availabilityFormActions: { flexDirection: "row", gap: 10 },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#2251ad",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 52,
  },
  secondaryButtonText: { color: "#8eb6ff", fontSize: 12, fontWeight: "800" },
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
