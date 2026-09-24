import { Construction, MapPin } from "lucide-react";
import { SettingsMenu } from "@/components/SettingsMenu";

export function ClientPortal({
  fullName,
  email,
  onSignOut,
}: {
  fullName: string;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="min-h-screen bg-[#f5f7fa] p-4 sm:p-6">
      <header className="mx-auto flex max-w-5xl items-center justify-between rounded-2xl bg-[#0b1d3a] px-5 py-4 text-white shadow-lg sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-blue-200">
            Portal do cliente
          </p>
          <h1 className="text-xl font-bold">{fullName || "Cliente"}</h1>
          <p className="text-xs text-blue-100/70">{email}</p>
        </div>
        <SettingsMenu onSignOut={onSignOut} />
      </header>

      <main className="mx-auto mt-6 max-w-5xl">
        <section className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#1052c7]">
            <Construction size={30} />
          </div>
          <h2 className="mt-5 text-2xl font-bold text-[#0b1d3a]">
            Tela em desenvolvimento
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Estamos preparando sua área para acompanhar cargas, consultar
            transportes e acessar as informações dos seus pedidos.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
            <MapPin size={17} />
            Novos recursos serão disponibilizados em breve.
          </div>
        </section>
      </main>
    </div>
  );
}
