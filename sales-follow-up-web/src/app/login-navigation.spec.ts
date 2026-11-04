import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, take } from 'rxjs';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

const encodeBase64Url = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

describe('Login navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter(routes),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    localStorage.clear();
  });

  it('navigates to the dashboard after a successful login', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/auth/login');
    const loginPage = harness.routeNativeElement as HTMLElement;
    const email = loginPage.querySelector<HTMLInputElement>('input[type="email"]');
    const password = loginPage.querySelector<HTMLInputElement>('#password');
    const form = loginPage.querySelector<HTMLFormElement>('form');
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    expect(form).not.toBeNull();

    email!.value = 'admin@syb.local';
    email!.dispatchEvent(new Event('input'));
    password!.value = 'test-password';
    password!.dispatchEvent(new Event('input'));
    form!.dispatchEvent(new Event('submit'));

    const dashboardNavigation = firstValueFrom(
      router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd && event.urlAfterRedirects === '/dashboard'),
        take(1)
      )
    );
    const expiration = Math.floor(Date.now() / 1000) + 86400;
    http.expectOne((request) => request.url.endsWith('/auth/login')).flush({
      success: true,
      message: 'Login successful',
      data: {
        token: [
          encodeBase64Url({ alg: 'HS256', typ: 'JWT' }),
          encodeBase64Url({ userId: 'u1', businessId: 'b1', role: 'OWNER', exp: expiration }),
          'sig',
        ].join('.'),
        user: { id: 'u1', name: 'Test Owner', email: 'admin@syb.local', role: 'OWNER', businessId: 'b1' },
        business: { _id: 'b1', businessName: 'Test Business' },
      },
    });

    await dashboardNavigation;
    http.match(() => true).forEach((request) => request.error(new ProgressEvent('error')));

    expect(router.url).toBe('/dashboard');
  });
});
