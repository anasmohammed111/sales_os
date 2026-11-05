import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService, UserAccess } from './auth.service';
import { PermissionService } from './permission.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { SupportBanner } from '../../shared/support-banner/support-banner';

/** A JWT-shaped token whose payload holds `-`/`_` characters once base64url-encoded. */
const tokenWith = (payload: object) => {
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
};

const readOnlyAccess: UserAccess = {
  roleId: 'r1',
  roleKey: 'SALESPERSON',
  roleName: 'Salesperson',
  isOwner: false,
  permissions: ['leads.view', 'admissions.view'],
  scopes: { leads: 'own' },
  readOnly: true,
};

const support = {
  sessionId: 's1',
  mode: 'VIEW_USER' as const,
  adminName: 'Root',
  businessName: 'Acme Study Abroad',
  targetUserName: 'Anu Counsellor',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe('Kelto support sessions in the CRM', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    fetchMock.mockClear();
    vi.unstubAllGlobals();
  });

  const begin = () => {
    const supportToken = tokenWith({ kind: 'support', exp: Math.floor(Date.now() / 1000) + 3600 });
    let landing = '';
    auth.beginSupportSession('one-time-code').subscribe((path) => (landing = path));
    const exchange = http.expectOne((r) => r.url.endsWith('/support/exchange'));
    expect(exchange.request.body).toEqual({ code: 'one-time-code' });
    exchange.flush({ success: true, data: { token: supportToken, landingPath: '/leads' } });
    const me = http.expectOne((r) => r.url.endsWith('/auth/me'));
    expect(me.request.headers.get('Authorization')).toBe(`Bearer ${supportToken}`);
    me.flush({
      success: true,
      data: { user: { id: 'u1', name: 'Anu Counsellor', email: 'anu@x.test', role: 'SALESPERSON', businessId: 'b1' }, access: readOnlyAccess, business: { businessName: 'Acme Study Abroad' }, support },
    });
    return { landing: () => landing, supportToken };
  };

  it('exchanges the single-use code, shows the person being viewed, and hides edit actions', () => {
    const { landing } = begin();
    expect(landing()).toBe('/leads');
    expect(auth.supportSession()?.targetUserName).toBe('Anu Counsellor');
    expect(auth.currentUser()?.name).toBe('Anu Counsellor');
    const permissions = TestBed.inject(PermissionService);
    expect(permissions.readOnly()).toBe(true);
    expect(permissions.can('leads.view')).toBe(true);
    expect(permissions.can('leads.create')).toBe(false);
  });

  it('ends the session on the server and restores the earlier sign-in on exit', () => {
    localStorage.setItem('auth_token', 'normal-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'me', name: 'Me', role: 'OWNER' }));
    const { supportToken } = begin();

    auth.exitSupportSession(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/support\/end$/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${supportToken}`);
    expect(auth.supportSession()).toBeNull();
    expect(localStorage.getItem('auth_token')).toBe('normal-token');
    expect(auth.currentUser()?.name).toBe('Me');
  });

  it('reads token expiry from base64url payloads', () => {
    expect(auth.isTokenExpired(tokenWith({ exp: Math.floor(Date.now() / 1000) + 60, note: '???>>>' }))).toBe(false);
    expect(auth.isTokenExpired(tokenWith({ exp: Math.floor(Date.now() / 1000) - 60, note: '???>>>' }))).toBe(true);
  });

  it('shows the support banner only during a session, naming the company and the person', () => {
    const fixture = TestBed.createComponent(SupportBanner);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    begin();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Kelto Support Session — Viewing Acme Study Abroad as Anu Counsellor');
    expect(text).toContain('Read-only');
    expect(text).toContain('Root');
  });
});
