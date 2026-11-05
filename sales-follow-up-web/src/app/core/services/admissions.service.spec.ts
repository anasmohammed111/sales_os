import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdmissionsService } from './admissions.service';

const signIn = (id: string) => localStorage.setItem('auth_user', JSON.stringify({ id, name: id, role: 'OWNER' }));

describe('AdmissionsService context', () => {
  let service: AdmissionsService;
  let http: HttpTestingController;
  /** Test contexts carry a version number to tell refreshes apart */
  const version = () => (service.context() as unknown as { v?: number } | null)?.v;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AdmissionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('reuses the loaded context for the same user', () => {
    signIn('user-a');
    service.loadContext().subscribe();
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a' } });

    service.loadContext().subscribe();
    http.expectNone((r) => r.url.endsWith('/admissions/context'));
  });

  it("never shows one user's context to the next person who signs in on the same tab", () => {
    signIn('user-a');
    service.loadContext().subscribe();
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a' } });

    signIn('user-b');
    service.loadContext().subscribe();
    const reload = http.expectOne((r) => r.url.endsWith('/admissions/context'));
    expect(service.context()).toBeNull();
    reload.flush({ success: true, data: { userId: 'user-b' } });
    expect(service.context()?.userId).toBe('user-b');
  });

  // Pages under the admissions layout only render while the state is 'ready'. A page
  // that refreshes on open (Settings) must not flip it to 'loading', or the layout
  // destroys and recreates the page in an endless loop.
  it('refreshes a loaded context in the background, staying ready', () => {
    signIn('user-a');
    service.loadContext().subscribe();
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a', v: 1 } });

    service.loadContext(true).subscribe();
    expect(service.contextState()).toBe('ready');
    expect(version()).toBe(1);

    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a', v: 2 } });
    expect(service.contextState()).toBe('ready');
    expect(version()).toBe(2);
  });

  it('keeps the loaded context when a background refresh fails', () => {
    signIn('user-a');
    service.loadContext().subscribe();
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a', v: 1 } });

    let result: unknown;
    service.loadContext(true).subscribe((ctx) => (result = ctx));
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ message: 'bad' }, { status: 400, statusText: 'Bad Request' });

    expect(service.contextState()).toBe('ready');
    expect(version()).toBe(1);
    expect((result as { v: number }).v).toBe(1);
  });

  it('shows loading, then an error, on a first load the server rejects', () => {
    signIn('user-a');
    service.loadContext().subscribe();
    expect(service.contextState()).toBe('loading');
    http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ message: 'bad' }, { status: 400, statusText: 'Bad Request' });
    expect(service.contextState()).toBe('error');
  });

  // The server or database being briefly down (e.g. reconnecting after the
  // computer slept) must not make Admissions disappear until a reload.
  describe('when the server is briefly unreachable', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const down = () =>
      http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ message: 'write ECONNRESET' }, { status: 500, statusText: 'Server Error' });

    it('retries the first load and recovers', () => {
      signIn('user-a');
      service.loadContext().subscribe();
      down();
      expect(service.contextState()).toBe('loading');

      vi.advanceTimersByTime(2000);
      http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ success: true, data: { userId: 'user-a', v: 1 } });
      expect(service.contextState()).toBe('ready');
      expect(version()).toBe(1);
    });

    it('gives up after a few tries and reports the error', () => {
      signIn('user-a');
      service.loadContext().subscribe();
      down();
      for (const wait of [2000, 4000, 6000]) {
        vi.advanceTimersByTime(wait);
        down();
      }
      expect(service.contextState()).toBe('error');
      vi.advanceTimersByTime(60_000);
      http.expectNone((r) => r.url.endsWith('/admissions/context'));
    });

    it('does not retry when admissions is switched off for the business', () => {
      signIn('user-a');
      service.loadContext().subscribe();
      http.expectOne((r) => r.url.endsWith('/admissions/context')).flush({ message: 'off' }, { status: 404, statusText: 'Not Found' });
      expect(service.contextState()).toBe('disabled');
      vi.advanceTimersByTime(60_000);
      http.expectNone((r) => r.url.endsWith('/admissions/context'));
    });
  });
});
