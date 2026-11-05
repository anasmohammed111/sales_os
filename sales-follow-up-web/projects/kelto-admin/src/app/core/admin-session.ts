import { computed, Injectable, signal } from '@angular/core';

/** The signed-in Kelto administrator, as the API describes them. */
export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  permissions: string[];
  mustChangePassword: boolean;
}

const TOKEN_KEY = 'kelto_admin_token';
const PROFILE_KEY = 'kelto_admin_profile';

/** Decodes a JWT payload (base64url) without verifying it; null when unreadable. */
export function tokenPayload(token: string | null): { exp?: number } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

/**
 * Who is signed in to the admin app and what their role allows. The server
 * enforces every permission; this only decides what to show.
 */
@Injectable({ providedIn: 'root' })
export class AdminSession {
  readonly profile = signal<AdminProfile | null>(this.read());
  readonly permissions = computed(() => new Set(this.profile()?.permissions ?? []));

  token(): string | null {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
  }

  isSignedIn(): boolean {
    const payload = tokenPayload(this.token());
    return !!payload && (!payload.exp || Date.now() < payload.exp * 1000);
  }

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  /** Stores a new sign-in (after login or a password change). */
  set(token: string, profile: AdminProfile): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.setProfile(profile);
  }

  setProfile(profile: AdminProfile): void {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    this.profile.set(profile);
  }

  clear(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
    }
    this.profile.set(null);
  }

  private read(): AdminProfile | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored = localStorage.getItem(PROFILE_KEY);
      return stored ? (JSON.parse(stored) as AdminProfile) : null;
    } catch {
      return null;
    }
  }
}
