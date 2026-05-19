import axios from "axios";

export const api = axios.create({ baseURL: "/api" });
export const AUTH_LOGOUT_EVENT = "sales-portal:auth-logout";

export function getStoredToken() {
  return sessionStorage.getItem("token");
}

export function getStoredUser() {
  const raw = sessionStorage.getItem("user");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    clearStoredSession();
    return null;
  }
}

export function storeSession(token: string, user: unknown) {
  sessionStorage.setItem("token", token);
  sessionStorage.setItem("user", JSON.stringify(user));
  clearLegacySession();
}

export function clearStoredSession() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  clearLegacySession();
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
}

function clearLegacySession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

clearLegacySession();

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      clearStoredSession();
    }
    return Promise.reject(error);
  }
);
