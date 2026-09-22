import { useEffect, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { AppDownloadButton } from "@/components/AppDownloadButton";

export function SettingsMenu({
  onSignOut,
}: {
  onSignOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#1052c7]"
        aria-label="Abrir configurações"
        title="Configurações"
      >
        <Settings size={18} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          role="menu"
          aria-label="Configurações"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Configurações
          </p>
          <AppDownloadButton
            className="flex w-full rounded-lg border-transparent bg-transparent px-3 py-2 text-left hover:bg-blue-50"
            onClick={() => setOpen(false)}
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void onSignOut();
            }}
            className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
          >
            <LogOut size={17} /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
