import { useState } from "react";
import { ArrowRight, Shield, Truck, Users } from "lucide-react";

type RegistrationTab = "users" | "profiles" | "drivers";

type DemoUser = {
  id: string;
  email: string;
  fullName: string;
  password: string;
};

type DemoProfile = {
  id: string;
  fullName: string;
  role: "admin" | "operator" | "driver";
};

type DemoDriver = {
  id: string;
  fullName: string;
  phone: string;
  vehicleModel: string;
  plate: string;
  capacity: string;
  city: string;
  state: string;
};

const inputClass =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const load = <T,>(key: string, fallback: T[]): T[] => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const save = <T,>(key: string, value: T[]) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export function RegistrationPages() {
  const [tab, setTab] = useState<RegistrationTab>("users");
  const [users, setUsers] = useState<DemoUser[]>(() =>
    load("acneto-users", []),
  );
  const [profiles, setProfiles] = useState<DemoProfile[]>(() =>
    load("acneto-profiles", []),
  );
  const [drivers, setDrivers] = useState<DemoDriver[]>(() =>
    load("acneto-registered-drivers", []),
  );
  const [userForm, setUserForm] = useState({
    fullName: "",
    email: "",
    password: "",
  });
  const [profileForm, setProfileForm] = useState<DemoProfile>({
    id: "",
    fullName: "",
    role: "driver",
  });
  const [driverForm, setDriverForm] = useState<DemoDriver>({
    id: "",
    fullName: "",
    phone: "",
    vehicleModel: "",
    plate: "",
    capacity: "",
    city: "",
    state: "SP",
  });

  const addUser = () => {
    if (!userForm.fullName.trim() || !userForm.email.trim()) return;
    const next = [{ ...userForm, id: crypto.randomUUID() }, ...users];
    setUsers(next);
    save("acneto-users", next);
    setUserForm({ fullName: "", email: "", password: "" });
  };

  const addProfile = () => {
    if (!profileForm.fullName.trim()) return;
    const next = [{ ...profileForm, id: crypto.randomUUID() }, ...profiles];
    setProfiles(next);
    save("acneto-profiles", next);
    setProfileForm({ id: "", fullName: "", role: "driver" });
  };

  const addDriver = () => {
    if (!driverForm.fullName.trim() || !driverForm.vehicleModel.trim()) return;
    const next = [{ ...driverForm, id: crypto.randomUUID() }, ...drivers];
    setDrivers(next);
    save("acneto-registered-drivers", next);
    setDriverForm({
      id: "",
      fullName: "",
      phone: "",
      vehicleModel: "",
      plate: "",
      capacity: "",
      city: "",
      state: "SP",
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
          Administração
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#0b1d3a]">
          Páginas de cadastros
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Gerencie usuários, perfis de acesso e motoristas cadastrados.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <TabButton
          active={tab === "users"}
          icon={Users}
          label="Usuários"
          onClick={() => setTab("users")}
        />
        <TabButton
          active={tab === "profiles"}
          icon={Shield}
          label="Perfis de acesso"
          onClick={() => setTab("profiles")}
        />
        <TabButton
          active={tab === "drivers"}
          icon={Truck}
          label="Motoristas"
          onClick={() => setTab("drivers")}
        />
      </div>

      {tab === "users" && (
        <RegistrationPanel
          title="Cadastrar usuário"
          icon={Users}
          onSubmit={addUser}
          submitLabel="Salvar usuário"
        >
          <Field
            placeholder="Nome completo"
            value={userForm.fullName}
            onChange={(value) => setUserForm({ ...userForm, fullName: value })}
          />
          <Field
            placeholder="E-mail de acesso"
            type="email"
            value={userForm.email}
            onChange={(value) => setUserForm({ ...userForm, email: value })}
          />
          <Field
            placeholder="Senha inicial"
            type="password"
            value={userForm.password}
            onChange={(value) => setUserForm({ ...userForm, password: value })}
          />
          <List
            items={users.map((user) => `${user.fullName} · ${user.email}`)}
          />
        </RegistrationPanel>
      )}

      {tab === "profiles" && (
        <RegistrationPanel
          title="Cadastrar perfil de acesso"
          icon={Shield}
          onSubmit={addProfile}
          submitLabel="Salvar perfil"
        >
          <Field
            placeholder="Nome do usuário"
            value={profileForm.fullName}
            onChange={(value) =>
              setProfileForm({ ...profileForm, fullName: value })
            }
          />
          <select
            className={inputClass}
            value={profileForm.role}
            onChange={(event) =>
              setProfileForm({
                ...profileForm,
                role: event.target.value as DemoProfile["role"],
              })
            }
          >
            <option value="driver">Motorista</option>
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
          </select>
          <List
            items={profiles.map(
              (profile) => `${profile.fullName} · ${profile.role}`,
            )}
          />
        </RegistrationPanel>
      )}

      {tab === "drivers" && (
        <RegistrationPanel
          title="Cadastrar motorista"
          icon={Truck}
          onSubmit={addDriver}
          submitLabel="Salvar motorista"
        >
          <Field
            placeholder="Nome completo"
            value={driverForm.fullName}
            onChange={(value) =>
              setDriverForm({ ...driverForm, fullName: value })
            }
          />
          <Field
            placeholder="Telefone"
            value={driverForm.phone}
            onChange={(value) => setDriverForm({ ...driverForm, phone: value })}
          />
          <Field
            placeholder="Modelo do veículo"
            value={driverForm.vehicleModel}
            onChange={(value) =>
              setDriverForm({ ...driverForm, vehicleModel: value })
            }
          />
          <Field
            placeholder="Placa"
            value={driverForm.plate}
            onChange={(value) => setDriverForm({ ...driverForm, plate: value })}
          />
          <Field
            placeholder="Capacidade"
            value={driverForm.capacity}
            onChange={(value) =>
              setDriverForm({ ...driverForm, capacity: value })
            }
          />
          <Field
            placeholder="Cidade"
            value={driverForm.city}
            onChange={(value) => setDriverForm({ ...driverForm, city: value })}
          />
          <Field
            placeholder="UF"
            value={driverForm.state}
            onChange={(value) =>
              setDriverForm({ ...driverForm, state: value.toUpperCase() })
            }
          />
          <List
            items={drivers.map(
              (driver) =>
                `${driver.fullName} · ${driver.vehicleModel} · ${driver.plate || "sem placa"}`,
            )}
          />
        </RegistrationPanel>
      )}
    </div>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

function RegistrationPanel({
  title,
  icon: Icon,
  onSubmit,
  submitLabel,
  children,
}: {
  title: string;
  icon: typeof Users;
  onSubmit: () => void;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Icon size={18} className="text-[#1052c7]" />
          <h3 className="text-lg font-bold text-[#0b1d3a]">{title}</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{children}</div>
        <button
          onClick={onSubmit}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0e4db7] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0a3a90]"
        >
          {submitLabel}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Field({
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      className={inputClass}
      placeholder={placeholder}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function List({ items }: { items: string[] }) {
  return (
    <div className="sm:col-span-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        Registros cadastrados
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
