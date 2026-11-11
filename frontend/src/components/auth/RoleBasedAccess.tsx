'use client';
import type { Role } from '@/lib/roles';

import { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';

interface RoleBasedAccessProps {
  children: ReactNode;
  allowedRoles: Role[];
  fallback?: ReactNode;
  hideWhenUnauthorized?: boolean;
}

export default function RoleBasedAccess({ 
  children, 
  allowedRoles, 
  fallback = null,
  hideWhenUnauthorized = true 
}: RoleBasedAccessProps) {
  const { user } = useAuthStore();

  if (!user) {
    return hideWhenUnauthorized ? null : fallback;
  }

  const hasAccess = allowedRoles.includes(user.role as any);

  if (hasAccess) {
    return <>{children}</>;
  }

  return hideWhenUnauthorized ? null : fallback;
}

export function AdminOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <RoleBasedAccess allowedRoles={['admin']} fallback={fallback}>
      {children}
    </RoleBasedAccess>
  );
}
