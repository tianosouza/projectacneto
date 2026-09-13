import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Profile, UserRole } from "./types";
import { apiFetch } from "./api";

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
  phone?: string | null;
  app_metadata: { provider: string };
  user_metadata: { full_name?: string };
  aud: string;
  created_at: string;
  role: string;
};

const ACCESS_TOKEN_KEY = "acneto-access-token";

const createApiSession = (
  accessToken: string,
  apiUser: {
    id: string;
    email: string;
    full_name?: string | null;
    phone?: string | null;
  },
) => ({
  access_token: accessToken,
  refresh_token: "",
  expires_in: 43200,
  expires_at: Math.floor((Date.now() + 43200 * 1000) / 1000),
  token_type: "bearer",
  user: {
    id: apiUser.id,
    email: apiUser.email,
    phone: apiUser.phone,
    app_metadata: { provider: "api" },
    user_metadata: { full_name: apiUser.full_name ?? undefined },
    aud: "authenticated",
    created_at: new Date().toISOString(),
    role: "authenticated",
  } as User,
});

const apiProfile = (profile: {
  id: string;
  userId: string;
  role: string;
  fullName: string | null;
  createdAt: string;
}): Profile => ({
  id: profile.id,
  user_id: profile.userId,
  role: profile.role as UserRole,
  full_name: profile.fullName,
  created_at: profile.createdAt,
});

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
    phone: string,
    requestedRole: "driver" | "operator",
    registrationNotes: string,
  ) => Promise<{ error: string | null; pending?: boolean }>;
  requestPasswordReset: (
    email: string,
  ) => Promise<{ error: string | null; resetToken?: string }>;
  resetPassword: (
    token: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!accessToken) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    apiFetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sessão expirada");
        return response.json() as Promise<{
          user: {
            id: string;
            email: string;
            full_name?: string | null;
            phone?: string | null;
          };
          profile: Parameters<typeof apiProfile>[0];
        }>;
      })
      .then(({ user: apiUser, profile: apiUserProfile }) => {
        setSession(createApiSession(accessToken, apiUser));
        setProfile(apiProfile(apiUserProfile));
      })
      .catch(() => {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        setSession(null);
        setProfile(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as {
        error?: string;
        access_token?: string;
        user?: {
          id: string;
          email: string;
          full_name?: string | null;
          phone?: string | null;
        };
        profile?: Parameters<typeof apiProfile>[0];
      };
      if (!response.ok || !body.access_token || !body.user || !body.profile) {
        return { error: body.error ?? "Não foi possível entrar" };
      }
      localStorage.setItem(ACCESS_TOKEN_KEY, body.access_token);
      setSession(createApiSession(body.access_token, body.user));
      setProfile(apiProfile(body.profile));
      return { error: null };
    } catch {
      return { error: "Servidor indisponível. Tente novamente." };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    phone: string,
    requestedRole: "driver" | "operator",
    registrationNotes: string,
  ) => {
    try {
      const response = await apiFetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          fullName,
          phone,
          requestedRole,
          registrationNotes,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        access_token?: string;
        user?: { id: string; email: string; full_name?: string | null };
        profile?: Parameters<typeof apiProfile>[0];
        pending?: boolean;
        message?: string;
      };
      if (response.status === 202 && body.pending) {
        return {
          error: null,
          pending: true,
          message:
            body.message ??
            "Cadastro recebido. Aguarde a aprovação do administrador.",
        };
      }
      if (!response.ok || !body.access_token || !body.user || !body.profile) {
        return { error: body.error ?? "Não foi possível criar a conta" };
      }
      localStorage.setItem(ACCESS_TOKEN_KEY, body.access_token);
      setSession(createApiSession(body.access_token, body.user));
      setProfile(apiProfile(body.profile));
      return { error: null };
    } catch {
      return { error: "Servidor indisponível. Tente novamente." };
    }
  };

  const requestPasswordReset = async (email: string) => {
    try {
      const response = await apiFetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json()) as {
        message?: string;
        reset_token?: string;
      };
      if (!response.ok)
        return {
          error: body.message ?? "Não foi possível solicitar a recuperação",
        };
      return { error: null, resetToken: body.reset_token };
    } catch {
      return { error: "Servidor indisponível. Tente novamente." };
    }
  };

  const resetPassword = async (token: string, password: string) => {
    try {
      const response = await apiFetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json()) as { error?: string };
      return response.ok
        ? { error: null }
        : { error: body.error ?? "Não foi possível redefinir a senha" };
    } catch {
      return { error: "Servidor indisponível. Tente novamente." };
    }
  };

  const signOut = async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
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
        requestPasswordReset,
        resetPassword,
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
