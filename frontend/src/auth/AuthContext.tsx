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
    role: "HOMEOWNER" | "TRADESPERSON"
  ) => Promise<User>;
  logout: () => void;
  clearError: () => void;
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
      .then((res) => {
        saveSession(token, res.user);
        setUser(res.user);
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const res = await apiLogin(email, password);
    saveSession(res.token, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      role: "HOMEOWNER" | "TRADESPERSON"
    ) => {
      setError(null);
      const res = await apiRegister(email, password, role);
      saveSession(res.token, res.user);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login,
      register,
      logout,
      clearError: () => setError(null),
    }),
    [user, loading, error, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}
