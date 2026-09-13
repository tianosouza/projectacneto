import { CheckCircle2, X } from "lucide-react";

export function ConfirmationModal({
  open,
  title,
  message,
  actionLabel = "Continuar",
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  actionLabel?: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={22} />
          </div>
          <div className="flex-1">
            <h2
              id="confirmation-modal-title"
              className="text-lg font-bold text-[#0b1d3a]"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              {message}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar confirmação"
          >
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-[#1052c7] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0b3f9f]"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
