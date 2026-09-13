import { useState } from "react";
import { Mail, Lock, User, Phone, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthScreen() {
  const { signIn, signUp, requestPasswordReset, resetPassword } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(
    "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [requestedRole, setRequestedRole] = useState<"driver" | "operator">(
    "driver",
  );
  const [registrationNotes, setRegistrationNotes] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registrationSent, setRegistrationSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (mode === "forgot") {
      const result = await requestPasswordReset(email);
      if (result.error) setError(result.error);
      else {
        if (result.resetToken) setResetToken(result.resetToken);
        setMode("reset");
        setError(
          "Se o e-mail estiver cadastrado, as instruções foram preparadas.",
        );
      }
      setSubmitting(false);
      return;
    }

    if (mode === "reset") {
      if (resetPasswordValue.length < 6) {
        setError("A nova senha deve ter no mínimo 6 caracteres.");
        setSubmitting(false);
        return;
      }
      const result = await resetPassword(resetToken, resetPasswordValue);
      if (result.error) setError(result.error);
      else {
        setMode("signin");
        setPassword("");
        setResetPasswordValue("");
        setError("Senha redefinida. Faça login com a nova senha.");
      }
      setSubmitting(false);
      return;
    }

    if (mode === "signin") {
      const { error: err } = await signIn(email, password);
      if (err) setError(err);
    } else {
      if (password.length < 6) {
        setError("A senha deve ter no mínimo 6 caracteres.");
        setSubmitting(false);
        return;
      }
      const result = await signUp(
        email,
        password,
        fullName,
        phone,
        requestedRole,
        registrationNotes,
      );
      if (result.pending) {
        setRegistrationSent(true);
      } else if (result.error) {
        setError(result.error);
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#0e4db7] to-[#0a3a90] lg:grid lg:grid-cols-2">
      <ConfirmationModal
        open={registrationSent}
        title="Cadastro enviado"
        message="Seu cadastro foi enviado com sucesso. Aguarde a aprovação do administrador."
        actionLabel="Entendi"
        onClose={() => window.location.reload()}
      />
      <div className="relative hidden flex-col justify-between p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/10 backdrop-blur ring-1 ring-white/20">
            <img
              src="/logo-ac-neto.svg"
              alt="A C Neto Transportes"
              className="h-14 w-14 object-contain"
            />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            A C Neto Transportes
          </span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight text-white xl:text-5xl">
            <span className="text-[#f3d32e]">Next Driver</span>
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-blue-100/80">
            Fique online, seja encontrado pelos operadores e negocie fretes em
            tempo real, direto do seu celular.
          </p>
          <div className="mt-10 flex items-center gap-6">
            <div className="flex items-center gap-2.5 text-sm text-blue-100/80">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />{" "}
              Online agora
            </div>
          </div>
        </div>
        <p className="text-xs text-blue-200/40">
          © 2026 A C Neto Transportes. Todos os direitos reservados.
          Desenvolvido por{" "}
          <a
            href="https://wa.me/+558599465250"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-blue-100/70 transition hover:text-white hover:underline"
          >
            ST3 - Next Driver
          </a>
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/20">
              <img
                src="/logo-ac-neto.svg"
                alt="A C Neto Transportes"
                className="h-11 w-11 object-contain"
              />
            </div>
            <span className="text-base font-bold text-white">
              A C Neto Transportes
            </span>
            <ThemeToggle />
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === "signin"
                    ? "bg-white text-[#0b1d3a] shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Entrar
              </button>
              <button
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === "signup"
                    ? "bg-white text-[#0b1d3a] shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Criar conta
              </button>
            </div>

            <h2 className="text-xl font-bold text-[#0b1d3a]">
              {mode === "signin"
                ? "Bem-vindo de volta"
                : mode === "signup"
                  ? "Crie sua conta"
                  : mode === "forgot"
                    ? "Recuperar senha"
                    : "Definir nova senha"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "signin"
                ? "Acesse o Next Driver com seus dados."
                : mode === "signup"
                  ? "Cadastre-se para começar a receber fretes."
                  : "Use um código válido e uma senha nova para proteger sua conta."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <>
                  <InputField
                    icon={User}
                    type="text"
                    placeholder="Nome completo"
                    value={fullName}
                    onChange={setFullName}
                    required
                  />
                  <InputField
                    icon={Phone}
                    type="tel"
                    placeholder="Telefone / WhatsApp"
                    value={phone}
                    onChange={setPhone}
                    required
                  />
                  <select
                    value={requestedRole}
                    onChange={(event) =>
                      setRequestedRole(
                        event.target.value as "driver" | "operator",
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-3.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    aria-label="Tipo de cadastro pretendido"
                  >
                    <option value="driver">Pretendo ser motorista</option>
                    <option value="operator">Pretendo ser operador</option>
                  </select>
                  <textarea
                    value={registrationNotes}
                    onChange={(event) =>
                      setRegistrationNotes(event.target.value)
                    }
                    placeholder="Observação: conte brevemente sobre o cadastro que pretende realizar"
                    rows={3}
                    maxLength={1000}
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </>
              )}
              {mode !== "reset" && (
                <InputField
                  icon={Mail}
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={setEmail}
                  required
                />
              )}
              {mode !== "forgot" && (
                <div className="relative">
                  <InputField
                    icon={Lock}
                    type={showPassword ? "text" : "password"}
                    placeholder="Senha"
                    value={password}
                    onChange={setPassword}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={
                      showPassword ? "Ocultar senha" : "Mostrar senha"
                    }
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              )}
              {mode === "reset" && (
                <>
                  <InputField
                    icon={Lock}
                    type="text"
                    placeholder="Código de recuperação"
                    value={resetToken}
                    onChange={setResetToken}
                    required
                  />
                  <InputField
                    icon={Lock}
                    type="password"
                    placeholder="Nova senha"
                    value={resetPasswordValue}
                    onChange={setResetPasswordValue}
                    required
                  />
                </>
              )}

              {error && (
                <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e4db7] py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-[#0a3a90] disabled:opacity-60"
              >
                {submitting
                  ? "Aguarde..."
                  : mode === "signin"
                    ? "Entrar no portal"
                    : mode === "signup"
                      ? "Criar conta"
                      : mode === "forgot"
                        ? "Solicitar recuperação"
                        : "Redefinir senha"}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>
            {mode === "signin" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                }}
                className="mt-4 w-full text-sm font-semibold text-[#1052c7] hover:underline"
              >
                Esqueci minha senha
              </button>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="mt-4 w-full text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Voltar para entrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InputField({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  required,
}: {
  icon: typeof Mail;
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <Icon
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
        size={18}
      />
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-slate-200 py-3.5 pl-11 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}
