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
  cpf?: string | null;
  email: string | null;
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
  capacity: string | null;
  compartments: string | null;
  notes?: string | null;
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
  const [screen, setScreen] = useState<
    "home" | "driver-data" | "vehicle" | "history"
  >("home");

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

  if (screen === "driver-data") {
    return (
      <DriverDataScreen driver={driver} onBack={() => setScreen("home")} />
    );
  }

  if (screen === "vehicle") {
    return <VehicleScreen driver={driver} onBack={() => setScreen("home")} />;
  }

  if (screen === "history") {
    return <HistoryScreen driver={driver} onBack={() => setScreen("home")} />;
  }

  return (
    <DriverHome
      driver={driver}
      trackingMode={trackingMode}
      submitting={submitting}
      onToggle={toggleOnline}
      onLogout={logout}
      onOpenDriverData={() => setScreen("driver-data")}
      onOpenVehicle={() => setScreen("vehicle")}
      onOpenHistory={() => setScreen("history")}
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
  onOpenDriverData,
  onOpenVehicle,
  onOpenHistory,
}: {
  driver: Driver;
  trackingMode: "background" | "foreground" | null;
  submitting: boolean;
  onToggle: (value: boolean) => void;
  onLogout: () => void;
  onOpenDriverData: () => void;
  onOpenVehicle: () => void;
  onOpenHistory: () => void;
}) {
  const coordinates =
    driver.latitude !== null && driver.longitude !== null
      ? `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`
      : "Aguardando primeira posição";

  return (
    <SafeAreaView style={styles.safeLight}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.home}>
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
          onPress={() => onToggle(!driver.is_online)}
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

        <View style={styles.statusListCard}>
          <Text style={styles.statusListTitle}>MEU STATUS ATUAL</Text>
          {[
            ["available", "DISPONÍVEL", "#fff000"],
            ["awaiting_loading", "AG. CARREGAMENTO", "#ffb347"],
            ["in_transit", "EM TRÂNSITO", "#6ccdf5"],
            ["awaiting_unloading", "AG. DESCARGA", "#d5a6ff"],
            ["maintenance", "MANUTENÇÃO", "#ff5d6c"],
          ].map(([value, label, color]) => (
            <View
              key={value}
              style={[
                styles.statusOption,
                driver.status === value && styles.statusOptionActive,
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: color }]} />
              <Text style={styles.statusOptionText}>{label}</Text>
              {driver.status === value && (
                <Text style={styles.statusCheck}>✓</Text>
              )}
            </View>
          ))}
        </View>

        <View style={styles.quickGrid}>
          <TouchableOpacity onPress={onOpenVehicle} style={styles.quickCard}>
            <Text style={styles.quickIcon}>▣</Text>
            <Text style={styles.quickTitle}>Meu veículo</Text>
            <Text style={styles.quickSubtitle}>Dados e capacidade</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenHistory} style={styles.quickCard}>
            <Text style={styles.quickIcon}>▤</Text>
            <Text style={styles.quickTitle}>Histórico</Text>
            <Text style={styles.quickSubtitle}>Últimas sinalizações</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function DriverDataScreen({
  driver,
  onBack,
}: {
  driver: Driver;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.dataScreen}>
        <View style={styles.dataHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.dataHeaderCopy}>
            <Text style={styles.dataEyebrow}>PERFIL</Text>
            <Text style={styles.dataTitle}>Dados do motorista</Text>
          </View>
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
          <DataRow label="Nome completo" value={driver.full_name} />
          <DataRow label="CPF" value={driver.cpf || "Não informado"} />
          <DataRow label="E-mail" value={driver.email || "Não informado"} />
          <DataRow label="Telefone" value={driver.phone || "Não informado"} />
        </View>

        <Text style={styles.dataSectionLabel}>LOCALIZAÇÃO</Text>
        <View style={styles.dataCard}>
          <DataRow
            label="Cidade"
            value={`${driver.city || "Não informada"}${driver.state ? ` · ${driver.state}` : ""}`}
          />
          <DataRow
            label="Status"
            value={statusLabels[driver.status] ?? driver.status}
            accent={driver.is_online}
          />
        </View>

        <Text style={styles.dataSectionLabel}>VEÍCULO</Text>
        <View style={styles.dataCard}>
          <DataRow
            label="Modelo"
            value={driver.vehicle_model || "Não informado"}
          />
          <DataRow label="Placa" value={driver.plate || "Não informada"} />
          <DataRow
            label="Capacidade"
            value={driver.capacity || "Não informada"}
          />
          <DataRow
            label="Compartimentos"
            value={driver.compartments || "Não informado"}
          />
        </View>
      </ScrollView>
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

function VehicleScreen({
  driver,
  onBack,
}: {
  driver: Driver;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.dataSafe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.dataScreen}>
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
    paddingBottom: 42,
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
  dataSafe: { backgroundColor: "#07399f", flex: 1 },
  dataScreen: {
    alignSelf: "center",
    maxWidth: 720,
    padding: 22,
    paddingBottom: 42,
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
