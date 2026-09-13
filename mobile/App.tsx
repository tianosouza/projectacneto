import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const LOCATION_TASK = "acneto-driver-location";
const TOKEN_KEY = "acneto-access-token";
const DRIVER_KEY = "acneto-driver";
let foregroundSubscription: Location.LocationSubscription | null = null;

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
  phone: string | null;
  city: string | null;
  state: string | null;
  is_online: boolean;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
  status: string;
  vehicle_model: string | null;
  plate: string | null;
  rating: number;
};

const statusLabels: Record<string, string> = {
  available: "Disponível",
  awaiting_loading: "Aguardando carregamento",
  awaiting_documents: "Aguardando documentação",
  in_transit: "Em trânsito",
  awaiting_unloading: "Aguardando descarga",
  in_negotiation: "Em negociação",
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

async function startLocationTracking(): Promise<"background" | "foreground"> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    throw new Error("Permissão de localização em primeiro plano negada.");
  }

  // Use the foreground watcher as the stable path. Starting the Android
  // background service immediately after the permission dialog can crash
  // some devices and leave a second native subscription behind.
  foregroundSubscription?.remove();
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 30_000,
      distanceInterval: 50,
    },
    (location) => void sendLocation(location),
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

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [trackingMode, setTrackingMode] = useState<
    "background" | "foreground" | null
  >(null);

  useEffect(() => {
    void restoreSession();
  }, []);

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

  async function toggleOnline(value: boolean) {
    if (!driver || !token) return;
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
        body: JSON.stringify({ isOnline: value, status }),
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

  async function logout() {
    await stopLocationTracking().catch(() => undefined);
    await AsyncStorage.multiRemove([TOKEN_KEY, DRIVER_KEY]);
    setToken(null);
    setDriver(null);
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

  return (
    <DriverHome
      driver={driver}
      trackingMode={trackingMode}
      submitting={submitting}
      onToggle={toggleOnline}
      onLogout={logout}
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
        <Text style={styles.hint}>
          API compartilhada com o frontend: {API_URL || "não configurada"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function DriverHome({
  driver,
  trackingMode,
  submitting,
  onToggle,
  onLogout,
}: {
  driver: Driver;
  trackingMode: "background" | "foreground" | null;
  submitting: boolean;
  onToggle: (value: boolean) => void;
  onLogout: () => void;
}) {
  const coordinates =
    driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`
      : "Aguardando primeira posição";

  return (
    <SafeAreaView style={styles.safeLight}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.home}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrowDark}>PAINEL DO MOTORISTA</Text>
            <Text style={styles.greeting}>
              Olá, {driver.full_name.split(" ")[0]}
            </Text>
          </View>
          <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[styles.statusPanel, driver.is_online && styles.statusOnline]}
        >
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.statusLabel}>STATUS DA OPERAÇÃO</Text>
              <Text style={styles.statusValue}>
                {driver.is_online ? "Você está online" : "Você está offline"}
              </Text>
              <Text style={styles.statusDescription}>
                {driver.is_online
                  ? trackingMode === "background"
                    ? "Sua posição continua sendo enviada em segundo plano."
                    : "Sua posição está sendo enviada enquanto o Expo Go está aberto."
                  : "Fique online para receber novas propostas."}
              </Text>
            </View>
            <Switch
              disabled={submitting}
              onValueChange={onToggle}
              thumbColor="#fff"
              trackColor={{ false: "#94a3b8", true: "#0e4db7" }}
              value={driver.is_online}
            />
          </View>
        </View>

        <View style={styles.locationCard}>
          <View style={styles.locationIcon}>
            <Text style={styles.locationIconText}>GPS</Text>
          </View>
          <View style={styles.locationContent}>
            <Text style={styles.sectionLabel}>LOCALIZAÇÃO ATUAL</Text>
            <Text style={styles.locationCity}>
              {driver.city ?? "Localização identificada pelo GPS"}
              {driver.state ? ` · ${driver.state}` : ""}
            </Text>
            <Text style={styles.coordinates}>{coordinates}</Text>
            <Text style={styles.liveText}>
              {trackingMode === "background"
                ? "● Rastreamento em segundo plano ativo"
                : trackingMode === "foreground"
                  ? "● Rastreamento ativo no Expo Go"
                  : "Rastreamento pausado"}
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <Stat
            label="Status"
            value={statusLabels[driver.status] ?? driver.status}
          />
          <Stat label="Avaliação" value={Number(driver.rating).toFixed(1)} />
          <Stat
            label="Veículo"
            value={driver.vehicle_model ?? "Não informado"}
          />
          <Stat label="Placa" value={driver.plate ?? "Não informada"} />
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Permissão de localização</Text>
          <Text style={styles.infoText}>
            No Expo Go, a localização é enviada enquanto ele estiver aberto.
            Para manter o GPS com a tela bloqueada ou outro app aberto, use um
            development build nativo da ACNETO.
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openSettings()}
            style={styles.settingsButton}
          >
            <Text style={styles.settingsButtonText}>
              Abrir configurações do celular
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: "#092f38" },
  safeLight: { flex: 1, backgroundColor: "#f4f7f6" },
  loading: {
    alignItems: "center",
    backgroundColor: "#f4f7f6",
    flex: 1,
    justifyContent: "center",
  },
  loginTop: { paddingHorizontal: 28, paddingTop: 48, paddingBottom: 32 },
  logo: { alignSelf: "center", height: 148, marginBottom: 12, width: "100%" },
  eyebrow: {
    color: "#f3d32e",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 36,
  },
  eyebrowDark: {
    color: "#0e4db7",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  loginTitle: { color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 12 },
  loginSubtitle: {
    color: "#b7d5d5",
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
  },
  loginCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flex: 1,
    padding: 28,
  },
  cardTitle: {
    color: "#12343b",
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 18,
  },
  input: {
    borderColor: "#d9e4e3",
    borderRadius: 13,
    borderWidth: 1,
    color: "#12343b",
    fontSize: 15,
    marginBottom: 12,
    paddingHorizontal: 15,
    paddingVertical: 15,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0e4db7",
    borderRadius: 13,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  hint: { color: "#94a3b8", fontSize: 10, marginTop: 18, textAlign: "center" },
  home: {
    alignSelf: "center",
    maxWidth: 720,
    padding: 22,
    paddingBottom: 42,
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  greeting: { color: "#12343b", fontSize: 27, fontWeight: "800", marginTop: 6 },
  logoutButton: {
    borderColor: "#d9e4e3",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  logoutText: { color: "#64748b", fontSize: 12, fontWeight: "700" },
  statusPanel: { backgroundColor: "#12343b", borderRadius: 22, padding: 22 },
  statusOnline: { backgroundColor: "#0e4db7" },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusLabel: {
    color: "#b7d5d5",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  statusValue: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8 },
  statusDescription: {
    color: "#d5eeee",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: 250,
  },
  locationCard: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#e1eae8",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 16,
    padding: 17,
  },
  locationIcon: {
    alignItems: "center",
    backgroundColor: "#e8f0ff",
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  locationIconText: { color: "#0e4db7", fontSize: 11, fontWeight: "900" },
  locationContent: { flex: 1, marginLeft: 14 },
  sectionLabel: {
    color: "#0e4db7",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  locationCity: {
    color: "#12343b",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  coordinates: { color: "#64748b", fontSize: 11, marginTop: 4 },
  liveText: { color: "#0e4db7", fontSize: 11, fontWeight: "700", marginTop: 8 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
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
    backgroundColor: "#eef4ff",
    borderRadius: 18,
    marginTop: 16,
    padding: 18,
  },
  infoText: { color: "#35605e", fontSize: 12, lineHeight: 19 },
  settingsButton: {
    borderColor: "#9ab8ed",
    borderRadius: 11,
    borderWidth: 1,
    marginTop: 15,
    padding: 12,
  },
  settingsButtonText: {
    color: "#0e4db7",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});
