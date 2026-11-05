import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService, UserAccess } from './auth.service';
import { PlatformService } from './platform.service';
import { PermissionService } from './permission.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { PlatformViewBanner } from '../../shared/platform-view-banner/platform-view-banner';

/** A JWT-shaped token whose payload holds `-`/`_` characters once base64url-encoded. */
const tokenWith = (payload: object) => {
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
};

const viewAccess: UserAccess = {
  roleId: null,
  roleKey: 'PLATFORM_VIEW',
  roleName: 'Super admin (read-only)',
  isOwner: true,
  permissions: ['leads.view', 'admissions.view', 'admissions.payments'],
  scopes: { leads: 'all', admissions: 'all' },
  readOnly: true,
};

const view = () => ({
  token: tokenWith({ kind: 'platform-view', exp: Math.floor(Date.now() / 1000) + 3600, note: '???>>>' }),
  user: { id: 'admin-1', name: 'Root (super admin)', email: 'root@kelto.test', role: 'OWNER' as const, businessId: 'biz-1' },
  access: viewAccess,
  business: { businessName: 'Acme Study Abroad' },
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});

describe('Super admin read-only view', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  it('switches to the workspace, hides edit actions, and restores the earlier session on exit', () => {
    localStorage.setItem('auth_token', 'normal-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', name: 'Me', role: 'OWNER' }));
    localStorage.setItem('auth_access', JSON.stringify({ ...viewAccess, roleKey: 'OWNER', permissions: ['leads.create'], readOnly: false }));

    auth.startPlatformView(view());
    const permissions = TestBed.inject(PermissionService);
    expect(auth.platformView()?.businessName).toBe('Acme Study Abroad');
    expect(auth.isAuthenticated()).toBe(true);
    expect(permissions.can('leads.view')).toBe(true);
    expect(permissions.can('leads.create')).toBe(false);

    auth.exitPlatformView(null);
    expect(auth.platformView()).toBeNull();
    expect(localStorage.getItem('auth_token')).toBe('normal-token');
    expect(auth.currentUser()?.name).toBe('Me');
    expect(localStorage.getItem('kelto_platform_view')).toBeNull();
  });

  it('signs out of the workspace on exit when there was no earlier session', () => {
    auth.startPlatformView(view());
    auth.exitPlatformView(null);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });

  it('reads token expiry from base64url payloads', () => {
    expect(auth.isTokenExpired(tokenWith({ exp: Math.floor(Date.now() / 1000) + 60, note: '???>>>' }))).toBe(false);
    expect(auth.isTokenExpired(tokenWith({ exp: Math.floor(Date.now() / 1000) - 60, note: '???>>>' }))).toBe(true);
  });

  it('sends the console token only to the platform API', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    localStorage.setItem('auth_token', 'workspace-token');
    localStorage.setItem('kelto_platform_token', 'console-token');

    http.get('http://localhost:5001/api/platform/workspaces').subscribe();
    http.get('http://localhost:5001/api/leads').subscribe();
    expect(backend.expectOne((r) => r.url.includes('/api/platform/')).request.headers.get('Authorization')).toBe('Bearer console-token');
    expect(backend.expectOne((r) => r.url.includes('/api/leads')).request.headers.get('Authorization')).toBe('Bearer workspace-token');
    backend.verify();
    expect(TestBed.inject(PlatformService).token()).toBe('console-token');
  });

  it('shows the banner only while viewing', () => {
    const fixture = TestBed.createComponent(PlatformViewBanner);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    auth.startPlatformView(view());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Acme Study Abroad');
    expect(fixture.nativeElement.textContent).toContain('read-only');
  });
});
