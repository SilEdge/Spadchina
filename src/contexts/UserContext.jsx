import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api.js';

const UserContext = createContext(null);
const TOKEN_KEY = 'cultcode_token';

function readStoredToken() {
  const tabToken = sessionStorage.getItem(TOKEN_KEY);
  if (tabToken) return tabToken;

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    sessionStorage.setItem(TOKEN_KEY, legacyToken);
    localStorage.removeItem(TOKEN_KEY);
  }
  return legacyToken;
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(readStoredToken);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (token) {
      api.me()
        .then(setUser)
        .catch(() => {
          sessionStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email, password) => {
    setError(null);
    try {
      const data = await api.login(email, password);
      sessionStorage.setItem(TOKEN_KEY, data.token);
      localStorage.removeItem(TOKEN_KEY);
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const register = async (name, email, password) => {
    setError(null);
    try {
      const data = await api.register(name, email, password);
      sessionStorage.setItem(TOKEN_KEY, data.token);
      localStorage.removeItem(TOKEN_KEY);
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);
  };

  const isAdmin = () => user?.role === 'admin';

  return (
    <UserContext.Provider
      value={{ user, token, loading, error, login, register, logout, isAdmin }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
