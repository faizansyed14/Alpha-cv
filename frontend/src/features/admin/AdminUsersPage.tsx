'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api, AdminUser, CreateUserRequest, UpdateUserRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { ROLE_LABELS, STAFF_ROLES, roleLabel } from '@/lib/roles';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { AlertCircle, X, Trash2, Pencil, Users as UsersIcon, Plus, Megaphone, Eye, EyeOff } from '@/components/icons';
function roleBadgeVariant(role?: string) {
  switch (role) {
    case 'admin':
      return 'danger' as const;
    case 'manager':
      return 'info' as const;
    case 'evp':
      return 'warning' as const;
    default:
      return 'secondary' as const;
  }
}

function initials(username: string) {
  return username.trim().slice(0, 2).toUpperCase() || '?';
}

function lastSeenLabel(epoch: number | null | undefined): string {
  if (!epoch) return 'No recent activity';
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
  if (secs < 60) return 'Last seen just now';
  if (secs < 3600) return `Last seen ${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `Last seen ${Math.floor(secs / 3600)}h ago`;
  return `Last seen ${Math.floor(secs / 86400)}d ago`;
}

type PresenceMap = Record<string, { online: boolean; last_seen: number | null }>;

/** Turn any API error (string, FastAPI 422 array, ApiError, axios error) into a readable line. */
function errText(err: any, fallback: string): string {
  const d = err?.detail ?? err?.response?.data?.detail;
  if (Array.isArray(d)) {
    return d.map((x: any) => `${(x.loc || []).slice(1).join('.') || 'field'}: ${x.msg}`).join('; ') || fallback;
  }
  if (typeof d === 'string' && d) return d;
  if (typeof err?.message === 'string' && err.message) return err.message;
  return fallback;
}

export default function AdminUsersPage() {
  const { user, token } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMap>({});

  // Create user modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserRequest>({
    username: '',
    password: '',
    email: '',
    role: 'user',
    otp_mode: 'real',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit user modal state
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserRequest>({});
  const [editLoading, setEditLoading] = useState(false);


  // Notice popup management state
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeActive, setNoticeActive] = useState(false);
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [noticeStatus, setNoticeStatus] = useState<string | null>(null);

  const fetchUsers = async () => {
    if (!token) return;

    try {
      setLoading(true);
      const usersList = await api.listUsers(token);
      setUsers(usersList);
      setError(null);
    } catch (err: any) {
      if (err.message.includes('403') || err.message.includes('Admin only')) {
        setError('Access denied. Admin privileges required.');
      } else {
        setError(err.message || 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [token]);

  // Live presence: who is currently online. Poll every 20s.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api.getUsersPresence(token);
        if (alive) setPresence(res.users || {});
      } catch { /* ignore transient errors */ }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.getAdminNotice()
      .then((res) => {
        const n = res?.notice;
        if (n) {
          setNoticeMessage(n.message || '');
          setNoticeActive(!!n.active);
        }
      })
      .catch(() => { /* ignore */ });
  }, [token]);

  const handleSaveNotice = async (active: boolean) => {
    if (active && !noticeMessage.trim()) {
      setNoticeStatus('Enter a message before displaying the notice.');
      return;
    }
    setNoticeSaving(true);
    setNoticeStatus(null);
    try {
      const res = await api.setNotice(noticeMessage.trim(), active);
      setNoticeActive(!!res?.notice?.active);
      setNoticeStatus(active ? 'Notice is now showing to all users.' : 'Notice saved (hidden).');
    } catch (err: any) {
      setNoticeStatus(err?.message || 'Failed to save notice');
    } finally {
      setNoticeSaving(false);
    }
  };

  const handleRemoveNotice = async () => {
    setNoticeSaving(true);
    setNoticeStatus(null);
    try {
      await api.clearNotice();
      setNoticeActive(false);
      setNoticeMessage('');
      setNoticeStatus('Notice removed for all users.');
    } catch (err: any) {
      setNoticeStatus(err?.message || 'Failed to remove notice');
    } finally {
      setNoticeSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    // The email is what the person signs in with: required, and it must look like one.
    if (!createForm.email?.trim()) {
      setCreateError('Email is required: it is what the person signs in with');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email.trim())) {
      setCreateError('Please enter a valid email address');
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError(null);
      // Never send an empty-string email, the API's EmailStr rejects "" (422).
      const payload: CreateUserRequest = {
        ...createForm,
        email: createForm.email.trim(),
      };
      await api.createUser(token, payload);
      setShowCreateModal(false);
      setCreateForm({ username: '', password: '', email: '', role: 'user', otp_mode: 'real' });
      setCreateError(null);
      await fetchUsers();
    } catch (err: any) {
      setCreateError(errText(err, 'Failed to create user'));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editUser) return;

    try {
      setEditLoading(true);
      // Drop empty-string fields so the API's EmailStr / validators don't 422;
      // an omitted field means "leave unchanged".
      const payload: UpdateUserRequest = { ...editForm };
      if (typeof payload.email === 'string' && !payload.email.trim()) delete payload.email;
      else if (typeof payload.email === 'string') payload.email = payload.email.trim();
      if (typeof payload.password === 'string' && !payload.password.trim()) delete payload.password;
      await api.updateUser(token, editUser.id, payload);
      setEditUser(null);
      setEditForm({});
      await fetchUsers();
    } catch (err: any) {
      setError(errText(err, 'Failed to update user'));
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!token) return;
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      await api.deleteUser(token, userId);
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  return (
      <div>
        <div className="animate-page-enter">
          <PageHeader
            title="Users"
            description="Manage accounts, roles, and access for your workspace"
            actions={
              <>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
                  Add user
                </Button>
              </>
            }
          />

          {/* Signed-in user hint */}
          <div className="mb-4 flex items-center gap-2 text-[13px] text-gray-500">
            <span>Signed in as</span>
            <span className="font-medium text-gray-900">{user?.username}</span>
            <Badge variant={roleBadgeVariant(user?.role)}>{roleLabel(user?.role)}</Badge>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-start gap-2 text-[13px] text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => setError(null)}
                className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Users Table */}
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="section-label">All users</p>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Online
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Offline
              </span>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-surface-border bg-white py-12 shadow-card">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />
            </div>
          ) : users.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No users yet"
              hint="Add your first user to get started."
              action={
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
                  Add user
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                          {initials(u.username)}
                        </span>
                        <span className="font-medium text-gray-900">{u.username}</span>
                      </div>
                    </TD>
                    <TD>
                      {u.email || <span className="italic text-amber-600" title="This person cannot sign in until an email is set">No email: cannot sign in</span>}
                    </TD>
                    <TD>
                      <Badge variant={roleBadgeVariant(u.role)}>{roleLabel(u.role)}</Badge>
                    </TD>
                    <TD>
                      {(() => {
                        const p = presence[u.username];
                        const online = !!p?.online;
                        return (
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                                online ? 'bg-blue-500 ring-2 ring-blue-200' : 'bg-red-500'
                              }`}
                              title={online ? 'Online now' : lastSeenLabel(p?.last_seen)}
                              aria-label={online ? 'Online' : 'Offline'}
                            />
                            <span className={`text-xs font-medium ${online ? 'text-blue-600' : 'text-gray-400'}`}>
                              {online ? 'Online' : 'Offline'}
                            </span>
                            <Badge variant={u.is_active ? 'success' : 'secondary'}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        );
                      })()}
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          disabled={u.role === 'admin'}
                          title={u.role === 'admin' ? "The admin's email and password are set in the server's .env file" : undefined}
                          aria-label="Edit user"
                          onClick={() => {
                            setEditUser(u);
                            setEditForm({});
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {u.role !== 'admin' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                            aria-label="Delete user"
                            onClick={() => handleDeleteUser(u.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {/* Notice popup management */}
          <p className="section-label mb-2 mt-8">Notice popup</p>
          <div className="rounded-xl border border-surface-border bg-white p-5 shadow-card">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                <Megaphone className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-gray-900">Login notice for all users</p>
                <p className="mt-0.5 text-[13px] text-gray-500">
                  This message pops up for every non-admin user when they log in. They can dismiss it
                  with the X; you can show or remove it at any time. Admins don&apos;t see the popup.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[13px] text-gray-600">Status:</span>
                  <Badge variant={noticeActive ? 'success' : 'secondary'}>
                    {noticeActive ? 'Showing to users' : 'Hidden'}
                  </Badge>
                </div>
                <textarea
                  value={noticeMessage}
                  onChange={(e) => { setNoticeMessage(e.target.value); setNoticeStatus(null); }}
                  placeholder="e.g. System maintenance tonight from 10pm–11pm. Please save your work."
                  rows={4}
                  maxLength={4000}
                  className="mt-3 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                {noticeStatus && (
                  <p className="mt-2 text-[12px] text-brand-600">{noticeStatus}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    icon={<Eye className="h-4 w-4" />}
                    loading={noticeSaving}
                    onClick={() => handleSaveNotice(true)}
                  >
                    {noticeActive ? 'Update & show' : 'Show to all users'}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<EyeOff className="h-4 w-4" />}
                    disabled={noticeSaving || !noticeActive}
                    onClick={() => handleSaveNotice(false)}
                  >
                    Hide
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Trash2 className="h-4 w-4" />}
                    disabled={noticeSaving}
                    onClick={handleRemoveNotice}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Create User Modal */}
        {showCreateModal && (
          <Dialog open={showCreateModal} onOpenChange={(open) => {
            setShowCreateModal(open);
            if (!open) {
              setCreateForm({ username: '', password: '', email: '', role: 'user' });
              setCreateError(null);
            }
          }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create new user</DialogTitle>
                <p className="text-[13px] text-gray-500">Add a new user to the system</p>
              </DialogHeader>

              {createError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Username <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs text-gray-500">(the name shown in the app)</span>
                  </label>
                  <Input
                    value={createForm.username}
                    onChange={(e) => {
                      setCreateForm({...createForm, username: e.target.value});
                      setCreateError(null);
                    }}
                    placeholder="Enter username"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => {
                      setCreateForm({...createForm, password: e.target.value});
                      setCreateError(null);
                    }}
                    placeholder="Enter password"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Email <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs text-gray-500">(they sign in with this)</span>
                  </label>
                  <Input
                    type="email"
                    value={createForm.email || ''}
                    onChange={(e) => {
                      setCreateForm({...createForm, email: e.target.value});
                      setCreateError(null);
                    }}
                    placeholder="user@example.com"
                    required
                  />
                  {createForm.otp_mode === 'captcha' && (
                    <p className="text-xs text-amber-700">
                      CAPTCHA mode shows an image challenge after the password, no code is emailed.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createForm.role}
                    onChange={(e) => {
                      const newRole = e.target.value as CreateUserRequest['role'];
                      setCreateForm({...createForm, role: newRole});
                      setCreateError(null);
                    }}
                    className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  >
                    {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Authentication <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createForm.otp_mode || 'real'}
                    onChange={(e) => {
                      const mode = e.target.value as NonNullable<CreateUserRequest['otp_mode']>;
                      setCreateForm({ ...createForm, otp_mode: mode });
                      setCreateError(null);
                    }}
                    className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  >
                    <option value="real">Email OTP</option>
                    <option value="captcha">CAPTCHA (image, no email)</option>
                  </select>
                  {createForm.role === 'admin' && (
                    <p className="text-xs text-slate-500">Admins always sign in with the CAPTCHA, whatever is chosen here.</p>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="submit" variant="primary" loading={createLoading} className="flex-1">
                    Create user
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateForm({ username: '', password: '', email: '', role: 'user', otp_mode: 'real' });
                      setCreateError(null);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* Edit User Modal */}
        {editUser && (
          <Dialog open={!!editUser} onOpenChange={() => {
            setEditUser(null);
            setEditForm({});
          }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit user: {editUser.username}</DialogTitle>
                <p className="text-[13px] text-gray-500">Update user information</p>
              </DialogHeader>
              <form onSubmit={handleEditUser} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Email <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs text-gray-500">(they sign in with this)</span>
                  </label>
                  <Input
                    type="email"
                    value={editForm.email !== undefined ? editForm.email : (editUser.email || '')}
                    onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                    placeholder="user@example.com"
                    required
                  />
                  {(editForm.otp_mode || editUser.otp_mode) === 'captcha' && (
                    <p className="text-xs text-amber-700">
                      CAPTCHA mode shows an image challenge after the password, no code is emailed.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    New Password <span className="text-xs text-gray-500">(optional)</span>
                  </label>
                  <Input
                    type="password"
                    value={editForm.password || ''}
                    onChange={(e) => setEditForm({...editForm, password: e.target.value})}
                    placeholder="Leave blank to keep current password"
                  />
                </div>
                {editUser.role === 'admin' ? (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    The admin account always keeps the admin role, stays active and cannot be deleted. Its email and
                    password are set in the server&apos;s .env file and cannot be changed here.
                  </p>
                ) : (
                <>
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    Role
                  </label>
                  <select
                    value={editForm.role || editUser.role}
                    onChange={(e) => setEditForm({...editForm, role: e.target.value as UpdateUserRequest['role']})}
                    className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  >
                    {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                </>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">
                    OTP Mode
                  </label>
                  <select
                    value={editForm.otp_mode || editUser.otp_mode || 'real'}
                    onChange={(e) => setEditForm({ ...editForm, otp_mode: e.target.value as UpdateUserRequest['otp_mode'] })}
                    className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30"
                  >
                    <option value="real">Email OTP</option>
                    <option value="captcha">CAPTCHA (image, no email)</option>
                  </select>
                  {(editForm.role || editUser.role) === 'admin' && (
                    <p className="text-xs text-slate-500">Admins always sign in with the CAPTCHA, whatever is chosen here.</p>
                  )}
                </div>
                {editUser.role !== 'admin' && (
                <div className="space-y-1.5">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editForm.is_active !== undefined ? editForm.is_active : editUser.is_active}
                      onChange={(e) => setEditForm({...editForm, is_active: e.target.checked})}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                    />
                    <span className="text-[13px] font-medium text-gray-700">Active</span>
                  </label>
                </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button type="submit" variant="primary" loading={editLoading} className="flex-1">
                    Update user
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditUser(null);
                      setEditForm({});
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
  );
}
