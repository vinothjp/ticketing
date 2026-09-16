import React, { createContext, useContext, useState, useCallback } from 'react';
import api from '../lib/api';

interface User {
  id: string;
  username: string;
  email: string;
  roles: string[];
  clientId: string | null;
}

interface OtpChallenge {
  requiresOtp: true;
  challengeId: string;
  otpSentTo: string;
}

type LoginResult = { user: User } | OtpChallenge;

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyOtp: (challengeId: string, otp: string) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const storeSession = useCallback((data: { accessToken: string; refreshToken: string; user: User }) => {
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const res = await api.post('/api/auth/login', { username, password });

    // SuperAdmin 2FA: backend returns a challenge instead of tokens
    if (res.data.requiresOtp) {
      return {
        requiresOtp: true,
        challengeId: res.data.challengeId,
        otpSentTo: res.data.otpSentTo,
      };
    }

    storeSession(res.data);
    return { user: res.data.user as User };
  }, [storeSession]);

  const verifyOtp = useCallback(async (challengeId: string, otp: string): Promise<User> => {
    const res = await api.post('/api/auth/verify-otp', { challengeId, otp });
    storeSession(res.data);
    return res.data.user as User;
  }, [storeSession]);

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, verifyOtp, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
