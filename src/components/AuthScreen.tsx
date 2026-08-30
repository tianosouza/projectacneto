import { useState } from "react";
import {
  Truck,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  Shield,
  Briefcase,
} from "lucide-react";
import {
  useAuth,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  type DemoRole,
} from "@/lib/auth";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (mode === "signin") {
      const { error: err } = await signIn(email, password);
      if (err) setError(err);
    } else {
      if (password.length < 6) {
        setError("A senha deve ter no mínimo 6 caracteres.");
        setSubmitting(false);
        return;
      }
      const { error: err } = await signUp(email, password, fullName);
      if (err) setError(err);
    }
    setSubmitting(false);
  };

  const handleDemoLogin = async (role: DemoRole) => {
    const account = DEMO_ACCOUNTS[role];
    setError(null);
    setSubmitting(true);
    setEmail(account.email);
    setPassword(account.password);
    const { error: err } = await signIn(account.email, account.password);
    if (err) setError(err);
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#0e4db7] to-[#0a3a90] lg:grid lg:grid-cols-2">
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
            Portal do <span className="text-[#f3d32e]">Motorista</span>
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
            <div className="text-sm text-blue-100/50">
              +250 motoristas ativos
            </div>
          </div>
        </div>
        <p className="text-xs text-blue-200/40">
          © 2026 A C Neto Transportes. Todos os direitos reservados.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
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
              {mode === "signin" ? "Bem-vindo de volta" : "Crie sua conta"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "signin"
                ? "Acesse o portal do motorista com seus dados."
                : "Cadastre-se para começar a receber fretes."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <InputField
                  icon={User}
                  type="text"
                  placeholder="Nome completo"
                  value={fullName}
                  onChange={setFullName}
                  required
                />
              )}
              <InputField
                icon={Mail}
                type="email"
                placeholder="E-mail"
                value={email}
                onChange={setEmail}
                required
              />
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
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

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
                    : "Criar conta"}
                {!submitting && <ArrowRight size={16} />}
              </button>

              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                  <Sparkles size={13} /> Demo por perfil
                </div>
                <div className="grid gap-2">
                  {(Object.keys(DEMO_ACCOUNTS) as DemoRole[]).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleDemoLogin(role)}
                      disabled={submitting}
                      className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2">
                        {role === "driver" && <Truck size={15} />}
                        {role === "operator" && <Briefcase size={15} />}
                        {role === "admin" && <Shield size={15} />}
                        {role === "driver"
                          ? "Motorista"
                          : role === "operator"
                            ? "Operador"
                            : "Administrador"}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-amber-700">
                        {DEMO_ACCOUNTS[role].email}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </form>

            <p className="mt-5 text-center text-xs text-slate-400">
              Senha de demonstração: {DEMO_PASSWORD}
            </p>
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
