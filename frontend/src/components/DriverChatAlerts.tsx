import { useEffect, useState } from "react";
import { DriverChat } from "@/components/DriverChat";
import { apiEventSource } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type RouteAlertKind = "accepted" | "cancelled";

type RouteAcceptedAlert = {
  kind?: RouteAlertKind;
  driverId: string;
  driverName: string;
  route: string;
  messageId: string;
};

const storageKey = (userId: string) => `acneto-driver-chat-alerts:${userId}`;

const loadAlerts = (key: string): RouteAcceptedAlert[] => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as RouteAcceptedAlert[]) : [];
  } catch {
    return [];
  }
};

const saveAlerts = (key: string, alerts: RouteAcceptedAlert[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(alerts));
  } catch {
    // Sem armazenamento local, os balões só não sobrevivem a um recarregamento.
  }
};

const eventKinds: Record<string, RouteAlertKind> = {
  "driver-route-accepted": "accepted",
  "driver-route-cancelled": "cancelled",
};

/**
 * Painel da operação: quando um motorista aceita ou cancela uma rota, abre o
 * balão do chat dele no canto inferior direito, piscando até ser aberto.
 */
export function DriverChatAlerts() {
  const { user } = useAuth();
  const key = storageKey(user?.id ?? "anon");
  const [alerts, setAlerts] = useState<RouteAcceptedAlert[]>(() =>
    loadAlerts(key),
  );

  useEffect(() => saveAlerts(key, alerts), [key, alerts]);

  useEffect(() => {
    const token = localStorage.getItem("acneto-access-token");
    if (!token) return;
    const events = apiEventSource(
      `/api/events?token=${encodeURIComponent(token)}`,
    );
    const onEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          data?: RouteAcceptedAlert;
        };
        const alert = payload.data;
        const kind = eventKinds[payload.type ?? ""];
        if (!kind || !alert?.driverId) return;
        // Um balão por motorista; um novo aviso substitui o anterior.
        setAlerts((current) => [
          ...current.filter((item) => item.driverId !== alert.driverId),
          { ...alert, kind },
        ]);
      } catch {
        // Ignora eventos malformados.
      }
    };
    events.addEventListener("message", onEvent);
    return () => {
      events.removeEventListener("message", onEvent);
      events.close();
    };
  }, []);

  return (
    <>
      {alerts.map((alert, index) => (
        <DriverChat
          key={`${alert.driverId}:${alert.messageId}`}
          driverId={alert.driverId}
          participantName={alert.driverName}
          alert={{
            label: `${alert.kind === "cancelled" ? "Cancelou" : "Aceitou"} a rota ${alert.route}`,
            index,
            onDismiss: () =>
              setAlerts((current) =>
                current.filter((item) => item.driverId !== alert.driverId),
              ),
          }}
        />
      ))}
    </>
  );
}
