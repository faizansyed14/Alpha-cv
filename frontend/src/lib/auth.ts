
/**
 * Authentication utilities for token management and API helpers
 */

const TOKEN_KEY = 'auth_token';
const COOKIE_NAME = 'auth_token';

/**
 * Get JWT token from localStorage
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Set JWT token in localStorage and cookie
 */
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    // Set secure cookie that expires in 1 day
    const expires = new Date();
    expires.setDate(expires.getDate() + 1);
    const isHttps = window.location.protocol === 'https:';
    const secureFlags = isHttps ? '; Secure; SameSite=Lax' : '; SameSite=Lax';
    document.cookie = `${COOKIE_NAME}=${token}; expires=${expires.toUTCString()}; path=/${secureFlags}`;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    // Clear cookie with same security flags
    const isHttps = window.location.protocol === 'https:';
    const secureFlags = isHttps ? '; Secure; SameSite=Lax' : '; SameSite=Lax';
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/${secureFlags}`;
  }
}

/**
 * Clear JWT token from both localStorage and cookie
 */
export function clearToken(): void {
  setToken(null);
}
