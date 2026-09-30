import { useState } from "react";
import { Paperclip, X } from "lucide-react";

const allowedTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export function RegistrationAttachmentsField({
  attachments,
  onChange,
}: {
  attachments: File[];
  onChange: (attachments: File[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const addFiles = (files: File[]) => {
    const next = [...attachments, ...files];
    if (next.length > 5) {
      setError("Você pode anexar no máximo 5 arquivos.");
    } else if (files.some((file) => !allowedTypes.includes(file.type))) {
      setError("Use arquivos PDF, JPG, PNG ou WebP.");
    } else if (files.some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Cada arquivo pode ter no máximo 5 MB.");
    } else if (
      next.reduce((total, file) => total + file.size, 0) >
      12 * 1024 * 1024
    ) {
      setError("O tamanho total dos anexos não pode passar de 12 MB.");
    } else {
      onChange(next);
      setError(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
        <Paperclip size={16} />
        Anexar documentos *
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      <p className="text-xs text-slate-500">
        Obrigatório: envie pelo menos 1 PDF ou foto. Até 5 arquivos e 5 MB por
        arquivo.
      </p>
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
      {attachments.map((file, index) => (
        <div
          key={`${file.name}-${file.lastModified}-${index}`}
          className="flex items-center justify-between gap-2 text-xs text-slate-600"
        >
          <span className="min-w-0 truncate">
            {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
          </span>
          <button
            type="button"
            onClick={() =>
              onChange(
                attachments.filter((_, fileIndex) => fileIndex !== index),
              )
            }
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            aria-label={`Remover ${file.name}`}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
