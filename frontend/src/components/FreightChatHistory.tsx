import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

export function FreightChatHistory({
  routeId,
  assignmentId,
}: {
  routeId: string;
  assignmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      body: string;
      created_at: string;
      user: { full_name: string | null; email: string };
      freight_offer: { amount_cents: number; status: string } | null;
    }>
  >([]);
  const [error, setError] = useState("");

  const toggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || loaded || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/freight-routes/${routeId}/assignments/${assignmentId}/chat-history`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
          },
        },
      );
      const body = (await response.json()) as {
        messages?: typeof messages;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível carregar o chat.");
      setMessages(body.messages ?? []);
      setLoaded(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const formatCents = (amount: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount / 100);

  return (
    <div className="freight-chat-history basis-full border-t border-slate-200 pt-2">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
      >
        <MessageCircle size={14} />
        {open
          ? "Ocultar histórico do chat"
          : "Ver histórico do chat deste frete"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {loading && (
            <p className="text-xs text-slate-500">Carregando conversa...</p>
          )}
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          {loaded && messages.length === 0 && !error && (
            <p className="text-xs text-slate-500">
              Nenhuma mensagem no período deste frete.
            </p>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className="rounded-lg bg-slate-50 px-3 py-2"
            >
              <div className="flex flex-wrap justify-between gap-1 text-xs">
                <span className="font-semibold text-slate-700">
                  {message.user.full_name ?? message.user.email}
                  {message.freight_offer &&
                    ` · oferta ${formatCents(message.freight_offer.amount_cents)}`}
                </span>
                <time className="text-slate-500" dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleString("pt-BR")}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                {message.body}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
