import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, UserAccess } from './auth.service';

/** Keys for the super admin console session (never the workspace auth_* keys) */
const TOKEN_KEY = 'kelto_platform_token';
const ADMIN_KEY = 'kelto_platform_admin';

export interface PlatformAdminInfo {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceSummary {
  id: string;
  businessName: string;
  email: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  features: { admissions: boolean };
  counts: { users: number; activeUsers: number; leads: number; students: number; activeStudents: number };
  lastActivityAt: string | null;
}

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  roleName: string;
  isActive: boolean;
  createdAt: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  users: WorkspaceUser[];
}

export interface PlatformUser extends WorkspaceUser {
  workspace: { id: string; businessName: string } | null;
}

export interface AuditEntry {
  id: string;
  action: 'LOGIN' | 'LOGIN_FAILED' | 'VIEW_WORKSPACE' | 'FEATURE_CHANGED';
  admin: PlatformAdminInfo | null;
  workspace: { id: string; businessName: string } | null;
  reason: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** What opening a workspace returns: a one-hour, read-only session for it */
export interface WorkspaceView {
  token: string;
  expiresAt: string;
  business: { id: string; businessName: string };
  user: AuthUser;
  access: UserAccess;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

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

/** The platform super admin console: separate sign-in, every workspace. */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly base = `${environment.apiUrl}/platform`;

  readonly admin = signal<PlatformAdminInfo | null>(this.readAdmin());

  token(): string | null {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
  }

  isSignedIn(): boolean {
    const payload = tokenPayload(this.token());
    return !!payload && (!payload.exp || Date.now() < payload.exp * 1000);
  }

  login(email: string, password: string): Observable<PlatformAdminInfo> {
    return this.http
      .post<ApiResponse<{ token: string; admin: PlatformAdminInfo }>>(`${this.base}/auth/login`, { email, password })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.data.token);
          localStorage.setItem(ADMIN_KEY, JSON.stringify(res.data.admin));
          this.admin.set(res.data.admin);
        }),
        map((res) => res.data.admin)
      );
  }

  signOut(navigate = true): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ADMIN_KEY);
    }
    this.admin.set(null);
    if (navigate) this.router.navigate(['/platform/login']);
  }

  workspaces(search = ''): Observable<{ items: WorkspaceSummary[]; totals: { workspaces: number; users: number; leads: number; students: number } }> {
    const params = new HttpParams({ fromObject: search ? { search } : {} });
    return this.http
      .get<ApiResponse<{ items: WorkspaceSummary[]; totals: { workspaces: number; users: number; leads: number; students: number } }>>(
        `${this.base}/workspaces`,
        { params }
      )
      .pipe(map((r) => r.data));
  }

  workspace(id: string): Observable<WorkspaceDetail> {
    return this.http.get<ApiResponse<WorkspaceDetail>>(`${this.base}/workspaces/${id}`).pipe(map((r) => r.data));
  }

  setFeatures(id: string, features: { admissions?: boolean }): Observable<WorkspaceSummary> {
    return this.http.patch<ApiResponse<WorkspaceSummary>>(`${this.base}/workspaces/${id}/features`, features).pipe(map((r) => r.data));
  }

  openWorkspace(id: string, reason: string, path: string): Observable<WorkspaceView> {
    return this.http.post<ApiResponse<WorkspaceView>>(`${this.base}/workspaces/${id}/view`, { reason, path }).pipe(map((r) => r.data));
  }

  users(search: string, page: number): Observable<Paged<PlatformUser>> {
    const params = new HttpParams({ fromObject: { page: String(page), ...(search ? { search } : {}) } });
    return this.http.get<ApiResponse<Paged<PlatformUser>>>(`${this.base}/users`, { params }).pipe(map((r) => r.data));
  }

  audit(businessId: string, page: number): Observable<Paged<AuditEntry>> {
    const params = new HttpParams({ fromObject: { page: String(page), ...(businessId ? { businessId } : {}) } });
    return this.http.get<ApiResponse<Paged<AuditEntry>>>(`${this.base}/audit`, { params }).pipe(map((r) => r.data));
  }

  private readAdmin(): PlatformAdminInfo | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored = localStorage.getItem(ADMIN_KEY);
      return stored ? (JSON.parse(stored) as PlatformAdminInfo) : null;
    } catch {
      return null;
    }
  }
}
