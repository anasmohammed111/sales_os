import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AccountSettings {
  profile: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON';
    hasPassword: boolean;
    hasGoogle: boolean;
  };
  business: {
    id: string;
    businessName: string;
    email: string;
    phone: string;
    address: string;
    gstin: string;
    currency: string;
  };
  features: { admissions: boolean };
  currencies: string[];
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/settings`;

  /** The business currency for money shown across the app. */
  readonly currency = signal('USD');

  private remember = (settings: AccountSettings) => this.currency.set(settings.business.currency || 'USD');

  get(): Observable<AccountSettings> {
    return this.http.get<ApiResponse<AccountSettings>>(this.base).pipe(
      map((res) => res.data),
      tap(this.remember)
    );
  }

  /** Loads settings once so the currency is right; errors are ignored (USD stays). */
  loadCurrency(): void {
    this.get().subscribe({ error: () => {} });
  }

  updateProfile(body: { name: string; phone: string }): Observable<AccountSettings> {
    return this.http.patch<ApiResponse<AccountSettings>>(`${this.base}/profile`, body).pipe(map((res) => res.data));
  }

  updateBusiness(body: Partial<AccountSettings['business']>): Observable<AccountSettings> {
    return this.http.patch<ApiResponse<AccountSettings>>(`${this.base}/business`, body).pipe(
      map((res) => res.data),
      tap(this.remember)
    );
  }

  changePassword(body: { currentPassword?: string; newPassword: string }): Observable<AccountSettings> {
    return this.http.post<ApiResponse<AccountSettings>>(`${this.base}/password`, body).pipe(map((res) => res.data));
  }
}

/** Whole-unit money in the given currency, e.g. "₹1,50,000" or "$12,000". */
export const formatMoney = (value: number | null | undefined, currency: string) => {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value ?? 0);
  } catch {
    return `${currency} ${Math.round(value ?? 0)}`;
  }
};
