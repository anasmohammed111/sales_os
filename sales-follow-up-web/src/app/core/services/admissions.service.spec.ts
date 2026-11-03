import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AdmissionsService } from './admissions.service';

const signIn = (id: string) => localStorage.setItem('auth_user', JSON.stringify({ id, name: id, role: 'OWNER' }));

describe('AdmissionsService context', () => {
  let service: AdmissionsService;
  let http: HttpTestingController;

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
});
