import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Loader2,
  MessageCircle,
  Minus,
  Route as RouteIcon,
  Send,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { FreightChatOffer } from "@/lib/dashboardTypes";

type DriverChatMessage = {
  id: string;
  user_id: string;
  body: string;
  kind?: string;
  created_at: string;
  freight_offer?: FreightChatOffer | null;
  user: { full_name: string | null; email: string };
};

type TypingUser = { user_id: string; full_name: string };
type FreightContext = {
  key: string;
  collectionPointId: string;
  collectionPointName: string;
  finalCustomerId: string;
  finalCustomerName: string;
};

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
});

export function DriverChat({
  driverId,
  participantName,
  initiallyOpen = false,
  openingProposal,
  onOpenRouteBoard,
  alert,
}: {
  driverId: string;
  participantName: string;
  initiallyOpen?: boolean;
  openingProposal?: { key: string; message: string };
  freightContext?: FreightContext;
  /** Quando informado (portal do motorista), alertas de rota abrem o mural. */
  onOpenRouteBoard?: () => void;
  /**
   * Modo balão de alerta (painel da operação): começa minimizado e piscando
   * no canto inferior direito até ser aberto; `index` empilha vários balões.
   */
  alert?: { label: string; index: number; onDismiss: () => void };
}) {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(initiallyOpen || Boolean(alert));
  const [minimized, setMinimized] = useState(Boolean(alert));
  const [hasUnreadMessages, setHasUnreadMessages] = useState(Boolean(alert));
  const [messages, setMessages] = useState<DriverChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typingUser, setTypingUser] = useState<TypingUser | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [respondingOfferId, setRespondingOfferId] = useState<string | null>(
    null,
  );
  const [chatPosition, setChatPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<DriverChatMessage[]>([]);
  const previousLatestIdRef = useRef<string | null>(null);
  const hasLoadedMessagesRef = useRef(false);
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<number | null>(null);
  const typingHeartbeatRef = useRef<number | null>(null);
  const sentProposalKeysRef = useRef(new Set<string>());
  const proposalInFlightRef = useRef<string | null>(null);
  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const postTypingState = async (isTyping: boolean) => {
    try {
      await apiFetch(`/api/drivers/${driverId}/chat/typing`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ isTyping }),
      });
    } catch {
      // Typing presence is best-effort and expires on the server.
    }
  };

  const stopTyping = () => {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingHeartbeatRef.current !== null) {
      window.clearInterval(typingHeartbeatRef.current);
      typingHeartbeatRef.current = null;
    }
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
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      void postTypingState(true);
      typingHeartbeatRef.current = window.setInterval(() => {
        if (isTypingRef.current) void postTypingState(true);
      }, 2000);
    }
    if (typingStopTimerRef.current !== null)
      window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(stopTyping, 1600);
  };

  useEffect(() => {
    let active = true;
    const loadMessages = async () => {
      const response = await apiFetch(
        `/api/drivers/${driverId}/chat/messages`,
        {
          headers: headers(),
        },
      );
      if (!response.ok) return;
      const body = (await response.json()) as {
        messages: DriverChatMessage[];
      };
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
        if (freightJustFinished) {
          if (typingStopTimerRef.current !== null)
            window.clearTimeout(typingStopTimerRef.current);
          if (typingHeartbeatRef.current !== null)
            window.clearInterval(typingHeartbeatRef.current);
          typingStopTimerRef.current = null;
          typingHeartbeatRef.current = null;
          if (isTypingRef.current) {
            isTypingRef.current = false;
            void apiFetch(`/api/drivers/${driverId}/chat/typing`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ isTyping: false }),
            }).catch(() => undefined);
          }
          setOpen(false);
          setMinimized(false);
        }
      }
    };
    void loadMessages();
    const interval = window.setInterval(() => void loadMessages(), 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [driverId]);

  useEffect(() => {
    if (
      hasLoadedMessagesRef.current &&
      latestMessageId !== previousLatestIdRef.current
    ) {
      const previousIndex = messages.findIndex(
        (item) => item.id === previousLatestIdRef.current,
      );
      const newMessages =
        previousIndex >= 0
          ? messages.slice(previousIndex + 1)
          : messages.slice(-1);
      if (
        open &&
        minimized &&
        newMessages.some((item) => item.user_id !== user?.id)
      ) {
        setHasUnreadMessages(true);
      }
    }
    hasLoadedMessagesRef.current = true;
    previousLatestIdRef.current = latestMessageId;
    if (open && !minimized) {
      setHasUnreadMessages(false);
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [latestMessageId, messages, minimized, open, user?.id]);

  useEffect(() => {
    if (!open || minimized) {
      setTypingUser(null);
      return;
    }
    let active = true;
    const loadTyping = async () => {
      try {
        const response = await apiFetch(
          `/api/drivers/${driverId}/chat/typing`,
          {
            headers: headers(),
          },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { users: TypingUser[] };
        if (active) setTypingUser(body.users[0] ?? null);
      } catch {
        if (active) setTypingUser(null);
      }
    };
    void loadTyping();
    const interval = window.setInterval(() => void loadTyping(), 1200);
    return () => {
      active = false;
      window.clearInterval(interval);
      setTypingUser(null);
    };
  }, [driverId, minimized, open]);

  useEffect(
    () => () => {
      if (typingStopTimerRef.current !== null)
        window.clearTimeout(typingStopTimerRef.current);
      if (typingHeartbeatRef.current !== null)
        window.clearInterval(typingHeartbeatRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        void apiFetch(`/api/drivers/${driverId}/chat/typing`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ isTyping: false }),
        }).catch(() => undefined);
      }
    },
    [driverId],
  );

  const minimize = () => {
    stopTyping();
    setMinimized(true);
  };

  const closeChat = () => {
    stopTyping();
    setOpen(false);
    setMinimized(false);
    setHasUnreadMessages(false);
    alert?.onDismiss();
  };

  const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = chatPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setChatPosition({ left: rect.left, top: rect.top });
  };

  const dragChat = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = chatPanelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;
    const rect = panel.getBoundingClientRect();
    setChatPosition({
      left: Math.min(
        Math.max(0, event.clientX - drag.offsetX),
        Math.max(0, window.innerWidth - rect.width),
      ),
      top: Math.min(
        Math.max(0, event.clientY - drag.offsetY),
        Math.max(0, window.innerHeight - rect.height),
      ),
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const openChat = async () => {
    setOpen(true);
    setMinimized(false);
    setHasUnreadMessages(false);
    if (
      !openingProposal ||
      sentProposalKeysRef.current.has(openingProposal.key) ||
      proposalInFlightRef.current === openingProposal.key
    )
      return;
    proposalInFlightRef.current = openingProposal.key;
    setSending(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/drivers/${driverId}/chat/messages`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ body: openingProposal.message }),
        },
      );
      const result = (await response.json()) as {
        message?: DriverChatMessage;
        error?: string;
      };
      if (!response.ok || !result.message)
        throw new Error(result.error ?? "Não foi possível enviar a proposta");
      sentProposalKeysRef.current.add(openingProposal.key);
      setMessages((current) =>
        current.some((message) => message.id === result.message!.id)
          ? current
          : [...current, result.message!],
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      proposalInFlightRef.current = null;
      setSending(false);
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    stopTyping();
    setSending(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/drivers/${driverId}/chat/messages`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ body }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível enviar a mensagem");
      setDraft("");
      const updated = await apiFetch(`/api/drivers/${driverId}/chat/messages`, {
        headers: headers(),
      });
      if (updated.ok) {
        const responseBody = (await updated.json()) as {
          messages: DriverChatMessage[];
        };
        setMessages(responseBody.messages);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  const respondToOffer = async (
    message: DriverChatMessage,
    decision: "accept" | "reject",
  ) => {
    const offer = message.freight_offer;
    if (!offer || respondingOfferId) return;
    setRespondingOfferId(offer.id);
    setError("");
    try {
      const response = await apiFetch(
        `/api/drivers/${driverId}/chat/offers/${offer.id}/decision`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ decision }),
        },
      );
      const result = (await response.json()) as {
        offer?: FreightChatOffer;
        message?: DriverChatMessage;
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
      setRespondingOfferId(null);
    }
  };

  if (open && minimized) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={alert ? { bottom: 16 + alert.index * 64 } : undefined}
        className={`fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-lg border p-2 shadow-xl ${
          hasUnreadMessages
            ? "animate-pulse border-red-600 bg-red-50 ring-2 ring-red-200"
            : "border-slate-200 bg-white"
        }`}
      >
        <button
          type="button"
          onClick={() => void openChat()}
          className="inline-flex items-center gap-2 px-2 py-1 text-sm font-semibold text-slate-800"
          title={
            hasUnreadMessages
              ? `Nova mensagem de ${participantName}. Reabrir conversa`
              : "Reabrir conversa"
          }
        >
          <MessageCircle size={17} />
          <span className="flex flex-col items-start text-left">
            <span>{participantName}</span>
            {alert && hasUnreadMessages && (
              <span className="max-w-[240px] truncate text-xs font-medium text-red-700">
                {alert.label}
              </span>
            )}
          </span>
          {hasUnreadMessages && (
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
          )}
        </button>
        {alert && (
          <button
            type="button"
            onClick={closeChat}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Dispensar"
            aria-label={`Dispensar conversa com ${participantName}`}
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  }

  if (!open) {
    if (alert) return null;
    return (
      <button
        type="button"
        onClick={() => void openChat()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
      >
        <MessageCircle size={17} />
        {openingProposal ? "Enviar proposta pelo chat" : "Abrir chat"}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end bg-slate-950/30 sm:p-4">
      <button
        type="button"
        onClick={minimize}
        aria-label="Minimizar chat"
        className="absolute inset-0 z-0 cursor-default"
      />
      <section
        ref={chatPanelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`driver-chat-title-${driverId}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") minimize();
        }}
        style={
          chatPosition
            ? {
                position: "fixed",
                left: chatPosition.left,
                top: chatPosition.top,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
        className="relative z-10 flex h-[78dvh] w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:h-[min(640px,calc(100dvh-2rem))] sm:w-[420px] sm:rounded-lg"
      >
        <header
          onPointerDown={startDragging}
          onPointerMove={dragChat}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          className="flex cursor-move select-none items-center justify-between border-b border-slate-200 px-4 py-3 [touch-action:none]"
        >
          <div>
            <h3
              id={`driver-chat-title-${driverId}`}
              className="text-sm font-bold text-slate-900"
            >
              Chat · {participantName}
            </h3>
            <p className="text-xs text-slate-500">Conversa direta</p>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={minimize}
              className="rounded p-2 text-slate-500 hover:bg-slate-100"
              title="Minimizar chat"
              aria-label="Minimizar chat"
            >
              <Minus size={17} />
            </button>
            <button
              type="button"
              onClick={closeChat}
              className="rounded p-2 text-slate-500 hover:bg-slate-100"
              title="Fechar chat"
              aria-label="Fechar chat"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((item) => {
            const isOwnMessage = item.user_id === user?.id;
            return (
              <div
                key={item.id}
                className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
              >
                <article
                  className={`max-w-[92%] rounded-lg px-3 py-2 ${
                    isOwnMessage
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-800"
                  }`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <strong className="truncate text-xs">
                      {item.user.full_name ?? item.user.email}
                    </strong>
                    <time
                      className={`shrink-0 text-[10px] ${isOwnMessage ? "text-blue-100" : "text-slate-400"}`}
                      dateTime={item.created_at}
                    >
                      {new Date(item.created_at).toLocaleString("pt-BR")}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {item.body}
                  </p>
                  {item.kind === "route_alert" && onOpenRouteBoard && (
                    <button
                      type="button"
                      onClick={onOpenRouteBoard}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#1052c7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a3a90]"
                    >
                      <RouteIcon size={14} /> Ver rotas e aceitar
                    </button>
                  )}
                  {item.freight_offer && (
                    <div
                      className={`mt-3 rounded-lg border p-3 ${
                        isOwnMessage
                          ? "border-blue-400 bg-blue-700/70"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="text-xs font-semibold opacity-80">
                        Oferta de frete ·{" "}
                        {item.freight_offer.route?.collection_point?.name ??
                          "Origem"}{" "}
                        →{" "}
                        {item.freight_offer.route?.final_customer?.name ??
                          "Destino"}
                      </p>
                      <p className="mt-1 text-lg font-bold">
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(item.freight_offer.amount_cents / 100)}
                      </p>
                      <p className="mt-1 text-xs font-semibold">
                        {
                          {
                            offered: "Aguardando resposta do motorista",
                            accepted: "Aceita · frete em andamento",
                            rejected: "Recusada",
                            completed: "Frete concluído · oferta encerrada",
                            superseded: "Substituída por nova oferta",
                          }[item.freight_offer.status]
                        }
                      </p>
                      {profile?.role === "driver" &&
                        item.freight_offer.status === "offered" && (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={
                                respondingOfferId === item.freight_offer.id
                              }
                              onClick={() =>
                                void respondToOffer(item, "accept")
                              }
                              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {respondingOfferId === item.freight_offer.id
                                ? "Salvando..."
                                : "Aceitar frete"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                respondingOfferId === item.freight_offer.id
                              }
                              onClick={() =>
                                void respondToOffer(item, "reject")
                              }
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            >
                              Recusar
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                </article>
              </div>
            );
          })}
          {!messages.length && (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhuma mensagem nesta conversa.
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        {typingUser && (
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-4 pb-2 text-xs text-slate-500"
          >
            <span className="flex gap-0.5" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
            </span>
            {typingUser.full_name} está digitando...
          </p>
        )}
        {error && <p className="px-4 pb-2 text-sm text-rose-600">{error}</p>}
        <form
          onSubmit={(event) => void send(event)}
          className="flex gap-2 border-t border-slate-200 p-3"
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onBlur={stopTyping}
            placeholder="Escreva uma mensagem"
            maxLength={1000}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-slate-900 px-3 text-white disabled:opacity-50"
            title="Enviar mensagem"
          >
            {sending ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
