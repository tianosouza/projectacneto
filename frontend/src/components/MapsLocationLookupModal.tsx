import { useEffect, useState } from "react";
import { ExternalLink, Loader2, MapPin, X } from "lucide-react";
import {
  googleMapsSearchUrl,
  resolveMapPoint,
  type MapPoint,
} from "@/lib/mapLink";

const openMapsPopup = (query: string) => {
  const width = Math.min(1100, window.screen.availWidth - 80);
  const height = Math.min(800, window.screen.availHeight - 80);
  const left = Math.max(0, (window.screen.availWidth - width) / 2);
  const top = Math.max(0, (window.screen.availHeight - height) / 2);
  window.open(
    googleMapsSearchUrl(query),
    "acneto-google-maps",
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  );
};

/**
 * Quando o geolocalizador não acha o endereço: abre o Google Maps já
 * pesquisando o endereço digitado e coleta o link (ou coordenadas) do ponto.
 */
export function MapsLocationLookupModal({
  query,
  onCancel,
  onConfirm,
}: {
  query: string | null;
  onCancel: () => void;
  onConfirm: (point: MapPoint) => void;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!query) return;
    setLink("");
    setError("");
  }, [query]);

  if (!query) return null;

  const confirm = async () => {
    setResolving(true);
    setError("");
    const result = await resolveMapPoint(link);
    setResolving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onConfirm(result.point);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="maps-lookup-title"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <MapPin size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="maps-lookup-title"
              className="text-lg font-bold text-[#0b1d3a]"
            >
              Endereço não encontrado
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              O localizador não achou{" "}
              <strong className="text-slate-700">{query}</strong>. Pesquise no
              Google Maps para marcar o ponto exato.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => openMapsPopup(query)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-[#1052c7] hover:bg-blue-100"
        >
          <ExternalLink size={16} /> Pesquisar no Google Maps
        </button>

        <ol className="mt-3 list-decimal space-y-1 rounded-xl bg-slate-50 py-3 pl-8 pr-3 text-xs leading-relaxed text-slate-600">
          <li>No Google Maps, clique no local exato do cliente.</li>
          <li>
            Toque em <strong>Compartilhar</strong> → <strong>Copiar link</strong>{" "}
            (ou clique com o botão direito no ponto e copie as coordenadas).
          </li>
          <li>Cole abaixo e confirme.</li>
        </ol>

        <input
          value={link}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && link.trim() && !resolving)
              void confirm();
          }}
          placeholder="Cole o link do Google Maps ou as coordenadas"
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={resolving}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Corrigir endereço
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={resolving || !link.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1052c7] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0b3f9f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resolving && <Loader2 size={16} className="animate-spin" />}
            Usar esta localização
          </button>
        </div>
      </div>
    </div>
  );
}
