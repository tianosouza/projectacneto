import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Profile, UserRole } from "./types";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: User;
};

type User = {
  id: string;
  email: string;
  app_metadata: { provider: string };
  user_metadata: { full_name?: string };
  aud: string;
  created_at: string;
  role: string;
};

export type DemoRole = Extract<UserRole, "driver" | "operator" | "admin">;

export const DEMO_ACCOUNTS: Record<
  DemoRole,
  { email: string; password: string; fullName: string }
> = {
  driver: {
    email: "driver.demo@acneto.com",
    password: "demo123456",
    fullName: "Motorista Demo",
  },
  operator: {
    email: "operator.demo@acneto.com",
    password: "demo123456",
    fullName: "Operador Demo",
  },
  admin: {
    email: "admin.demo@acneto.com",
    password: "demo123456",
    fullName: "Administrador Demo",
  },
};

const DEMO_PASSWORD = "demo123456";

const isDemoAllowed = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("demo") === "1" ||
    import.meta.env.VITE_DEMO_MODE === "true" ||
    localStorage.getItem("acneto-demo-mode") === "1"
  );
};

const getDemoRole = (): DemoRole => {
  if (typeof window === "undefined") return "driver";

  const savedRole = localStorage.getItem("acneto-demo-role") as DemoRole | null;
  if (
    savedRole === "driver" ||
    savedRole === "operator" ||
    savedRole === "admin"
  ) {
    return savedRole;
  }

  return "driver";
};

const createDemoSession = (role: DemoRole) => {
  const account = DEMO_ACCOUNTS[role];
  const demoUser = {
    id: `${role}-demo-user-123`,
    email: account.email,
    app_metadata: { provider: "demo" },
    user_metadata: { full_name: account.fullName },
    aud: "authenticated",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    role: "authenticated",
  } as User;

  const demoSession = {
    access_token: `${role}-demo-access-token`,
    refresh_token: `${role}-demo-refresh-token`,
    expires_in: 3600,
    expires_at: Math.floor((Date.now() + 3600 * 1000) / 1000),
    token_type: "bearer",
    user: demoUser,
  } as Session;

  const demoProfile = {
    id: `${role}-demo-profile-1`,
    user_id: demoUser.id,
    role,
    full_name: account.fullName,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  } as Profile;

  return { session: demoSession, profile: demoProfile };
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isDemoAllowed()) {
      const demoRole = getDemoRole();
      const { session: demoSession, profile: demoProfile } =
        createDemoSession(demoRole);
      setSession(demoSession);
      setProfile(demoProfile);
      setLoading(false);
      return;
    }

    setSession(null);
    setProfile(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const demoRole = localStorage.getItem(
      "acneto-demo-role",
    ) as DemoRole | null;
    if (demoRole && session.user.id === `${demoRole}-demo-user-123`) {
      const account = DEMO_ACCOUNTS[demoRole];
      setProfile({
        id: `${demoRole}-demo-profile-1`,
        user_id: `${demoRole}-demo-user-123`,
        role: demoRole,
        full_name: account.fullName,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      });
      setLoading(false);
      return;
    }

    setProfile({
      id: `local-${session.user.id}`,
      user_id: session.user.id,
      role: "driver",
      full_name: session.user.user_metadata?.full_name ?? session.user.email,
      created_at: new Date().toISOString(),
    });
    setLoading(false);
  }, [session]);

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const role = (Object.keys(DEMO_ACCOUNTS) as DemoRole[]).find(
      (key) =>
        DEMO_ACCOUNTS[key].email === normalizedEmail &&
        DEMO_ACCOUNTS[key].password === password,
    );

    if (role) {
      const { session: demoSession, profile: demoProfile } =
        createDemoSession(role);
      setSession(demoSession);
      setProfile(demoProfile);
      localStorage.setItem("acneto-demo-mode", "1");
      localStorage.setItem("acneto-demo-role", role);
      setLoading(false);
      return { error: null };
    }

    return { error: "Modo demo ativo. Use uma das contas de demonstração." };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const role = (Object.keys(DEMO_ACCOUNTS) as DemoRole[]).find(
      (key) =>
        DEMO_ACCOUNTS[key].email === normalizedEmail &&
        DEMO_ACCOUNTS[key].password === password,
    );

    if (role) {
      const { session: demoSession, profile: demoProfile } =
        createDemoSession(role);
      setSession(demoSession);
      setProfile(demoProfile);
      localStorage.setItem("acneto-demo-mode", "1");
      localStorage.setItem("acneto-demo-role", role);
      setLoading(false);
      return { error: null };
    }

    return { error: "Modo demo ativo. Use uma das contas de demonstração." };
  };

  const signOut = async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("acneto-demo-mode");
      localStorage.removeItem("acneto-demo-role");
    }

    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { DEMO_PASSWORD };
