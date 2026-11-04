import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
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

  logout(): void {
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
      const payload = JSON.parse(atob(token.split('.')[1]));
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