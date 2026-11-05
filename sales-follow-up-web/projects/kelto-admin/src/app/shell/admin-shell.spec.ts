import { TestBed } from '@angular/core/testing';
import { AdminSession, AdminProfile } from '../core/admin-session';
import { visibleNav } from './admin-shell';

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (exp: number) => `${b64url({ alg: 'HS256' })}.${b64url({ kind: 'platform', exp })}.sig`;

const profile = (permissions: string[]): AdminProfile => ({
  id: 'a1',
  name: 'Ada',
  email: 'ada@kelto.test',
  role: 'AUDITOR',
  roleName: 'Read-only auditor',
  permissions,
  mustChangePassword: false,
});

describe('Kelto admin navigation and session', () => {
  afterEach(() => localStorage.clear());

  it('lists only the sections a role allows', () => {
    const auditor = new Set(['companies.view', 'sessions.view', 'admins.view', 'audit.view']);
    const nav = visibleNav((p) => auditor.has(p));
    expect(nav.map((g) => g.label)).toEqual(['Companies', 'Administration']);
    expect(nav[1].items.map((i) => i.label)).toEqual(['Platform administrators', 'Support sessions', 'Audit log']);

    const billing = new Set(['dashboard.view', 'companies.view', 'plans.view', 'subscriptions.view', 'audit.view']);
    expect(visibleNav((p) => billing.has(p)).flatMap((g) => g.items.map((i) => i.path))).toEqual([
      '/dashboard',
      '/subscriptions',
      '/plans',
      '/companies',
      '/people',
      '/audit',
    ]);

    expect(visibleNav(() => false)).toEqual([]);
  });

  it('knows who is signed in, what they may do, and when the session has expired', () => {
    const session = TestBed.inject(AdminSession);
    expect(session.isSignedIn()).toBe(false);

    session.set(token(Math.floor(Date.now() / 1000) + 600), profile(['companies.view']));
    expect(session.isSignedIn()).toBe(true);
    expect(session.can('companies.view')).toBe(true);
    expect(session.can('admins.manage')).toBe(false);

    session.set(token(Math.floor(Date.now() / 1000) - 5), profile(['companies.view']));
    expect(session.isSignedIn()).toBe(false);

    session.clear();
    expect(session.profile()).toBeNull();
  });
});
