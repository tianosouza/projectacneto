import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  freight_offer?: {
    id: string;
    amount_cents: number;
    status: "offered" | "accepted" | "rejected" | "completed" | "superseded";
    route: {
      collection_point: { name: string } | null;
      final_customer: { name: string } | null;
    } | null;
  } | null;
  user: { full_name: string | null; email: string };
};

type TypingUser = { user_id: string; full_name: string };

export function DriverChat({
  driverId,
  driverUserId,
  participantName,
  token,
  onBack,
}: {
  driverId: string;
  driverUserId: string;
  participantName: string;
  token: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typingUser, setTypingUser] = useState<TypingUser | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const respondingOfferRef = useRef<string | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const headersRef = useRef({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });
  headersRef.current = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const postTypingState = (isTyping: boolean) =>
    fetch(
      `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/typing`,
      {
        method: "POST",
        headers: headersRef.current,
        body: JSON.stringify({ isTyping }),
      },
    ).catch(() => undefined);

  const stopTyping = () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (isTypingRef.current) {
      isTypingRef.current = false;
      void postTypingState(false);
    }
  };

  const updateDraft = (value: string) => {
    setDraft(value);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    isTypingRef.current = true;
    void postTypingState(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, 1500);
  };

  const respondToOffer = async (
    message: ChatMessage,
    decision: "accept" | "reject",
  ) => {
    const offer = message.freight_offer;
    if (!offer || respondingOfferRef.current) return;
    respondingOfferRef.current = offer.id;
    setError("");
    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/offers/${offer.id}/decision`,
        {
          method: "POST",
          headers: headersRef.current,
          body: JSON.stringify({ decision }),
        },
      );
      const result = (await response.json()) as {
        offer?: NonNullable<ChatMessage["freight_offer"]>;
        message?: ChatMessage;
        error?: string;
      };
      if (!response.ok || !result.offer || !result.message)
        throw new Error(result.error ?? "Não foi possível responder à oferta.");
      messagesRef.current = [
        ...messagesRef.current.map((item) =>
          item.id === message.id
            ? { ...item, freight_offer: result.offer }
            : item,
        ),
        result.message,
      ];
      setMessages(messagesRef.current);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      respondingOfferRef.current = null;
    }
  };

  useEffect(() => {
    let active = true;
    const loadMessages = async () => {
      try {
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/messages`,
          { headers: headersRef.current },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { messages: ChatMessage[] };
        if (active) {
          const previousStatuses = new Map(
            messagesRef.current
              .filter((message) => message.freight_offer)
              .map((message) => [
                message.freight_offer!.id,
                message.freight_offer!.status,
              ]),
          );
          const freightJustFinished = body.messages.some(
            (message) =>
              message.freight_offer?.status === "completed" &&
              previousStatuses.get(message.freight_offer.id) === "accepted",
          );
          messagesRef.current = body.messages;
          setMessages(body.messages);
          if (freightJustFinished) onBackRef.current();
        }
      } catch {
        if (active) setError("Não foi possível carregar as mensagens.");
      }
    };
    void loadMessages();
    const messageTimer = setInterval(() => void loadMessages(), 2500);
    const typingTimer = setInterval(async () => {
      try {
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/typing`,
          { headers: headersRef.current },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { users: TypingUser[] };
        if (active) setTypingUser(body.users[0] ?? null);
      } catch {
        if (active) setTypingUser(null);
      }
    }, 1200);
    return () => {
      active = false;
      clearInterval(messageTimer);
      clearInterval(typingTimer);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      if (isTypingRef.current) {
        isTypingRef.current = false;
        void fetch(
          `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/typing`,
          {
            method: "POST",
            headers: headersRef.current,
            body: JSON.stringify({ isTyping: false }),
          },
        ).catch(() => undefined);
      }
    };
  }, [driverId, token]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, typingUser]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    stopTyping();
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/messages`,
        {
          method: "POST",
          headers: headersRef.current,
          body: JSON.stringify({ body }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível enviar a mensagem.");
      setDraft("");
      const updated = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""}/api/drivers/${driverId}/chat/messages`,
        { headers: headersRef.current },
      );
      if (updated.ok) {
        const responseBody = (await updated.json()) as {
          messages: ChatMessage[];
        };
        setMessages(responseBody.messages);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: "#f5f7fa" }}
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            paddingBottom: 14,
          }}
        >
          <TouchableOpacity onPress={onBack} accessibilityLabel="Voltar">
            <Text style={{ color: "#0e4db7", fontSize: 28 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#64748b", fontSize: 10, fontWeight: "700" }}>
              CHAT DIRETO
            </Text>
            <Text style={{ color: "#0b1d3a", fontSize: 18, fontWeight: "700" }}>
              {participantName}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onBack}
            accessibilityLabel="Fechar chat"
            hitSlop={10}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
          >
            <Text style={{ color: "#64748b", fontSize: 24, fontWeight: "700" }}>
              ×
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 10, paddingVertical: 12 }}
        >
          {messages.map((message) => {
            const own = message.user_id === driverUserId;
            return (
              <View
                key={message.id}
                style={{
                  alignSelf: own ? "flex-end" : "flex-start",
                  backgroundColor: own ? "#0e4db7" : "#e8edf3",
                  borderRadius: 12,
                  maxWidth: "88%",
                  padding: 12,
                }}
              >
                <Text
                  style={{
                    color: own ? "#dbeafe" : "#64748b",
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {message.user.full_name ?? message.user.email} ·{" "}
                  {new Date(message.created_at).toLocaleString("pt-BR")}
                </Text>
                <Text
                  style={{
                    color: own ? "#ffffff" : "#1e293b",
                    fontSize: 14,
                    marginTop: 4,
                  }}
                >
                  {message.body}
                </Text>
                {message.freight_offer && (
                  <View
                    style={{
                      backgroundColor: own ? "#07399f" : "#ffffff",
                      borderColor: own ? "#4274cf" : "#cbd5e1",
                      borderRadius: 8,
                      borderWidth: 1,
                      marginTop: 10,
                      padding: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: own ? "#dbeafe" : "#64748b",
                        fontSize: 11,
                        fontWeight: "700",
                      }}
                    >
                      Oferta de frete ·{" "}
                      {message.freight_offer.route?.collection_point?.name ??
                        "Origem"}{" "}
                      →{" "}
                      {message.freight_offer.route?.final_customer?.name ??
                        "Destino"}
                    </Text>
                    <Text
                      style={{
                        color: own ? "#ffffff" : "#0b1d3a",
                        fontSize: 18,
                        fontWeight: "800",
                        marginTop: 4,
                      }}
                    >
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(message.freight_offer.amount_cents / 100)}
                    </Text>
                    <Text
                      style={{
                        color: own ? "#dbeafe" : "#64748b",
                        fontSize: 11,
                        marginTop: 4,
                      }}
                    >
                      {
                        {
                          offered: "Aguardando resposta",
                          accepted: "Aceita · frete em andamento",
                          rejected: "Recusada",
                          completed: "Frete concluído · oferta encerrada",
                          superseded: "Substituída por nova oferta",
                        }[message.freight_offer.status]
                      }
                    </Text>
                    {message.freight_offer.status === "offered" && (
                      <View
                        style={{ flexDirection: "row", gap: 8, marginTop: 10 }}
                      >
                        <TouchableOpacity
                          onPress={() => void respondToOffer(message, "accept")}
                          style={{
                            backgroundColor: "#059669",
                            borderRadius: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                            Aceitar frete
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => void respondToOffer(message, "reject")}
                          style={{
                            borderColor: "#94a3b8",
                            borderRadius: 6,
                            borderWidth: 1,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ color: "#475569", fontWeight: "700" }}>
                            Recusar
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          {!messages.length && (
            <Text
              style={{
                color: "#64748b",
                paddingVertical: 20,
                textAlign: "center",
              }}
            >
              Nenhuma mensagem nesta conversa.
            </Text>
          )}
        </ScrollView>

        {typingUser && (
          <Text style={{ color: "#64748b", fontSize: 12, paddingBottom: 8 }}>
            {typingUser.full_name} está digitando...
          </Text>
        )}
        {error ? (
          <Text style={{ color: "#dc2626", fontSize: 12, paddingBottom: 8 }}>
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, paddingBottom: 12 }}>
          <TextInput
            value={draft}
            onChangeText={updateDraft}
            onBlur={stopTyping}
            onSubmitEditing={() => void send()}
            placeholder="Escreva uma mensagem"
            maxLength={1000}
            style={{
              backgroundColor: "#ffffff",
              borderColor: "#cbd5e1",
              borderRadius: 10,
              borderWidth: 1,
              color: "#1e293b",
              flex: 1,
              minHeight: 46,
              paddingHorizontal: 12,
            }}
          />
          <TouchableOpacity
            onPress={() => void send()}
            disabled={sending || !draft.trim()}
            style={{
              alignItems: "center",
              backgroundColor: "#0e4db7",
              borderRadius: 10,
              justifyContent: "center",
              minWidth: 70,
              opacity: sending || !draft.trim() ? 0.6 : 1,
              paddingHorizontal: 12,
            }}
          >
            {sending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                Enviar
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
