import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type RouteBoardPlace = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
};

type RouteBoardItem = {
  id: string;
  collection_point: RouteBoardPlace;
  final_customer: RouteBoardPlace;
  distance_km: number | null;
  created_at: string;
};

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

const placeCity = (place: RouteBoardPlace) =>
  [place.city, place.state].filter(Boolean).join("/") || place.address || "";

/**
 * Mural de rotas em aberto. Abre ao entrar no app e quando a operação
 * dispara "alertar motoristas". O aceite é registrado no chat com a operação.
 */
export function RouteBoardModal({
  visible,
  token,
  onClose,
  onAccepted,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [routes, setRoutes] = useState<RouteBoardItem[]>([]);
  const [hasActiveRoute, setHasActiveRoute] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/drivers/me/route-board`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        routes?: RouteBoardItem[];
        has_active_route?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Não foi possível carregar as rotas.");
        return;
      }
      setError("");
      setRoutes(body.routes ?? []);
      setHasActiveRoute(body.has_active_route === true);
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setConfirmingId(null);
    void load();
    // Mantém a lista atualizada enquanto o mural está aberto.
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [visible, load]);

  const accept = async (routeId: string) => {
    setAcceptingId(routeId);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/drivers/me/route-board/${routeId}/accept`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Não foi possível aceitar a rota.");
        setConfirmingId(null);
        void load();
        return;
      }
      onAccepted();
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Fechar mural de rotas"
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Mural de rotas</Text>
              <Text style={styles.subtitle}>
                {loading
                  ? "Carregando rotas em aberto…"
                  : routes.length === 1
                    ? "1 rota em aberto"
                    : `${routes.length} rotas em aberto`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Fechar mural de rotas"
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {hasActiveRoute && !loading && (
              <Text style={styles.warning}>
                Você já tem uma rota em andamento. Conclua-a para aceitar outra.
              </Text>
            )}
            {loading && (
              <ActivityIndicator color="#1052c7" style={{ marginTop: 32 }} />
            )}
            {!loading && routes.length === 0 && !error && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  Nenhuma rota em aberto no momento.
                </Text>
                <Text style={styles.emptyText}>
                  Quando a operação alertar novas rotas, este mural abre
                  sozinho.
                </Text>
              </View>
            )}
            {!loading &&
              routes.map((route) => (
                <View key={route.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>COLETA</Text>
                      <Text style={styles.place} numberOfLines={1}>
                        {route.collection_point.name}
                      </Text>
                      <Text style={styles.city} numberOfLines={1}>
                        {placeCity(route.collection_point)}
                      </Text>
                      <Text style={[styles.label, { marginTop: 10 }]}>
                        ENTREGA
                      </Text>
                      <Text style={styles.place} numberOfLines={1}>
                        {route.final_customer.name}
                      </Text>
                      <Text style={styles.city} numberOfLines={1}>
                        {placeCity(route.final_customer)}
                      </Text>
                    </View>
                    {route.distance_km != null && (
                      <Text style={styles.distance}>
                        {Math.round(route.distance_km)} km
                      </Text>
                    )}
                  </View>

                  {confirmingId === route.id ? (
                    <View style={styles.confirmBox}>
                      <Text style={styles.confirmText}>
                        Confirmar o aceite desta rota? A operação será avisada
                        pelo chat.
                      </Text>
                      <View style={styles.confirmRow}>
                        <TouchableOpacity
                          style={[styles.button, styles.buttonSecondary]}
                          disabled={acceptingId === route.id}
                          onPress={() => setConfirmingId(null)}
                        >
                          <Text style={styles.buttonSecondaryText}>
                            Cancelar
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.button, { flex: 1 }]}
                          disabled={acceptingId === route.id}
                          onPress={() => void accept(route.id)}
                        >
                          {acceptingId === route.id ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.buttonText}>
                              Confirmar aceite
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.button,
                        styles.acceptButton,
                        (hasActiveRoute || acceptingId !== null) &&
                          styles.buttonDisabled,
                      ]}
                      disabled={hasActiveRoute || acceptingId !== null}
                      onPress={() => setConfirmingId(route.id)}
                    >
                      <Text style={styles.buttonText}>Aceitar pelo chat</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(2, 8, 23, 0.5)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "88%",
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#eef2f7",
    borderBottomWidth: 1,
    flexDirection: "row",
    padding: 18,
  },
  title: { color: "#0b1d3a", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "#64748b", fontSize: 13, marginTop: 2 },
  closeButton: { padding: 8 },
  closeText: { color: "#94a3b8", fontSize: 18, fontWeight: "700" },
  content: { gap: 12, padding: 18, paddingBottom: 32 },
  error: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3",
    borderRadius: 10,
    borderWidth: 1,
    color: "#be123c",
    fontSize: 13,
    fontWeight: "700",
    padding: 10,
  },
  warning: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderRadius: 10,
    borderWidth: 1,
    color: "#92400e",
    fontSize: 13,
    padding: 10,
  },
  empty: { alignItems: "center", paddingVertical: 32 },
  emptyTitle: { color: "#475569", fontSize: 14, fontWeight: "700" },
  emptyText: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    borderColor: "#e2e8f0",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardTop: { flexDirection: "row", gap: 10 },
  label: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  place: { color: "#0b1d3a", fontSize: 14, fontWeight: "700", marginTop: 2 },
  city: { color: "#64748b", fontSize: 12, marginTop: 1 },
  distance: { color: "#0b1d3a", fontSize: 14, fontWeight: "800" },
  confirmBox: {
    backgroundColor: "#eff6ff",
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  confirmText: { color: "#0b1d3a", fontSize: 13 },
  confirmRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  button: {
    alignItems: "center",
    backgroundColor: "#1052c7",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  acceptButton: { marginTop: 12 },
  buttonDisabled: { backgroundColor: "#cbd5e1" },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  buttonSecondary: {
    backgroundColor: "#fff",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    flex: 1,
  },
  buttonSecondaryText: { color: "#475569", fontSize: 14, fontWeight: "700" },
});
