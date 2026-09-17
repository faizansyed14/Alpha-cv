/**
 * Email CV processing.
 *
 * The email endpoints are not part of the `api` client in src/lib/api.ts —
 * the existing EmailPage calls them with bare `fetch` against the Next.js
 * proxy routes. This service mirrors those exact endpoints so pages get a
 * clean import path without changing behavior.
 */

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const emailService = {
  /** GET /api/email/status */
  async getStatus(): Promise<any> {
    const response = await fetch(`/api/email/status`, { headers: authHeaders() });
    if (!response.ok) throw new Error(`Failed to load email status (${response.status})`);
    return response.json();
  },

  /** GET /api/email/health */
  async getHealth(): Promise<any> {
    const response = await fetch(`/api/email/health`, { headers: authHeaders() });
    if (!response.ok) throw new Error(`Failed to load email health (${response.status})`);
    return response.json();
  },

  /** POST /api/email/process-emails */
  async processEmails(options?: { maxEmails?: number; forceReprocess?: boolean }): Promise<any> {
    const response = await fetch(`/api/email/process-emails`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_emails: options?.maxEmails ?? 50,
        force_reprocess: options?.forceReprocess ?? false,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.detail || `Failed to process emails (${response.status})`);
    }
    return data;
  },
};

export default emailService;
