import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** Built-in role type; what someone may do comes from UserAccess */
  role: 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON';
  businessId: string;
}

export type DataScope = 'own' | 'team' | 'all';

/** What the signed-in person may do: their role, permissions and data scopes */
export interface UserAccess {
  roleId: string | null;
  roleKey: string | null;
  roleName: string;
  isOwner: boolean;
  permissions: string[];
  scopes: Partial<Record<'leads' | 'followups' | 'quotations' | 'admissions', DataScope>>;
  /** True during a read-only Kelto support session (nothing can be changed) */
  readOnly?: boolean;
}

export type SupportMode = 'VIEW_OWNER' | 'VIEW_USER' | 'SUPPORT_EDIT';

/** A Kelto support session in this workspace (who is really here, and until when) */
export interface SupportSessionInfo {
  sessionId: string;
  mode: SupportMode;
  adminName: string;
  businessName: string;
  targetUserName: string | null;
  expiresAt: string;
}

const SUPPORT_KEY = 'kelto_support_session';
/** The normal session that was open before a support session started */
const SAVED_KEY = 'kelto_saved_session';
const AUTH_KEYS = ['auth_token', 'auth_user', 'auth_access'] as const;

function readJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : null;
  } catch {
    return null;
  }
}

export interface AuthBusiness {
  id?: string;
  _id?: string;
  businessName: string;
  email?: string;
  phone?: string;
}

export interface AuthData {
  token: string;
  user: AuthUser;
  business: AuthBusiness;
  access?: UserAccess | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface RegisterPayload {
  businessName: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface GoogleAuthPayload {
  credential: string;
  businessName?: string;
  phone?: string;
}

/** A verified Google account that has no CRM account yet. */
export interface PendingGoogleSignup {
  credential: string;
  email: string;
  name: string;
}

/** Error code the API returns when a Google user still needs to register a business. */
export const GOOGLE_SIGNUP_REQUIRED = 'GOOGLE_SIGNUP_REQUIRED';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  /** The signed-in user; updates when the profile changes. */
  readonly currentUser = signal<AuthUser | null>(this.getUser());

  /** The signed-in person's role and permissions; refreshed from the API (see refreshAccess) */
  readonly access = signal<UserAccess | null>(this.getStoredAccess());

  /** Set when Google sign-in finds no account, so the register page can finish signup. */
  readonly pendingGoogleSignup = signal<PendingGoogleSignup | null>(null);

  /** Set while a Kelto support session is open in this tab */
  readonly supportSession = signal<SupportSessionInfo | null>(readJson<SupportSessionInfo>(SUPPORT_KEY));

  register(payload: RegisterPayload): Observable<AuthData> {
    return this.http
      .post<ApiResponse<AuthData>>(`${this.apiUrl}/register`, payload)
      .pipe(map((res) => res.data));
  }

  login(payload: LoginPayload): Observable<AuthData> {
    return this.http
      .post<ApiResponse<AuthData>>(`${this.apiUrl}/login`, payload)
      .pipe(
        map((res) => res.data),
        tap((data) => this.setSession(data))
      );
  }

  googleAuth(payload: GoogleAuthPayload): Observable<AuthData> {
    return this.http
      .post<ApiResponse<AuthData>>(`${this.apiUrl}/google`, payload)
      .pipe(
        map((res) => res.data),
        tap((data) => {
          this.pendingGoogleSignup.set(null);
          this.setSession(data);
        })
      );
  }

  /** Emails a reset link if the account exists; the answer is the same either way. */
  forgotPassword(email: string): Observable<string> {
    return this.http
      .post<{ success: boolean; message: string }>(`${this.apiUrl}/forgot-password`, { email })
      .pipe(map((res) => res.message));
  }

  /** Sets a new password with the token from the reset email. */
  resetPassword(token: string, password: string): Observable<string> {
    return this.http
      .post<{ success: boolean; message: string }>(`${this.apiUrl}/reset-password`, { token, password })
      .pipe(map((res) => res.message));
  }

  setSession(authData: AuthData): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('auth_token', authData.token);
    localStorage.setItem('auth_user', JSON.stringify(authData.user));
    this.currentUser.set(authData.user);
    this.storeAccess(authData.access ?? null);
  }

  /**
   * Reloads the person's role and permissions, so a change the owner makes
   * shows up without signing out. Also refreshes their name and role type.
   */
  refreshAccess(): Observable<UserAccess | null> {
    return this.http
      .get<ApiResponse<{ user: { name: string; role: AuthUser['role'] }; access: UserAccess }>>(`${this.apiUrl}/me`)
      .pipe(
        map((res) => {
          const user = this.getUser();
          if (user && (user.name !== res.data.user.name || user.role !== res.data.user.role)) {
            this.updateStoredUser({ name: res.data.user.name, role: res.data.user.role });
          }
          this.storeAccess(res.data.access);
          return res.data.access;
        })
      );
  }

  private storeAccess(access: UserAccess | null): void {
    if (typeof localStorage !== 'undefined') {
      if (access) localStorage.setItem('auth_access', JSON.stringify(access));
      else localStorage.removeItem('auth_access');
    }
    this.access.set(access);
  }

  private getStoredAccess(): UserAccess | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored = localStorage.getItem('auth_access');
      return stored ? (JSON.parse(stored) as UserAccess) : null;
    } catch {
      return null;
    }
  }

  /** Keeps the stored user in step after a profile edit (e.g. a new name). */
  updateStoredUser(changes: Partial<AuthUser>): void {
    const user = this.getUser();
    if (!user || typeof localStorage === 'undefined') return;
    const next = { ...user, ...changes };
    localStorage.setItem('auth_user', JSON.stringify(next));
    this.currentUser.set(next);
  }

  getToken(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('auth_token');
  }

  getUser(): AuthUser | null {
    if (typeof localStorage === 'undefined') return null;
    const user = localStorage.getItem('auth_user');
    return user ? JSON.parse(user) : null;
  }

  /**
   * Opens a Kelto support session from the single-use code the admin app
   * hands over: exchanges it, then loads who is being viewed. A normal session
   * that was open in this browser is kept and comes back on exit.
   */
  beginSupportSession(code: string): Observable<string> {
    return this.http
      .post<ApiResponse<{ token: string; landingPath: string }>>(`${environment.apiUrl}/support/exchange`, { code })
      .pipe(
        switchMap((exchange) => {
          if (!this.supportSession()) {
            const saved = Object.fromEntries(AUTH_KEYS.map((key) => [key, localStorage.getItem(key)]));
            if (saved['auth_token']) localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
            else localStorage.removeItem(SAVED_KEY);
          }
          localStorage.setItem('auth_token', exchange.data.token);
          return this.http
            .get<ApiResponse<{ user: AuthUser; access: UserAccess; business: AuthBusiness; support: SupportSessionInfo }>>(`${this.apiUrl}/me`)
            .pipe(
              map((me) => {
                localStorage.setItem(SUPPORT_KEY, JSON.stringify(me.data.support));
                this.supportSession.set(me.data.support);
                this.setSession({ token: exchange.data.token, user: me.data.user, business: me.data.business, access: me.data.access });
                return exchange.data.landingPath || '/dashboard';
              })
            );
        })
      );
  }

  /** Leaves the support session: ends it on the server, restores any previous session. */
  exitSupportSession(goTo: string | null = '/support/ended'): void {
    const token = this.getToken();
    if (token && typeof fetch === 'function') {
      // keepalive: the request survives the reload below
      fetch(`${environment.apiUrl}/support/end`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(
        () => undefined
      );
    }
    if (typeof localStorage !== 'undefined') {
      const saved = readJson<Record<string, string | null>>(SAVED_KEY);
      localStorage.removeItem(SUPPORT_KEY);
      localStorage.removeItem(SAVED_KEY);
      for (const key of AUTH_KEYS) {
        const value = saved?.[key];
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      }
    }
    this.supportSession.set(null);
    this.currentUser.set(this.getUser());
    this.access.set(this.getStoredAccess());
    // A full reload so nothing cached from the viewed workspace survives
    if (goTo && typeof window !== 'undefined') window.location.assign(goTo);
  }

  logout(): void {
    if (this.supportSession()) {
      this.exitSupportSession();
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_access');
    }
    this.currentUser.set(null);
    this.access.set(null);
    this.router.navigate(['/auth/login']);
  }

  isTokenExpired(token: string | null = this.getToken()): boolean {
    if (!token) return true;
    try {
      // JWT parts are base64url: map to base64 before decoding
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
      return payload.exp ? Date.now() >= payload.exp * 1000 : false;
    } catch {
      return true;
    }
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    return !!token && !this.isTokenExpired(token);
  }
}