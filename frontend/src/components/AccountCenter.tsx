import { useState } from "react";
import {
  CheckCircle2,
  FilePenLine,
  LockKeyhole,
  Send,
  UserRound,
} from "lucide-react";
import type { Driver } from "@/lib/types";
import { apiFetch } from "@/lib/api";

type AccountUser = {
  email: string;
  full_name?: string | null;
  phone?: string | null;
};

type AccountProfile = {
  role: string;
  created_at?: string;
};

export function AccountCenter({
  user,
  profile,
  driver,
}: {
  user: AccountUser;
  profile: AccountProfile | null;
  driver?: Driver | null;
}) {
  const [requestText, setRequestText] = useState("");
  const [requestState, setRequestState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const sendChangeRequest = async () => {
    if (!requestText.trim() || requestState === "sending") return;
    setRequestState("sending");
    try {
      const response = await apiFetch("/api/account/change-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("acneto-access-token") ?? ""}`,
        },
        body: JSON.stringify({ requestedChanges: requestText }),
      });
      if (!response.ok) throw new Error("Não foi possível abrir o chamado");
      setRequestText("");
      setRequestState("sent");
    } catch {
      setRequestState("error");
    }
  };

  const fields = [
    ["Nome completo", driver?.full_name ?? user.full_name ?? "Não informado"],
    ["E-mail", user.email],
    ["Telefone", driver?.phone ?? user.phone ?? "Não informado"],
    ["Perfil de acesso", profile?.role ?? "Não informado"],
    ...(driver
      ? [
          ["CPF", driver.cpf ?? "Não informado"],
          ["CNH", driver.cnh ?? "Não informado"],
          ["Veículo", driver.vehicle_model ?? "Não informado"],
          ["Placa", driver.plate ?? "Não informado"],
          ["Cidade", driver.city ?? "Não informado"],
          ["Estado", driver.state ?? "Não informado"],
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0b1d3a]">
          Meus dados de cadastro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Consulte seus dados. Para alterar qualquer informação, abra um
          chamado.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UserRound size={18} className="text-[#1052c7]" />
          <h2 className="font-bold text-[#0b1d3a]">Dados cadastrados</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <div className="mt-1.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800">
                {value}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <LockKeyhole size={14} /> Os dados são somente para consulta nesta
          tela.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <FilePenLine size={18} className="text-[#1052c7]" />
          <h2 className="font-bold text-[#0b1d3a]">Solicitar alteração</h2>
        </div>
        <textarea
          value={requestText}
          onChange={(event) => {
            setRequestText(event.target.value);
            setRequestState("idle");
          }}
          rows={4}
          maxLength={2000}
          placeholder="Descreva quais dados precisam ser alterados e informe os valores corretos."
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          onClick={() => void sendChangeRequest()}
          disabled={!requestText.trim() || requestState === "sending"}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#1052c7] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={15} />{" "}
          {requestState === "sending" ? "Enviando..." : "Abrir chamado"}
        </button>
        {requestState === "sent" && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <CheckCircle2 size={16} /> Chamado aberto. A equipe analisará sua
            solicitação.
          </p>
        )}
        {requestState === "error" && (
          <p className="mt-3 text-sm font-semibold text-rose-600">
            Não foi possível abrir o chamado. Tente novamente.
          </p>
        )}
      </section>
    </div>
  );
}
