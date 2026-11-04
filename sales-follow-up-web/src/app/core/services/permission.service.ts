import { computed, inject, Injectable } from '@angular/core';
import { AuthService, DataScope } from './auth.service';

/** Pages in the order a person lands on them, with the permission each needs */
const LANDING_PAGES: { path: string; permission: string }[] = [
  { path: '/dashboard', permission: 'dashboard.view' },
  { path: '/leads', permission: 'leads.view' },
  { path: '/follow-ups', permission: 'followups.view' },
  { path: '/pipeline', permission: 'pipeline.view' },
  { path: '/quotations', permission: 'quotations.view' },
  { path: '/admissions/overview', permission: 'admissions.view' },
  { path: '/reports', permission: 'reports.view' },
  { path: '/team', permission: 'team.view' },
];

/**
 * What the signed-in person may do in the app. Every button and page asks
 * this service (through *ktCan, permissionGuard or can()), so the app shows
 * exactly what their role allows. The API checks the same permissions.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly auth = inject(AuthService);
  private lastRefresh = 0;

  readonly access = this.auth.access;
  private readonly granted = computed(() => new Set(this.access()?.permissions ?? []));

  readonly roleName = computed(() => this.access()?.roleName ?? '');
  readonly isOwner = computed(() => !!this.access()?.isOwner);
  readonly loaded = computed(() => this.access() !== null);

  /** Whether the person has a permission, e.g. can('leads.edit') */
  can(permission: string): boolean {
    return this.granted().has(permission);
  }

  /** Whether the person has at least one of the permissions */
  canAny(...permissions: string[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  /** How much of a module's data the person sees: own, team or all */
  scope(module: 'leads' | 'followups' | 'quotations' | 'admissions'): DataScope {
    return this.access()?.scopes?.[module] ?? 'own';
  }

  /** The first page this person may open (Settings is always allowed) */
  homePath(): string {
    return LANDING_PAGES.find((page) => this.can(page.permission))?.path ?? '/settings';
  }

  /** Reloads permissions from the API, at most every few seconds */
  refresh(force = false): void {
    if (!this.auth.isAuthenticated()) return;
    const now = Date.now();
    if (!force && now - this.lastRefresh < 5_000) return;
    this.lastRefresh = now;
    this.auth.refreshAccess().subscribe({ error: () => {} });
  }
}
