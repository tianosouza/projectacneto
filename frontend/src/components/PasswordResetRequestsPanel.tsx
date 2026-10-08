import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, MessageCircle, X } from "lucide-react";
import { apiEventSource, apiFetch } from "@/lib/api";

export type PasswordResetRequest = {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string | null;
  created_at: string;
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
});

const roleLabels: Record<string, string> = {
  driver: "Motorista",
  carrier: "Transportadora",
  client: "Cliente",
  operator: "Operador",
  admin: "Administrador",
};

const whatsappWebUrl = (phone: string, message: string) => {
  const digits = phone.replace(/\D/g, "");
  const international = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://web.whatsapp.com/send?phone=${international}&text=${encodeURIComponent(message)}`;
};

const passwordMessage = (
  name: string | null,
  email: string,
  password: string,
) =>
  [
    `Olá${name ? `, ${name.split(" ")[0]}` : ""}! Sua senha do Next Driver foi redefinida.`,
    "",
    `Login: ${email}`,
    `Senha temporária: ${password}`,
    "",
    "Ao entrar com essa senha, você vai criar uma nova senha.",
  ].join("\n");

/** Pedidos de "esqueci minha senha" pendentes, atualizados em tempo real. */
export function usePasswordResetRequests(enabled: boolean) {
  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/admin/password-reset-requests", {
        headers: authHeaders(),
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        requests: PasswordResetRequest[];
      };
      setRequests(body.requests);
    } catch {
      // A próxima atualização tenta de novo.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const token = localStorage.getItem("acneto-access-token");
    const events = token
      ? apiEventSource(`/api/events?token=${encodeURIComponent(token)}`)
      : null;
    const onEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type?.startsWith("password-reset-")) void load();
      } catch {
        // Ignora eventos malformados.
      }
    };
    events?.addEventListener("message", onEvent);
    const interval = window.setInterval(() => void load(), 30000);
    return () => {
      events?.removeEventListener("message", onEvent);
      events?.close();
      window.clearInterval(interval);
    };
  }, [enabled, load]);

  return { requests, reload: load };
}

/**
 * Aba de solicitações: o admin/operador redefine a senha e envia a senha
 * temporária pelo WhatsApp Web. No próximo login o usuário cria outra senha.
 */
export function PasswordResetRequestsPanel({
  requests,
  onChanged,
}: {
  requests: PasswordResetRequest[];
  onChanged: () => void;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Senhas geradas nesta sessão, para reenviar se o WhatsApp não abrir.
  const [sent, setSent] = useState<
    Array<{
      id: string;
      name: string;
      phone: string;
      url: string;
      password: string;
    }>
  >([]);

  const resolve = async (request: PasswordResetRequest) => {
    if (!request.phone) {
      setError("Este usuário não tem celular cadastrado.");
      return;
    }
    setError("");
    setProcessingId(request.id);
    // Abre a aba já no clique: navegadores bloqueiam janelas abertas depois
    // de uma requisição assíncrona.
    const whatsappTab = window.open("about:blank", "_blank");
    try {
      const response = await apiFetch(
        `/api/admin/password-reset-requests/${request.id}/resolve`,
        { method: "POST", headers: authHeaders() },
      );
      const body = (await response.json().catch(() => ({}))) as {
        temporary_password?: string;
        full_name?: string | null;
        email?: string;
        phone?: string | null;
        error?: string;
      };
      if (!response.ok || !body.temporary_password) {
        whatsappTab?.close();
        setError(body.error ?? "Não foi possível redefinir a senha.");
        return;
      }
      const url = whatsappWebUrl(
        body.phone ?? request.phone,
        passwordMessage(
          body.full_name ?? request.full_name,
          body.email ?? request.email,
          body.temporary_password,
        ),
      );
      if (whatsappTab) whatsappTab.location.href = url;
      else window.open(url, "_blank");
      setSent((current) => [
        {
          id: request.id,
          name: request.full_name ?? request.email,
          phone: body.phone ?? request.phone!,
          url,
          password: body.temporary_password!,
        },
        ...current,
      ]);
      onChanged();
    } catch {
      whatsappTab?.close();
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setProcessingId(null);
    }
  };

  const dismiss = async (request: PasswordResetRequest) => {
    if (
      !window.confirm(
        `Descartar o pedido de nova senha de ${request.full_name ?? request.email}? A senha atual não muda.`,
      )
    )
      return;
    setProcessingId(request.id);
    try {
      await apiFetch(
        `/api/admin/password-reset-requests/${request.id}/dismiss`,
        { method: "POST", headers: authHeaders() },
      );
      onChanged();
    } finally {
      setProcessingId(null);
    }
  };

  if (!requests.length && !sent.length) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <KeyRound size={18} className="text-amber-600" />
        <h2 className="text-lg font-bold text-[#0b1d3a]">
          Pedidos de nova senha
        </h2>
        {requests.length > 0 && (
          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">
            {requests.length}
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        {requests.map((request) => (
          <article
            key={request.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#0b1d3a]">
                {request.full_name ?? request.email}
                {request.role && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    {roleLabels[request.role] ?? request.role}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-slate-500">
                {request.phone ?? "Sem celular"} · {request.email} · pedido em{" "}
                {new Date(request.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void dismiss(request)}
                disabled={processingId === request.id}
                title="Descartar pedido"
                aria-label={`Descartar pedido de ${request.full_name ?? request.email}`}
                className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                <X size={16} />
              </button>
              <button
                type="button"
                onClick={() => void resolve(request)}
                disabled={processingId === request.id || !request.phone}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {processingId === request.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <MessageCircle size={16} />
                )}
                Redefinir e enviar no WhatsApp
              </button>
            </div>
          </article>
        ))}
      </div>

      {sent.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Senhas enviadas nesta sessão
          </p>
          {sent.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-3 text-sm sm:flex-row sm:items-center"
            >
              <p className="min-w-0 flex-1 text-emerald-900">
                <strong>{item.name}</strong> · senha temporária{" "}
                <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                  {item.password}
                </code>
              </p>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
              >
                <MessageCircle size={15} /> Abrir WhatsApp de novo
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
