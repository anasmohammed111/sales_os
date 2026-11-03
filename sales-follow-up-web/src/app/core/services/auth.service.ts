import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON';
  businessId: string;
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

  setSession(authData: AuthData): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('auth_token', authData.token);
    localStorage.setItem('auth_user', JSON.stringify(authData.user));
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
    }
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