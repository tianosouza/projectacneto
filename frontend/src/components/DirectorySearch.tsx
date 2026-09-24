import { Search } from "lucide-react";
import type { DemoDriver, DirectoryOperator } from "@/lib/dashboardTypes";
import { isDriverCurrentlyOnline } from "@/lib/dashboardData";
import { DirectoryRow } from "@/components/DashboardPrimitives";

export function DirectorySearch({
  role,
  search,
  onSearch,
  matchedDrivers,
  matchedOperators,
  onEditDriver,
}: {
  role: "operator" | "admin";
  search: string;
  onSearch: (value: string) => void;
  matchedDrivers: DemoDriver[];
  matchedOperators: DirectoryOperator[];
  onEditDriver: (driver: DemoDriver) => void;
}) {
  const trimmedSearch = search.trim();
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Search size={18} className="text-[#1052c7]" />
        <div>
          <h2 className="font-bold text-[#0b1d3a]">Buscar cadastros</h2>
          <p className="text-xs text-slate-500">
            {role === "admin"
              ? "Pesquise operadores e motoristas pelo nome."
              : "Pesquise motoristas online pelo nome."}
          </p>
        </div>
      </div>
      <input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Digite pelo menos 3 letras do nome"
        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        aria-label="Buscar cadastros por nome"
      />
      {trimmedSearch.length > 0 && trimmedSearch.length < 3 && (
        <p className="mt-2 text-xs font-semibold text-amber-600">
          Digite mais {3 - trimmedSearch.length} letra
          {3 - trimmedSearch.length > 1 ? "s" : ""} para iniciar a busca.
        </p>
      )}
      {trimmedSearch.length >= 3 && (
        <div className="mt-3 space-y-2">
          {matchedOperators.map((operator) => (
            <DirectoryRow
              key={`operator-${operator.id}`}
              title={operator.full_name ?? "Operador sem nome"}
              detail={`${operator.email} · Operador`}
              onEdit={() => undefined}
            />
          ))}
          {matchedDrivers.map((driver) => (
            <DirectoryRow
              key={`driver-${driver.id}`}
              title={driver.full_name}
              detail={`${driver.city ?? "Localização não informada"} · ${isDriverCurrentlyOnline(driver) ? "Motorista online" : "Motorista offline"}`}
              onEdit={() => onEditDriver(driver)}
            />
          ))}
          {matchedOperators.length === 0 && matchedDrivers.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              Nenhum cadastro encontrado com esse nome.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
