import { Download } from "lucide-react";

const APK_DOWNLOAD_URL = "/downloads/next-driver.apk";

export function AppDownloadButton({
  className = "",
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={APK_DOWNLOAD_URL}
      download
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-[#1052c7] transition hover:bg-blue-100 ${className}`}
      aria-label="Baixar a versao mais atual do aplicativo Android"
      title="Baixar APK atualizado"
    >
      <Download size={16} />
      <span className="hidden sm:inline">Baixar app atualizado</span>
      <span className="sm:hidden">APK</span>
    </a>
  );
}
