import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  LifeBuoy,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Attachment = { id: string; name: string; mime_type: string };
type Ticket = {
  id: string;
  subject: string;
  description: string;
  location: string | null;
  status: string;
  staff_note: string | null;
  created_at: string;
  escalated_at: string | null;
  attachments: Attachment[];
};

const statusLabels: Record<string, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  resolved: "Resolvido",
  closed: "Fechado",
};
const statusStyles: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-600",
};
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Não foi possível ler a imagem"));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    reader.readAsDataURL(file);
  });

// Balão de suporte para qualquer usuário abrir e acompanhar os próprios chamados.
// Quem atende os chamados (administradores) usa a aba "Chamados" do painel.
export function SupportWidget() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "mine">("new");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const imagesRef = useRef<Record<string, string>>({});
  imagesRef.current = images;

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const loadMine = useCallback(async () => {
    const response = await apiFetch("/api/support/tickets", {
      headers: authHeaders(),
    });
    if (response.ok)
      setMyTickets(((await response.json()) as { tickets: Ticket[] }).tickets);
  }, [authHeaders]);

  useEffect(() => {
    if (open && tab === "mine") void loadMine();
  }, [open, tab, loadMine]);

  useEffect(
    () => () => {
      Object.values(imagesRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter((file) => allowedTypes.includes(file.type));
    if (valid.length !== incoming.length)
      setError("Use imagens JPG, PNG ou WebP.");
    const next = [...files, ...valid];
    if (next.length > 5) return setError("Anexe no máximo 5 prints.");
    if (next.some((file) => file.size > 5 * 1024 * 1024))
      return setError("Cada print pode ter no máximo 5 MB.");
    if (next.reduce((total, file) => total + file.size, 0) > 12 * 1024 * 1024)
      return setError("O tamanho total dos prints não pode passar de 12 MB.");
    if (valid.length === incoming.length) setError("");
    setFiles(next);
  };

  const submit = async () => {
    if (sending) return;
    if (subject.trim().length < 3)
      return setError("Informe um título para o chamado.");
    if (description.trim().length < 10)
      return setError(
        "Descreva o que está acontecendo (mínimo 10 caracteres).",
      );
    setSending(true);
    setError("");
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data: await readAsDataUrl(file),
        })),
      );
      const response = await apiFetch("/api/support/tickets", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description,
          location,
          pageUrl: window.location.href,
          attachments,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível abrir o chamado");
      setSubject("");
      setDescription("");
      setLocation("");
      setFiles([]);
      setSent(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  const loadImage = async (ticketId: string, attachment: Attachment) => {
    if (imagesRef.current[attachment.id]) return;
    const response = await apiFetch(
      `/api/support/tickets/${ticketId}/attachments/${attachment.id}`,
      { headers: authHeaders() },
    );
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    setImages((current) => ({ ...current, [attachment.id]: url }));
  };

  const toggleTicket = (ticket: Ticket) => {
    const next = expandedId === ticket.id ? null : ticket.id;
    setExpandedId(next);
    if (next)
      ticket.attachments.forEach((item) => void loadImage(ticket.id, item));
  };

  const renderTicket = (ticket: Ticket) => (
    <div
      key={ticket.id}
      className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
    >
      <button
        type="button"
        onClick={() => toggleTicket(ticket)}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold text-[#0b1d3a]">
            {ticket.subject}
          </span>
          <span className="block text-xs text-slate-500">
            {new Date(ticket.created_at).toLocaleString("pt-BR")}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusStyles[ticket.status] ?? ""}`}
        >
          {statusLabels[ticket.status] ?? ticket.status}
        </span>
      </button>
      {expandedId === ticket.id && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="whitespace-pre-wrap text-slate-700">
            {ticket.description}
          </p>
          {ticket.location && (
            <p className="text-xs text-slate-500">
              <strong>Onde:</strong> {ticket.location}
            </p>
          )}
          {ticket.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ticket.attachments.map((item) =>
                images[item.id] ? (
                  <a
                    key={item.id}
                    href={images[item.id]}
                    target="_blank"
                    rel="noreferrer"
                    title={item.name}
                  >
                    <img
                      src={images[item.id]}
                      alt={item.name}
                      className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                    />
                  </a>
                ) : (
                  <span
                    key={item.id}
                    className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
                  >
                    <Loader2 size={16} className="animate-spin" />
                  </span>
                ),
              )}
            </div>
          )}
          {ticket.staff_note && (
            <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
              <strong>Resposta da equipe:</strong> {ticket.staff_note}
            </p>
          )}
        </div>
      )}
    </div>
  );

  const tabs: Array<["new" | "mine", string]> = [
    ["new", "Novo chamado"],
    ["mine", "Meus chamados"],
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Fechar suporte" : "Abrir suporte"}
        className="fixed bottom-4 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#1052c7] text-white shadow-xl shadow-blue-900/30 transition hover:bg-[#0b3f9f]"
      >
        {open ? <X size={24} /> : <LifeBuoy size={26} />}
      </button>
      {open && (
        <div
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (tab === "new" && pasted.length) addFiles(pasted);
          }}
          className="fixed bottom-20 left-3 right-3 z-[60] flex max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:left-auto sm:right-4 sm:w-[26rem]"
        >
          <div className="bg-[#0e4db7] px-4 py-3 text-white">
            <p className="text-sm font-bold">Suporte</p>
            <p className="text-xs text-blue-100">
              Encontrou um erro? Conte para a gente.
            </p>
          </div>
          <div className="flex gap-1 border-b border-slate-200 bg-white p-1">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTab(value);
                  setSent(false);
                }}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${tab === value ? "bg-slate-100 text-[#0b1d3a]" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-3 overflow-y-auto p-4">
            {tab === "new" &&
              (sent ? (
                <div className="space-y-3 text-center">
                  <CheckCircle2
                    size={36}
                    className="mx-auto text-emerald-500"
                  />
                  <p className="text-sm font-semibold text-slate-700">
                    Chamado aberto. A equipe vai analisar e você pode acompanhar
                    em "Meus chamados".
                  </p>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="rounded-xl bg-[#1052c7] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Abrir outro chamado
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={subject}
                    maxLength={120}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Resumo do problema *"
                    className={inputClass}
                  />
                  <input
                    value={location}
                    maxLength={200}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Em qual tela ou aba aconteceu? (ex.: Rotas > Nova rota)"
                    className={inputClass}
                  />
                  <textarea
                    value={description}
                    maxLength={4000}
                    rows={5}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="O que aconteceu? O que você esperava que acontecesse? *"
                    className={`${inputClass} resize-none`}
                  />
                  <div>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-600 hover:border-blue-400">
                      <ImagePlus size={18} className="text-[#1052c7]" />
                      Anexar prints (até 5, ou cole com Ctrl+V)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          addFiles(Array.from(event.target.files ?? []));
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {files.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {files.map((file, index) => (
                          <li
                            key={`${file.name}-${index}`}
                            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-xs text-slate-600"
                          >
                            <span className="truncate">{file.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setFiles((current) =>
                                  current.filter((_, i) => i !== index),
                                )
                              }
                              aria-label="Remover print"
                            >
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {error && (
                    <p className="text-sm font-semibold text-rose-600">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1052c7] py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    <Send size={15} />{" "}
                    {sending ? "Enviando..." : "Enviar chamado"}
                  </button>
                </>
              ))}
            {tab === "mine" &&
              (myTickets.length === 0 ? (
                <p className="text-center text-sm text-slate-500">
                  Você ainda não abriu chamados.
                </p>
              ) : (
                myTickets.map(renderTicket)
              ))}
          </div>
        </div>
      )}
    </>
  );
}
