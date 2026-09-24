import { useEffect, useState } from "react";
import {
  Mail,
  Lock,
  User,
  Phone,
  Eye,
  EyeOff,
  ArrowRight,
  Building2,
  MapPin,
  IdCard,
  CalendarDays,
  Truck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthScreen() {
  const { signIn, signUp, requestPasswordReset, resetPassword } = useAuth();
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">("signin");
  const [signupOpen, setSignupOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [driver, setDriver] = useState({
    cpf: "",
    vehicleModel: "",
    vehicleYear: "",
    capacity: "",
    compartments: "",
    plate: "",
    cnh: "",
    cnhCategory: "",
    cnhExpiresAt: "",
    city: "",
    state: "",
    locationSharingAuthorized: false,
    employmentType: "autonomous" as "autonomous" | "carrier",
    carrierId: "",
  });
  const [transportCompanies, setTransportCompanies] = useState<
    Array<{ id: string; name: string; cnpj: string }>
  >([]);
  const [resetToken, setResetToken] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [registrationNotes, setRegistrationNotes] = useState("");
  const [requestedRole, setRequestedRole] = useState<"driver" | "carrier">(
    "driver",
  );
  const [company, setCompany] = useState({
    legalName: "",
    cnpj: "",
    stateRegistration: "",
    address: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registrationSent, setRegistrationSent] = useState(false);

  useEffect(() => {
    if (!signupOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [signupOpen]);

  useEffect(() => {
    if (!signupOpen || requestedRole !== "driver") return;
    void apiFetch("/api/transport-companies")
      .then(
        (response) =>
          response.json() as Promise<{ companies?: typeof transportCompanies }>,
      )
      .then((body) => setTransportCompanies(body.companies ?? []))
      .catch(() => setTransportCompanies([]));
  }, [signupOpen, requestedRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (signupOpen) {
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
        requestedRole === "carrier" ? company : undefined,
        requestedRole === "driver"
          ? {
              ...driver,
              vehicleYear: driver.vehicleYear
                ? Number(driver.vehicleYear)
                : undefined,
            }
          : undefined,
      );
      if (result.pending) {
        setSignupOpen(false);
        setRegistrationSent(true);
      } else if (result.error) {
        setError(result.error);
      }
      setSubmitting(false);
      return;
    }

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
            <h2 className="text-xl font-bold text-[#0b1d3a]">
              {mode === "signin"
                ? "Bem-vindo de volta"
                : mode === "forgot"
                  ? "Recuperar senha"
                  : "Definir nova senha"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "signin"
                ? "Acesse o Next Driver com seus dados."
                : "Use um código válido e uma senha nova para proteger sua conta."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                    : mode === "forgot"
                      ? "Solicitar recuperação"
                      : "Redefinir senha"}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>
            {mode === "signin" && (
              <>
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
                <button
                  type="button"
                  onClick={() => {
                    setSignupOpen(true);
                    setError(null);
                  }}
                  className="mt-3 w-full text-sm font-semibold text-slate-500 hover:text-[#1052c7] hover:underline"
                >
                  Ainda não tenho cadastro
                </button>
              </>
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
      {signupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#07152b]/70 p-2 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-modal-title"
        >
          <div className="h-[calc(100dvh-1rem)] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-2xl [scrollbar-width:none] sm:h-[calc(100dvh-2rem)] sm:p-7 lg:h-auto lg:max-h-[calc(100dvh-2rem)] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
                  Novo cadastro
                </p>
                <h2
                  id="signup-modal-title"
                  className="mt-1 text-2xl font-bold text-[#0b1d3a]"
                >
                  Crie seu acesso
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Todos os cadastros passam pela aprovação da operação.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSignupOpen(false)}
                className="text-2xl leading-none text-slate-400 hover:text-slate-700"
                aria-label="Fechar cadastro"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} className="mt-4 space-y-2.5">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setRequestedRole("driver")}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${requestedRole === "driver" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
                >
                  Motorista
                </button>
                <button
                  type="button"
                  onClick={() => setRequestedRole("carrier")}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${requestedRole === "carrier" ? "bg-white text-[#0b1d3a] shadow-sm" : "text-slate-500"}`}
                >
                  Transportadora
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <InputField
                  icon={User}
                  type="text"
                  placeholder={
                    requestedRole === "carrier"
                      ? "Nome do sócio representante *"
                      : "Nome completo *"
                  }
                  value={fullName}
                  onChange={setFullName}
                  required
                />
                <InputField
                  icon={Phone}
                  type="tel"
                  placeholder="Celular / WhatsApp *"
                  value={phone}
                  onChange={setPhone}
                  required
                />
                <InputField
                  icon={Mail}
                  type="email"
                  placeholder="E-mail *"
                  value={email}
                  onChange={setEmail}
                  required
                />
                <InputField
                  icon={Lock}
                  type="password"
                  placeholder="Senha *"
                  value={password}
                  onChange={setPassword}
                  required
                />
              </div>
              {requestedRole === "driver" ? (
                <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="text-sm font-semibold text-blue-900">
                    Dados do motorista
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <InputField
                      icon={IdCard}
                      type="text"
                      placeholder="CPF *"
                      value={driver.cpf}
                      onChange={(value) =>
                        setDriver((current) => ({ ...current, cpf: value }))
                      }
                      required
                    />
                    <InputField
                      icon={IdCard}
                      type="text"
                      placeholder="CNH *"
                      value={driver.cnh}
                      onChange={(value) =>
                        setDriver((current) => ({ ...current, cnh: value }))
                      }
                      required
                    />
                    <InputField
                      icon={IdCard}
                      type="text"
                      placeholder="Categoria da CNH *"
                      value={driver.cnhCategory}
                      onChange={(value) =>
                        setDriver((current) => ({
                          ...current,
                          cnhCategory: value.toUpperCase(),
                        }))
                      }
                      required
                    />
                    <label className="relative flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500">
                      <CalendarDays
                        size={18}
                        className="shrink-0 text-slate-400"
                      />
                      <input
                        type="date"
                        value={driver.cnhExpiresAt}
                        onChange={(event) =>
                          setDriver((current) => ({
                            ...current,
                            cnhExpiresAt: event.target.value,
                          }))
                        }
                        required
                        className="min-w-0 flex-1 bg-transparent outline-none"
                      />
                    </label>
                    <InputField
                      icon={MapPin}
                      type="text"
                      placeholder="Cidade *"
                      value={driver.city}
                      onChange={(value) =>
                        setDriver((current) => ({ ...current, city: value }))
                      }
                      required
                    />
                    <InputField
                      icon={MapPin}
                      type="text"
                      placeholder="UF *"
                      value={driver.state}
                      onChange={(value) =>
                        setDriver((current) => ({
                          ...current,
                          state: value.toUpperCase(),
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="rounded-xl border border-dashed border-blue-200 bg-white/70 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-blue-900">
                        Vínculo profissional *
                        <select
                          value={driver.employmentType}
                          onChange={(event) =>
                            setDriver((current) => ({
                              ...current,
                              employmentType: event.target.value as
                                | "autonomous"
                                | "carrier",
                              carrierId:
                                event.target.value === "autonomous"
                                  ? ""
                                  : current.carrierId,
                            }))
                          }
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="autonomous">Autônomo</option>
                          <option value="carrier">
                            Motorista de transportadora
                          </option>
                        </select>
                      </label>
                      {driver.employmentType === "carrier" && (
                        <label className="flex flex-col gap-1 text-xs font-semibold text-blue-900">
                          Transportadora *
                          <select
                            value={driver.carrierId}
                            onChange={(event) =>
                              setDriver((current) => ({
                                ...current,
                                carrierId: event.target.value,
                              }))
                            }
                            required
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Selecione a transportadora</option>
                            {transportCompanies.map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name} · {company.cnpj}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-800">
                      <Truck size={15} /> Veículo próprio (obrigatório)
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <InputField
                        icon={Truck}
                        type="text"
                        placeholder="Tipo / modelo *"
                        value={driver.vehicleModel}
                        onChange={(value) =>
                          setDriver((current) => ({
                            ...current,
                            vehicleModel: value,
                          }))
                        }
                        required
                      />
                      <InputField
                        icon={Truck}
                        type="text"
                        placeholder="Ano *"
                        value={driver.vehicleYear}
                        onChange={(value) =>
                          setDriver((current) => ({
                            ...current,
                            vehicleYear: value.replace(/\D/g, "").slice(0, 4),
                          }))
                        }
                        required
                      />
                      <InputField
                        icon={Truck}
                        type="text"
                        placeholder="Placa *"
                        value={driver.plate}
                        onChange={(value) =>
                          setDriver((current) => ({
                            ...current,
                            plate: value.toUpperCase(),
                          }))
                        }
                        required
                      />
                      <InputField
                        icon={Truck}
                        type="text"
                        placeholder="Capacidade *"
                        value={driver.capacity}
                        onChange={(value) =>
                          setDriver((current) => ({
                            ...current,
                            capacity: value,
                          }))
                        }
                        required
                      />
                      <InputField
                        icon={Truck}
                        type="text"
                        placeholder="Compartimentação *"
                        value={driver.compartments}
                        onChange={(value) =>
                          setDriver((current) => ({
                            ...current,
                            compartments: value,
                          }))
                        }
                        required
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-blue-900">
                    <input
                      type="checkbox"
                      checked={driver.locationSharingAuthorized}
                      onChange={(event) =>
                        setDriver((current) => ({
                          ...current,
                          locationSharingAuthorized: event.target.checked,
                        }))
                      }
                    />{" "}
                    Autorizo o compartilhamento da minha localização.
                  </label>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    Dados da transportadora
                  </p>
                  <InputField
                    icon={Building2}
                    type="text"
                    placeholder="Razão social *"
                    value={company.legalName}
                    onChange={(value) =>
                      setCompany((current) => ({
                        ...current,
                        legalName: value,
                      }))
                    }
                    required
                  />
                  <InputField
                    icon={Building2}
                    type="text"
                    placeholder="CNPJ *"
                    value={company.cnpj}
                    onChange={(value) =>
                      setCompany((current) => ({ ...current, cnpj: value }))
                    }
                    required
                  />
                  <InputField
                    icon={Building2}
                    type="text"
                    placeholder="Inscrição estadual (opcional)"
                    value={company.stateRegistration}
                    onChange={(value) =>
                      setCompany((current) => ({
                        ...current,
                        stateRegistration: value,
                      }))
                    }
                  />
                  <InputField
                    icon={MapPin}
                    type="text"
                    placeholder="Endereço completo *"
                    value={company.address}
                    onChange={(value) =>
                      setCompany((current) => ({ ...current, address: value }))
                    }
                    required
                  />
                </div>
              )}
              <textarea
                value={registrationNotes}
                onChange={(event) => setRegistrationNotes(event.target.value)}
                placeholder="Observações do cadastro (opcional)"
                rows={2}
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
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
                {submitting ? "Enviando..." : "Enviar cadastro"}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function InitialPasswordScreen() {
  const { changeInitialPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("A nova senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    const result = await changeInitialPassword(password);
    if (result.error) setError(result.error);
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#0e4db7] to-[#0a3a90] p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
      >
        <h1 className="text-xl font-bold text-[#0b1d3a]">
          Defina sua nova senha
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Use a senha inicial recebida do administrador apenas no primeiro
          acesso.
        </p>
        <div className="mt-6 space-y-4">
          <InputField
            icon={Lock}
            type="password"
            placeholder="Nova senha"
            value={password}
            onChange={setPassword}
            required
          />
          <InputField
            icon={Lock}
            type="password"
            placeholder="Confirme a nova senha"
            value={confirmation}
            onChange={setConfirmation}
            required
          />
          {error && (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          <button
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e4db7] py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Salvando..." : "Salvar nova senha"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
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
        className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}
