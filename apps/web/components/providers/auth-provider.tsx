'use client';

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useRef,
} from 'react';
import type { ReactNode } from 'react';

import { apiRequest, getApiBaseUrl } from '@/lib/api';
import type { AuthResponse, AuthUser } from '@/lib/api';

interface AuthContextValue {
  accessToken: string | null;
  beginGitHubLogin: () => void;
  beginGoogleLogin: () => void;
  isLoading: boolean;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthUser>;
  staffLogin: (email: string, password: string) => Promise<AuthUser>;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const refreshInFlight = useRef<Promise<AuthUser> | null>(null);
  const sessionEpoch = useRef(0);

  async function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
    return navigator.locks
      ? navigator.locks.request('nextfi-auth-session', operation)
      : operation();
  }

  function refreshSession(): Promise<AuthUser> {
    if (refreshInFlight.current) return refreshInFlight.current;
    const epoch = sessionEpoch.current;
    const pending = withSessionLock(async () => {
      if (epoch !== sessionEpoch.current) throw new Error('Session changed');
      const session = await apiRequest<AuthResponse>('/auth/refresh', {
        method: 'POST',
      });
      if (epoch !== sessionEpoch.current) throw new Error('Session changed');
      setAccessToken(session.accessToken);
      setUser(session.user);
      return session.user;
    })
      .catch((error) => {
        if (epoch === sessionEpoch.current) {
          setAccessToken(null);
          setUser(null);
        }
        throw error;
      })
      .finally(() => {
        if (refreshInFlight.current === pending) refreshInFlight.current = null;
      });
    refreshInFlight.current = pending;
    return pending;
  }

  const initializeSession = useEffectEvent(async () => {
    try {
      const session = await refreshSession();
      if (
        session.onboardingCompleted &&
        !window.sessionStorage.getItem('nextfi-returning-user')
      ) {
        window.sessionStorage.setItem('nextfi-returning-user', '1');
      }
    } catch {
      // A missing or expired refresh cookie simply means the user is signed out.
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    // The initial session check synchronizes React state with the HttpOnly cookie.
    void initializeSession();
  }, []);

  const renewSession = useEffectEvent(() => {
    void refreshSession().catch(() => {});
  });
  useEffect(() => {
    if (!accessToken) return;
    let expiresAt: number;
    try {
      expiresAt =
        JSON.parse(
          atob(
            (accessToken.split('.')[1] ?? '')
              .replace(/-/g, '+')
              .replace(/_/g, '/'),
          ),
        ).exp * 1000;
    } catch {
      return;
    }
    if (!Number.isFinite(expiresAt)) return;
    const timer = setTimeout(
      () => renewSession(),
      Math.max(1000, expiresAt - Date.now() - 60000),
    );
    const resume = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() >= expiresAt - 60000
      )
        renewSession();
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [accessToken]);

  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== accessToken) return;
      sessionEpoch.current++;
      setAccessToken(null);
      setUser(null);
    };
    window.addEventListener('nextfi:session-expired', expired);
    return () => window.removeEventListener('nextfi:session-expired', expired);
  }, [accessToken]);

  function beginGoogleLogin() {
    window.location.replace(`${getApiBaseUrl()}/auth/google`);
  }

  function beginGitHubLogin() {
    window.location.replace(`${getApiBaseUrl()}/auth/github`);
  }

  async function logout() {
    sessionEpoch.current++;
    await withSessionLock(() => apiRequest('/auth/logout', { method: 'POST' }));
    setAccessToken(null);
    setUser(null);
  }

  async function staffLogin(email: string, password: string) {
    const epoch = ++sessionEpoch.current;
    const session = await withSessionLock(() =>
      apiRequest<AuthResponse>('/auth/staff/login', {
        body: JSON.stringify({ email, password }),
        method: 'POST',
      }),
    );
    if (epoch !== sessionEpoch.current) throw new Error('Session changed');
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        beginGitHubLogin,
        beginGoogleLogin,
        isLoading,
        logout,
        refreshSession,
        staffLogin,
        user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
