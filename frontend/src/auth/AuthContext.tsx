import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  getStoredUser,
  getToken,
  login as apiLogin,
  me,
  register as apiRegister,
  saveSession,
  updateMe as apiUpdateMe,
  type Role,
  type User,
} from "../api/client";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (
    email: string,
    password: string,
    role: "HOMEOWNER" | "TRADESPERSON",
    extras?: { name?: string; phone?: string }
  ) => Promise<User>;
  updateProfile: (body: {
    name?: string;
    phone?: string;
    notificationPrefs?: Record<string, boolean>;
    inviteTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    counterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    homeownerCounterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    introTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    namedJobTemplates?: {
      id: string;
      name: string;
      title: string;
      description?: string;
      category?: string;
      siteType?: string;
      cadence?: string;
      cadenceNote?: string;
      budgetMin?: string;
      budgetMax?: string;
      address?: string;
      city?: string;
      area?: string;
      pincode?: string;
      lat?: string;
      lng?: string;
      sourceJobId?: string;
      createdAt?: string;
    }[];
    quoteViewNudgeHours?: number | null;
  }) => Promise<User>;
  logout: () => void;
  setError: (e: string | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    me()
      .then((r) => {
        setUser(r.user);
        saveSession(token, r.user);
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const r = await apiLogin(email, password);
    saveSession(r.token, r.user);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      role: "HOMEOWNER" | "TRADESPERSON",
      extras?: { name?: string; phone?: string }
    ) => {
      setError(null);
      const r = await apiRegister(email, password, role, extras);
      saveSession(r.token, r.user);
      setUser(r.user);
      return r.user;
    },
    []
  );

  const updateProfile = useCallback(async (body: {
    name?: string;
    phone?: string;
    notificationPrefs?: Record<string, boolean>;
    inviteTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    counterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    homeownerCounterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    introTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
    namedJobTemplates?: {
      id: string;
      name: string;
      title: string;
      description?: string;
      category?: string;
      siteType?: string;
      cadence?: string;
      cadenceNote?: string;
      budgetMin?: string;
      budgetMax?: string;
      address?: string;
      city?: string;
      area?: string;
      pincode?: string;
      lat?: string;
      lng?: string;
      sourceJobId?: string;
      createdAt?: string;
    }[];
    quoteViewNudgeHours?: number | null;
  }) => {
    const r = await apiUpdateMe(body);
    const token = getToken();
    if (token) saveSession(token, r.user);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, register, updateProfile, logout, setError }),
    [user, loading, error, login, register, updateProfile, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export type { Role, User };
