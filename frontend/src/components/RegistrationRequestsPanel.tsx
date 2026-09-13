import type { ApprovalDriverFields, PendingUser } from "@/lib/dashboardTypes";

export function RegistrationRequestsPanel({
  requests,
  approvalRoles,
  approvalDriverFields,
  onRoleChange,
  onDriverFieldChange,
  onApprove,
  onClose,
  onReopen,
}: {
  requests: PendingUser[];
  approvalRoles: Record<string, "driver" | "operator" | "admin">;
  approvalDriverFields: Record<string, ApprovalDriverFields>;
  onRoleChange: (
    userId: string,
    value: "driver" | "operator" | "admin",
  ) => void;
  onDriverFieldChange: (
    userId: string,
    field: keyof ApprovalDriverFields,
    value: string,
  ) => void;
  onApprove: (request: PendingUser) => void;
  onClose: (userId: string) => void;
  onReopen: (userId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0b1d3a]">
            Solicitações de cadastro
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Consulte solicitações abertas e encerradas para uma nova análise.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          {requests.length}
        </span>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          Nenhuma solicitação registrada.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const selectedRole =
              approvalRoles[request.id] ?? request.requested_role;
            return (
              <div
                key={request.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-[#0b1d3a]">
                      {request.full_name || "Nome não informado"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {request.email} ·{" "}
                      {request.phone || "Telefone não informado"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Solicitação para{" "}
                      {request.requested_role === "operator"
                        ? "operador"
                        : "motorista"}{" "}
                      · {new Date(request.created_at).toLocaleString("pt-BR")}
                    </p>
                    {request.registration_notes && (
                      <p className="mt-2 text-sm text-slate-600">
                        {request.registration_notes}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 self-start rounded-full px-2.5 py-1 text-xs font-bold ${request.approval_closed ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}
                  >
                    {request.approval_closed ? "Fechada" : "Em análise"}
                  </span>
                </div>
                {!request.approval_closed && (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={selectedRole}
                        onChange={(event) =>
                          onRoleChange(
                            request.id,
                            event.target.value as
                              | "driver"
                              | "operator"
                              | "admin",
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700"
                        aria-label={`Perfil de ${request.full_name ?? request.email}`}
                      >
                        <option value="driver">Motorista</option>
                        <option value="operator">Operador</option>
                        <option value="admin">Administrador</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => onApprove(request)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Aprovar cadastro
                      </button>
                      <button
                        type="button"
                        onClick={() => onClose(request.id)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Fechar aprovação
                      </button>
                    </div>
                    {selectedRole === "driver" && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            "full_name",
                            "phone",
                            "vehicle_model",
                            "plate",
                            "city",
                            "state",
                            "capacity",
                            "compartments",
                          ] as const
                        ).map((field) => (
                          <input
                            key={field}
                            value={
                              approvalDriverFields[request.id]?.[field] ?? ""
                            }
                            onChange={(event) =>
                              onDriverFieldChange(
                                request.id,
                                field,
                                event.target.value,
                              )
                            }
                            placeholder={`${fieldLabel[field]} *`}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
                {request.approval_closed && (
                  <button
                    type="button"
                    onClick={() => onReopen(request.id)}
                    className="self-start rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Reabrir
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const fieldLabel: Record<keyof ApprovalDriverFields, string> = {
  full_name: "Nome completo",
  phone: "Telefone",
  vehicle_model: "Veículo",
  plate: "Placa",
  city: "Cidade",
  state: "UF",
  capacity: "Capacidade",
  compartments: "Compartimentação",
};
