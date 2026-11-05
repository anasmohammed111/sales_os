import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminProfile } from './admin-session';

export type CompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type SupportMode = 'VIEW_OWNER' | 'VIEW_USER' | 'SUPPORT_EDIT';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface PlanLimits {
  users: number;
  leads: number;
  students: number;
  storageMb: number;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  currency: string;
  prices: { monthly: number; yearly: number };
  trialDays: number;
  limits: PlanLimits;
  modules: string[];
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionSummary {
  id: string;
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface Company {
  id: string;
  businessName: string;
  email: string;
  phone: string;
  status: CompanyStatus;
  statusReason: string;
  statusChangedAt: string | null;
  createdAt: string;
  features: { admissions: boolean };
  subscription: SubscriptionSummary | null;
  supportEditAllowedUntil: string | null;
  counts: { users: number; activeUsers: number; leads: number; students: number; activeStudents: number };
  lastActivityAt: string | null;
}

export interface CompanyUser {
  id: string;
  name: string;
  email: string;
  roleName: string;
  isOwner?: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CompanyDetail extends Company {
  users: CompanyUser[];
}

export interface PlatformUser extends CompanyUser {
  workspace: { id: string; businessName: string; status: CompanyStatus } | null;
}

export interface Totals {
  workspaces: number;
  users: number;
  leads: number;
  students: number;
  suspended: number;
  subscribed: number;
  trials: number;
  pastDue: number;
}

export interface Subscription {
  id: string;
  workspace: { id: string; businessName: string; email: string; status: CompanyStatus };
  planId: string;
  plan: Omit<Plan, 'id' | 'description' | 'status' | 'createdAt' | 'updatedAt'>;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaaSDashboard {
  metrics: {
    companies: number;
    activeCompanies: number;
    suspendedCompanies: number;
    newCompanies30d: number;
    subscriptions: number;
    activeSubscriptions: number;
    trialingSubscriptions: number;
    pastDueSubscriptions: number;
    scheduledCancellations: number;
    mrrByCurrency: { currency: string; amountMinor: number }[];
  };
  statusDistribution: { status: SubscriptionStatus; count: number }[];
  planDistribution: { key: string; name: string; count: number }[];
  recentSubscriptions: Subscription[];
}

export interface PlanInput {
  key?: string;
  name?: string;
  description?: string;
  currency?: string;
  prices?: { monthly: number; yearly: number };
  trialDays?: number;
  limits?: PlanLimits;
  modules?: string[];
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface SubscriptionInput {
  planId?: string;
  billingCycle?: BillingCycle;
  status?: SubscriptionStatus;
  trialEndsAt?: string | null;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  notes?: string;
  reason: string;
}

export interface SupportSession {
  id: string;
  mode: SupportMode;
  status: 'ACTIVE' | 'ENDED' | 'REVOKED' | 'EXPIRED';
  admin: { id: string; name: string; email: string } | null;
  workspace: { id: string; businessName: string } | null;
  targetUser: { id: string; name: string; email: string } | null;
  reason: string;
  allowedPermissions: string[];
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: string;
  writeCount: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  admin: { id: string; name: string; email: string } | null;
  targetAdmin: { id: string; name: string; email: string } | null;
  workspace: { id: string; businessName: string } | null;
  supportSessionId: string | null;
  reason: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export interface PlatformAdminRow {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface RoleInfo {
  key: string;
  name: string;
  permissions: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

const params = (values: Record<string, string | number | undefined>) =>
  new HttpParams({
    fromObject: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>,
  });

/** Every call the Kelto admin app makes (all under /api/platform). */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/platform`;

  private get<T>(path: string, query: Record<string, string | number | undefined> = {}): Observable<T> {
    return this.http.get<Envelope<T>>(`${this.base}${path}`, { params: params(query) }).pipe(map((r) => r.data));
  }
  private post<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.post<Envelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }
  private patch<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.patch<Envelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }
  private put<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.put<Envelope<T>>(`${this.base}${path}`, body).pipe(map((r) => r.data));
  }

  // Account
  login(email: string, password: string) {
    return this.post<{ token: string; admin: AdminProfile }>('/auth/login', { email, password });
  }
  me() {
    return this.get<{ admin: AdminProfile }>('/auth/me');
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.post<{ token: string; admin: AdminProfile }>('/auth/change-password', { currentPassword, newPassword });
  }

  // SaaS overview, plans and subscriptions
  dashboard() {
    return this.get<SaaSDashboard>('/dashboard');
  }
  plans(status = '') {
    return this.get<{ items: Plan[] }>('/plans', { status });
  }
  createPlan(body: PlanInput) {
    return this.post<{ plan: Plan }>('/plans', body);
  }
  updatePlan(id: string, body: PlanInput) {
    return this.patch<{ plan: Plan }>(`/plans/${id}`, body);
  }
  subscriptions(query: { search?: string; status?: string; plan?: string; billingCycle?: string; businessId?: string; page?: number } = {}) {
    return this.get<Paged<Subscription>>('/subscriptions', query);
  }
  saveSubscription(companyId: string, body: SubscriptionInput) {
    return this.put<{ subscription: Subscription }>(`/workspaces/${companyId}/subscription`, body);
  }

  // Companies
  companies(search = '', status = '') {
    return this.get<{ items: Company[]; totals: Totals }>('/workspaces', { search, status });
  }
  company(id: string) {
    return this.get<CompanyDetail>(`/workspaces/${id}`);
  }
  setFeatures(id: string, features: { admissions?: boolean }) {
    return this.patch<Company>(`/workspaces/${id}/features`, features);
  }
  suspend(id: string, reason: string) {
    return this.post<Company>(`/workspaces/${id}/suspend`, { reason });
  }
  reactivate(id: string, reason: string) {
    return this.post<Company>(`/workspaces/${id}/reactivate`, { reason });
  }
  people(search: string, page: number) {
    return this.get<Paged<PlatformUser>>('/users', { search, page });
  }

  // Support sessions
  startSupportSession(
    companyId: string,
    body: { mode: SupportMode; userId?: string; reason: string; allowedPermissions?: string[]; landingPath?: string }
  ) {
    return this.post<{ session: SupportSession; handoffCode: string; handoffExpiresAt: string }>(`/workspaces/${companyId}/support-sessions`, body);
  }
  supportSessions(status = '', businessId = '', page = 1) {
    return this.get<Paged<SupportSession>>('/support-sessions', { status, businessId, page });
  }
  revokeSupportSession(id: string, reason: string) {
    return this.post<SupportSession>(`/support-sessions/${id}/revoke`, { reason });
  }
  supportEditOptions() {
    return this.get<{ permissions: string[]; maxMinutes: number }>('/support/edit-options');
  }

  // Administrators
  roles() {
    return this.get<{ roles: RoleInfo[]; permissions: Record<string, string> }>('/roles');
  }
  admins() {
    return this.get<{ items: PlatformAdminRow[] }>('/admins');
  }
  createAdmin(body: { name: string; email: string; role: string }) {
    return this.post<{ admin: PlatformAdminRow; temporaryPassword: string }>('/admins', body);
  }
  updateAdmin(id: string, body: { name?: string; role?: string; isActive?: boolean }) {
    return this.patch<{ admin: PlatformAdminRow }>(`/admins/${id}`, body);
  }
  resetAdminPassword(id: string) {
    return this.post<{ admin: PlatformAdminRow; temporaryPassword: string }>(`/admins/${id}/reset-password`);
  }
  revokeAdminSessions(id: string) {
    return this.post<{ admin: PlatformAdminRow }>(`/admins/${id}/revoke-sessions`);
  }
  adminLogins(id: string) {
    return this.get<{ items: { id: string; action: string; details: Record<string, unknown>; ip: string; userAgent: string; createdAt: string }[] }>(
      `/admins/${id}/logins`
    );
  }

  // Audit
  audit(query: { businessId?: string; adminId?: string; action?: string; page?: number }) {
    return this.get<Paged<AuditEntry>>('/audit', query);
  }
}

/** Plain-language names for workspace permissions (support-edit choices). */
export const SUPPORT_PERMISSION_LABELS: Record<string, string> = {
  'leads.edit': 'Edit leads and change their status',
  'leads.assign': 'Reassign leads',
  'followups.edit': 'Edit, complete and cancel follow-ups',
  'followups.assign': 'Reassign follow-ups',
  'pipeline.move': 'Move leads between pipeline stages',
  'quotations.edit': 'Edit quotations',
  'admissions.edit': 'Edit student details, checklists, notes and tasks',
  'admissions.assign': 'Reassign students to counsellors',
  'admissions.move': 'Move students between stages',
  'admissions.documents': 'Upload and review documents',
  'admissions.settings': 'Change admissions settings',
};
