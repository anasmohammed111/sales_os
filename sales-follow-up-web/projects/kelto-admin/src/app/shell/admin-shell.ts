import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AdminSession } from '../core/admin-session';

export interface NavItem {
  label: string;
  path: string;
  permission: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The permission-aware platform navigation.
 */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'SaaS dashboard', path: '/dashboard', permission: 'dashboard.view' }],
  },
  {
    label: 'Revenue',
    items: [
      { label: 'Subscriptions', path: '/subscriptions', permission: 'subscriptions.view' },
      { label: 'Plans & pricing', path: '/plans', permission: 'plans.view' },
    ],
  },
  {
    label: 'Companies',
    items: [
      { label: 'All companies', path: '/companies', permission: 'companies.view' },
      { label: 'Company users', path: '/people', permission: 'companies.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Platform administrators', path: '/admins', permission: 'admins.view' },
      { label: 'Support sessions', path: '/support-sessions', permission: 'sessions.view' },
      { label: 'Audit log', path: '/audit', permission: 'audit.view' },
    ],
  },
];

/** Groups and items the given permissions allow (empty groups are dropped). */
export function visibleNav(can: (permission: string) => boolean): NavGroup[] {
  return NAV.map((group) => ({ ...group, items: group.items.filter((item) => can(item.permission)) })).filter((g) => g.items.length);
}

@Component({
  selector: 'ka-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="layout">
      <aside class="side" aria-label="Kelto admin">
        <a class="brand" routerLink="/">
          <img src="kelto-mark.svg" alt="" width="34" height="34" />
          <span><strong>Kelto</strong><small>Admin</small></span>
        </a>
        <nav>
          @for (group of nav(); track group.label) {
            <p class="group">{{ group.label }}</p>
            @for (item of group.items; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active">{{ item.label }}</a>
            }
          }
        </nav>
        <div class="me">
          <strong>{{ session.profile()?.name }}</strong>
          <small>{{ session.profile()?.roleName }}</small>
          <span class="me-actions">
            <a routerLink="/account/password">Change password</a>
            <button type="button" (click)="signOut()">Sign out</button>
          </span>
        </div>
      </aside>
      <main class="body">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 250px 1fr; min-height: 100vh; }
    .side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 18px; height: 100vh; padding: 18px 14px; background: #0b1220; color: #cbd5e1; }
    .brand { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; }
    .brand span { display: grid; line-height: 1.1; }
    .brand small { color: #f6a68f; font-size: 12px; font-weight: 700; }
    nav { display: grid; gap: 2px; flex: 1; align-content: start; overflow-y: auto; }
    .group { margin: 14px 8px 6px; color: #64748b; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    nav a { padding: 9px 10px; border-radius: 9px; color: #cbd5e1; font-size: 14px; font-weight: 600; text-decoration: none; }
    nav a:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    nav a.active { background: rgba(229, 96, 62, 0.16); color: #fff; box-shadow: inset 3px 0 0 #e5603e; }
    .me { display: grid; gap: 2px; padding: 12px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; }
    .me strong { color: #fff; font-size: 14px; }
    .me small { color: #94a3b8; font-size: 12px; }
    .me-actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12.5px; }
    .me-actions a { color: #cbd5e1; }
    .me-actions button { padding: 0; border: 0; background: none; color: #f6a68f; font: inherit; font-weight: 700; cursor: pointer; }
    .body { min-width: 0; padding: 28px 32px 60px; }
    @media (max-width: 860px) {
      .layout { grid-template-columns: minmax(0, 1fr); width: 100%; overflow-x: hidden; }
      .side { position: sticky; top: 0; z-index: 50; flex-direction: row; align-items: center; gap: 10px; width: 100%; min-width: 0; height: auto; overflow: hidden; padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,.1); }
      .brand { flex: 0 0 auto; }
      .brand img { width: 29px; height: 29px; }
      .brand span { font-size: 13px; }
      .brand small { display: none; }
      nav { display: flex; flex: 1; min-width: 0; gap: 3px; overflow-x: auto; scrollbar-width: none; }
      nav::-webkit-scrollbar { display: none; }
      .group { display: none; }
      nav a { flex: 0 0 auto; padding: 7px 9px; font-size: 12px; white-space: nowrap; }
      nav a.active { box-shadow: inset 0 -2px 0 #e5603e; }
      .me { display: block; flex: 0 0 auto; padding: 0; border: 0; }
      .me > strong, .me > small, .me-actions a { display: none; }
      .me-actions { margin: 0; }
      .me-actions button { padding: 7px 4px; font-size: 11px; white-space: nowrap; }
      .body { padding: 20px 16px 48px; }
    }
    @media (max-width: 520px) { .brand span { display: none; } }
  `,
})
export class AdminShell {
  readonly session = inject(AdminSession);
  private readonly router = inject(Router);
  readonly nav = computed(() => {
    const allowed = this.session.permissions();
    return visibleNav((p) => allowed.has(p));
  });

  signOut(): void {
    this.session.clear();
    this.router.navigate(['/login']);
  }
}

/** Landing: the first page the administrator's role allows. */
@Component({ selector: 'ka-home', template: '<p class="pf-empty">Your role has no pages yet.</p>' })
export class AdminHome {
  constructor() {
    const session = inject(AdminSession);
    const first = visibleNav((p) => session.can(p))[0]?.items[0];
    if (first) inject(Router).navigate([first.path], { replaceUrl: true });
  }
}
