import type { ApprovalDriverFields, PendingUser } from "@/lib/dashboardTypes";
import { Loader2 } from "lucide-react";

export function RegistrationRequestsPanel({
  requests,
  approvalRoles,
  approvalDriverFields,
  initialPasswords,
  onInitialPasswordChange,
  canManageRoles,
  canManageStatus,
  onRoleChange,
  onDriverFieldChange,
  onApprove,
  onReject,
  processingRequest,
  onClose,
  onReopen,
}: {
  requests: PendingUser[];
  approvalRoles: Record<
    string,
    "driver" | "carrier" | "client" | "operator" | "admin"
  >;
  approvalDriverFields: Record<string, ApprovalDriverFields>;
  initialPasswords: Record<string, string>;
  onInitialPasswordChange: (userId: string, value: string) => void;
  canManageRoles: boolean;
  canManageStatus: boolean;
  onRoleChange: (
    userId: string,
    value: "driver" | "carrier" | "client" | "operator" | "admin",
  ) => void;
  onDriverFieldChange: (
    userId: string,
    field: keyof ApprovalDriverFields,
    value: string,
  ) => void;
  onApprove: (request: PendingUser) => void;
  onReject: (request: PendingUser) => void;
  processingRequest: {
    id: string;
    action: "approve" | "reject";
  } | null;
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
            const isApproving =
              processingRequest?.id === request.id &&
              processingRequest.action === "approve";
            const isRejecting =
              processingRequest?.id === request.id &&
              processingRequest.action === "reject";
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
                        : request.requested_role === "carrier"
                          ? "transportadora"
                          : request.requested_role === "client"
                            ? "cliente"
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
                {(selectedRole === "carrier" || selectedRole === "client") && (
                  <div className="grid gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3 sm:grid-cols-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-blue-900 sm:col-span-2">
                      {selectedRole === "client"
                        ? "Dados do cliente para conferência"
                        : "Dados da transportadora para conferência"}
                    </p>
                    <ReadOnlyField
                      label="Sócio representante"
                      value={request.full_name ?? "Não informado"}
                    />
                    <ReadOnlyField
                      label="E-mail da conta"
                      value={request.email}
                    />
                    <ReadOnlyField
                      label="Telefone / WhatsApp"
                      value={
                        request.company?.phone ??
                        request.phone ??
                        "Não informado"
                      }
                    />
                    <ReadOnlyField
                      label="Razão social"
                      value={request.company?.legal_name ?? "Não informado"}
                    />
                    <ReadOnlyField
                      label="CNPJ"
                      value={request.company?.cnpj ?? "Não informado"}
                    />
                    <ReadOnlyField
                      label="Inscrição estadual"
                      value={
                        request.company?.state_registration ?? "Não informada"
                      }
                    />
                    <ReadOnlyField
                      label="Endereço"
                      value={request.company?.address ?? "Não informado"}
                    />
                    <ReadOnlyField
                      label="Situação"
                      value={
                        request.company?.status === "in_analysis"
                          ? "Em análise"
                          : (request.company?.status ?? "Não informado")
                      }
                    />
                  </div>
                )}
                {!request.approval_closed && (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {canManageRoles && (
                        <select
                          value={selectedRole}
                          onChange={(event) =>
                            onRoleChange(
                              request.id,
                              event.target.value as
                                | "driver"
                                | "carrier"
                                | "client"
                                | "operator"
                                | "admin",
                            )
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700"
                          aria-label={`Perfil de ${request.full_name ?? request.email}`}
                        >
                          <option value="driver">Motorista</option>
                          <option value="carrier">Transportadora</option>
                          <option value="client">Cliente</option>
                          <option value="operator">Operador</option>
                          <option value="admin">Administrador</option>
                        </select>
                      )}
                      {canManageStatus && (
                        <button
                          type="button"
                          onClick={() => onApprove(request)}
                          disabled={Boolean(processingRequest)}
                          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isApproving && (
                            <Loader2 size={14} className="animate-spin" />
                          )}
                          {isApproving ? "Aprovando..." : "Aprovar cadastro"}
                        </button>
                      )}
                      {canManageStatus && (
                        <button
                          type="button"
                          onClick={() => onReject(request)}
                          disabled={Boolean(processingRequest)}
                          className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isRejecting && (
                            <Loader2 size={14} className="animate-spin" />
                          )}
                          {isRejecting ? "Rejeitando..." : "Rejeitar cadastro"}
                        </button>
                      )}
                      {canManageStatus && (
                        <button
                          type="button"
                          onClick={() => onClose(request.id)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Fechar aprovação
                        </button>
                      )}
                    </div>
                    {selectedRole === "driver" && (
                      <>
                        {!request.driver && !request.company_id && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                            Este cadastro foi criado sem os dados do motorista
                            persistidos. Solicite um novo cadastro antes de
                            aprovar.
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ReadOnlyField
                            label="Vínculo profissional"
                            value={
                              approvalDriverFields[request.id] &&
                              request.driver?.employment_type === "carrier"
                                ? `Motorista de transportadora${request.driver.carrier?.name ? `: ${request.driver.carrier.name}` : ""}`
                                : "Autônomo"
                            }
                          />
                          {(
                            [
                              "full_name",
                              "phone",
                              "cpf",
                              "cnh",
                              "cnh_category",
                              "cnh_expires_at",
                              "vehicle_model",
                              "vehicle_year",
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
                              placeholder={`${fieldLabel[field]}${request.company_id ? "" : " *"}`}
                              type={
                                field === "cnh_expires_at"
                                  ? "date"
                                  : field === "vehicle_year"
                                    ? "number"
                                    : "text"
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          ))}
                          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600 sm:col-span-2">
                            <input
                              type="checkbox"
                              checked={
                                approvalDriverFields[request.id]
                                  ?.location_sharing_authorized ?? false
                              }
                              onChange={(event) =>
                                onDriverFieldChange(
                                  request.id,
                                  "location_sharing_authorized",
                                  event.target.checked ? "true" : "false",
                                )
                              }
                            />
                            Autoriza compartilhamento da localização
                          </label>
                        </div>
                      </>
                    )}
                    {(selectedRole === "operator" ||
                      selectedRole === "admin") && (
                      <input
                        type="password"
                        value={initialPasswords[request.id] ?? ""}
                        onChange={(event) =>
                          onInitialPasswordChange(
                            request.id,
                            event.target.value,
                          )
                        }
                        placeholder="Senha inicial (mínimo 8 caracteres) *"
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    )}
                  </>
                )}
                {request.approval_closed && canManageStatus && (
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
  vehicle_year: "Ano do veículo",
  plate: "Placa",
  city: "Cidade",
  state: "UF",
  capacity: "Capacidade",
  compartments: "Compartimentação",
  cpf: "CPF",
  cnh: "CNH",
  cnh_category: "Categoria da CNH",
  cnh_expires_at: "Validade da CNH",
  location_sharing_authorized: "Autorização de localização",
  employment_type: "Vínculo profissional",
  carrier: "Transportadora",
};

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 break-words text-xs font-medium text-slate-700">
        {value}
      </p>
    </div>
  );
}
