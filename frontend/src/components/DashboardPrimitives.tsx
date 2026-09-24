import { MessageCircle, Pencil, Search, Trash2, Users } from "lucide-react";
import type { DemoContact, DemoDriver } from "@/lib/dashboardTypes";

export function MetricCard({
  icon: Icon,
  label,
  value,
  active,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${active ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0b1d3a]">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1052c7]">
          <Icon size={20} />
        </div>
      </div>
    </button>
  );
}

export function DirectoryRow({
  title,
  detail,
  phone,
  badge,
  onEdit,
  onDelete,
}: {
  title: string;
  detail: string;
  phone?: string | null;
  badge?: string;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="truncate font-semibold text-[#0b1d3a]">{title}</p>
        <p className="truncate text-xs text-slate-500">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {badge && (
          <span className="hidden text-[10px] font-semibold uppercase text-slate-400 sm:block">
            {badge}
          </span>
        )}
        {phone && (
          <a
            href={`https://wa.me/${phone.replace(/\D/g, "").replace(/^([^5]|5[^5])/, "55$1")}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-2 text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700"
            aria-label={`Conversar com ${title} pelo WhatsApp`}
            title="WhatsApp"
          >
            <MessageCircle size={15} />
          </a>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700"
          aria-label={`Editar ${title}`}
          title="Editar"
        >
          <Pencil size={15} />
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
            aria-label={`Excluir ${title}`}
            title="Excluir"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export function DirectoryPanel({
  directory,
  searchTerm,
  setSearchTerm,
  clients,
  operators,
  drivers,
  onEditContact,
  onDeleteContact,
  onEditDriver,
  onDeleteDriver,
  canDelete,
}: {
  directory: "clients" | "operators" | "drivers";
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  clients: DemoContact[];
  operators: DemoContact[];
  drivers: DemoDriver[];
  onEditContact: (item: DemoContact) => void;
  onDeleteContact: (item: DemoContact) => void;
  onEditDriver: (item: DemoDriver) => void;
  onDeleteDriver: (item: DemoDriver) => void;
  canDelete: boolean;
}) {
  const title =
    directory === "clients"
      ? "Clientes"
      : directory === "operators"
        ? "Operadores"
        : "Motoristas disponíveis";
  const contacts = directory === "clients" ? clients : operators;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0b1d3a]">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {directory === "drivers" ? drivers.length : contacts.length}
        </span>
      </div>
      <div className="relative mb-4">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={17}
        />
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={`Buscar em ${title.toLowerCase()}`}
          className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          aria-label={`Buscar em ${title}`}
        />
      </div>
      <div className="space-y-2">
        {directory === "drivers"
          ? drivers.map((driver) => (
              <DirectoryRow
                key={driver.id}
                title={driver.full_name}
                detail={`${driver.availability_city ? `Previsto em ${driver.availability_city} · ${formatDriverAvailability(driver.availability_at)}` : (driver.city ?? "Cidade não informada")} · ${formatDriverLastSeen(driver.last_seen)} · ${driver.current_vehicle ? `${driver.current_vehicle.plate} · ${driver.current_vehicle.type}` : (driver.vehicle_model ?? "Veículo não vinculado")} · ${driver.carrier?.name ?? "Autônomo"}`}
                badge={driver.homologation_status ?? "Em análise"}
                onEdit={() => onEditDriver(driver)}
                onDelete={canDelete ? () => onDeleteDriver(driver) : undefined}
              />
            ))
          : contacts.map((item) => (
              <DirectoryRow
                key={item.id}
                title={item.name}
                detail={`${item.email} · ${item.region || "Região não informada"}`}
                phone={item.phone}
                badge={item.accessLevel}
                onEdit={() => onEditContact(item)}
                onDelete={canDelete ? () => onDeleteContact(item) : undefined}
              />
            ))}
        {((directory === "drivers" && drivers.length === 0) ||
          (directory !== "drivers" && contacts.length === 0)) && (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Nenhum cadastro encontrado.
          </p>
        )}
      </div>
    </div>
  );
}

function formatDriverLastSeen(value: string | undefined): string {
  if (!value) return "Data/hora não informada";
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Data/hora não informada";
  return `Atualizado em ${timestamp.toLocaleString("pt-BR")}`;
}

function formatDriverAvailability(value: string | null | undefined): string {
  if (!value) return "Data/hora não informada";
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Data/hora não informada";
  const today = new Date();
  const dateOnly = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
  ).getTime();
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const dayDifference = Math.round((dateOnly - todayOnly) / 86_400_000);
  const dayLabel =
    dayDifference === 0
      ? "Hoje"
      : dayDifference === 1
        ? "Amanhã"
        : timestamp.toLocaleDateString("pt-BR");
  return `${dayLabel} às ${timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
