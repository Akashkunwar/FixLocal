import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  listTemplates,
  login as apiLogin,
  logout as apiLogout,
  me,
  onUnauthenticated,
  refreshSession,
  register as apiRegister,
  saveTemplates,
  setAccessToken,
  updateMe as apiUpdateMe,
  type NamedJobTemplate,
  type Role,
  type TemplateBundle,
  type TemplateKind,
  type TextTemplate,
  type User,
} from "../api/client";

type ProfileUpdate = {
  name?: string | null;
  phone?: string | null;
  timezone?: string;
  notificationPrefs?: Record<string, boolean>;
  quoteViewNudgeHours?: number | null;
  inviteTemplates?: TextTemplate[];
  counterTemplates?: TextTemplate[];
  homeownerCounterTemplates?: TextTemplate[];
  introTemplates?: TextTemplate[];
  namedJobTemplates?: NamedJobTemplate[];
};

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
  updateProfile: (body: ProfileUpdate) => Promise<User>;
  refreshUser: () => Promise<void>;
  setSessionUser: (user: User, token?: string) => void;
  /** Forget the session locally (after the server already ended it). */
  clearSession: () => void;
  logout: () => Promise<void>;
  setError: (e: string | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

function withTemplates(user: User, t: TemplateBundle | null): User {
  if (!t) return user;
  return {
    ...user,
    inviteTemplates: t.invite,
    counterTemplates: t.counter,
    homeownerCounterTemplates: t.homeownerCounter,
    introTemplates: t.intro,
    namedJobTemplates: t.namedJob,
  };
}

/** Drafts, checklists and saved filters are per person; don't hand them to the next user of this browser. */
export function clearLocalUserData(storage: Storage | undefined = globalThis.localStorage) {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith("fixlocal")) keys.push(key);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

async function loadTemplates(): Promise<TemplateBundle | null> {
  try {
    return (await listTemplates()).templates;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const templatesRef = useRef<TemplateBundle | null>(null);

  const adopt = useCallback(async (u: User) => {
    templatesRef.current = await loadTemplates();
    const merged = withTemplates(u, templatesRef.current);
    setUser(merged);
    return merged;
  }, []);

  useEffect(() => {
    onUnauthenticated(() => {
      setAccessToken(null);
      templatesRef.current = null;
      setUser(null);
    });
    let cancelled = false;
    // A page load has no access token in memory; the refresh cookie restores the session.
    refreshSession()
      .then(async (session) => {
        if (cancelled || !session) return;
        await adopt(session.user);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      onUnauthenticated(null);
    };
  }, [adopt]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const r = await apiLogin(email, password);
      return adopt(r.user);
    },
    [adopt]
  );

  const register = useCallback(
    async (email: string, password: string, role: "HOMEOWNER" | "TRADESPERSON", extras?: { name?: string; phone?: string }) => {
      setError(null);
      const r = await apiRegister(email, password, role, extras);
      return adopt(r.user);
    },
    [adopt]
  );

  const refreshUser = useCallback(async () => {
    const r = await me();
    await adopt(r.user);
  }, [adopt]);

  const setSessionUser = useCallback(
    (u: User, token?: string) => {
      if (token) setAccessToken(token);
      setUser(withTemplates(u, templatesRef.current));
    },
    []
  );

  const updateProfile = useCallback(
    async (body: ProfileUpdate) => {
      const { inviteTemplates, counterTemplates, homeownerCounterTemplates, introTemplates, namedJobTemplates, ...rest } = body;
      const templateUpdates: [TemplateKind, unknown[] | undefined][] = [
        ["invite", inviteTemplates],
        ["counter", counterTemplates],
        ["homeownerCounter", homeownerCounterTemplates],
        ["intro", introTemplates],
        ["namedJob", namedJobTemplates],
      ];
      const bundle: TemplateBundle = templatesRef.current || {
        invite: [],
        counter: [],
        homeownerCounter: [],
        intro: [],
        namedJob: [],
      };
      for (const [kind, items] of templateUpdates) {
        if (items === undefined) continue;
        const saved = await saveTemplates(kind, items);
        (bundle as Record<TemplateKind, unknown[]>)[kind] = saved.items;
      }
      templatesRef.current = bundle;
      let base: User | null = user;
      if (Object.keys(rest).length) {
        base = (await apiUpdateMe(rest)).user;
      }
      if (!base) throw new Error("Not signed in");
      const merged = withTemplates(base, bundle);
      setUser(merged);
      return merged;
    },
    [user]
  );

  const clearSession = useCallback(() => {
    setAccessToken(null);
    templatesRef.current = null;
    clearLocalUserData();
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* the local session is cleared regardless */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, loading, error, login, register, updateProfile, refreshUser, setSessionUser, clearSession, logout, setError }),
    [user, loading, error, login, register, updateProfile, refreshUser, setSessionUser, clearSession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export type { Role, User };
