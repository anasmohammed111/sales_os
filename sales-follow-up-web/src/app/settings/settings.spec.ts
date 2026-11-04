import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';

const settingsFor = (role: string) => ({
  success: true,
  data: {
    profile: { id: 'u1', name: 'Anu', email: 'anu@syb.local', phone: '', role, hasPassword: true, hasGoogle: false },
    business: { id: 'b1', businessName: 'SYB Education', email: 'office@syb.local', phone: '', address: '', gstin: '', currency: 'INR' },
    features: { admissions: true },
    currencies: ['INR', 'USD'],
  },
});

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Settings);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const load = async (role: string) => {
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/settings')).flush(settingsFor(role));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('loads the profile and business from the API', async () => {
    await load('OWNER');

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('anu@syb.local');
    expect((fixture.nativeElement.querySelector('#business-name') as HTMLInputElement).value).toBe('SYB Education');
  });

  it('lets only the owner edit business details', async () => {
    await load('SALESPERSON');

    expect(fixture.nativeElement.querySelector('#business-name')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('managed by the workspace owner');
  });

  it('sends the owner’s business changes to the API', async () => {
    await load('OWNER');

    const input = fixture.nativeElement.querySelector('#business-name') as HTMLInputElement;
    input.value = 'SYB Admissions';
    input.dispatchEvent(new Event('input'));
    (fixture.nativeElement.querySelector('#business-form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const req = http.expectOne((r) => r.url.endsWith('/settings/business'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.businessName).toBe('SYB Admissions');
    req.flush(settingsFor('OWNER'));
  });
});
