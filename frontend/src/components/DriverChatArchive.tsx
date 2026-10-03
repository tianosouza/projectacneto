import { useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

type ArchivedDriverMessage = {
  id: string;
  body: string;
  created_at: string;
  user: { id: string; full_name: string | null; email: string };
  driver: { id: string; full_name: string };
};

export function DriverChatArchive({
  headers,
}: {
  headers: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArchivedDriverMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMessages = async (append: boolean) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (append) params.set("offset", String(results.length));
      const response = await apiFetch(
        `/api/admin/driver-chat-messages?${params.toString()}`,
        { headers },
      );
      const body = (await response.json()) as {
        messages?: ArchivedDriverMessage[];
        has_more?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível buscar as mensagens");
      const messages = body.messages ?? [];
      setResults((current) => (append ? [...current, ...messages] : messages));
      setHasMore(body.has_more === true);
      setSearched(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadMessages(false);
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
        Histórico de chats
        <span className="ml-2 text-xs font-normal text-slate-500">
          Pesquisa exclusiva do super admin
        </span>
      </summary>
      <div className="border-t border-slate-200 p-4">
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Mensagem, autor, motorista ou ID"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            Buscar
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {searched && !results.length && !error && (
          <p className="mt-4 text-sm text-slate-500">
            Nenhuma mensagem encontrada.
          </p>
        )}
        <div className="mt-3 space-y-2">
          {results.map((message) => (
            <article
              key={message.id}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {message.user.full_name ?? message.user.email}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      conversa com {message.driver.full_name}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Motorista · #{message.driver.id}
                  </p>
                </div>
                <time
                  className="shrink-0 text-xs text-slate-400"
                  dateTime={message.created_at}
                >
                  {new Date(message.created_at).toLocaleString("pt-BR")}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">
                {message.body}
              </p>
            </article>
          ))}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => void loadMessages(true)}
            disabled={loading}
            className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {loading ? "Carregando..." : "Carregar mais"}
          </button>
        )}
      </div>
    </details>
  );
}
