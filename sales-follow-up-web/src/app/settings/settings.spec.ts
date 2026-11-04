import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';
import { AuthService } from '../core/services/auth.service';

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

  // What each role may do; Settings follows "settings.business" and "settings.roles"
  const accessFor = (role: string) => ({
    roleId: role,
    roleKey: role,
    roleName: role === 'OWNER' ? 'Owner' : 'Salesperson',
    isOwner: role === 'OWNER',
    permissions: role === 'OWNER' ? ['settings.business', 'settings.roles', 'team.view', 'admissions.settings'] : [],
    scopes: {},
  });

  const load = async (role: string) => {
    TestBed.inject(AuthService).access.set(accessFor(role));
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/settings')).flush(settingsFor(role));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const typeInto = async (selector: string, value: string) => {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const submit = (selector: string) =>
    (fixture.nativeElement.querySelector(selector) as HTMLFormElement).dispatchEvent(new Event('submit'));

  it('loads the profile and business from the API', async () => {
    await load('OWNER');

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('anu@syb.local');
    expect((fixture.nativeElement.querySelector('#brand-name') as HTMLInputElement).value).toBe('SYB Education');
    expect((fixture.nativeElement.querySelector('#business-email') as HTMLInputElement).value).toBe('office@syb.local');
  });

  it('lets only the owner edit branding and business details', async () => {
    await load('SALESPERSON');

    expect(fixture.nativeElement.querySelector('#brand-name')).toBeNull();
    expect(fixture.nativeElement.querySelector('#business-email')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Branding is managed by the workspace owner');
    expect(fixture.nativeElement.textContent).toContain('managed by the workspace owner');
  });

  it('sends the owner’s business changes to the API, without the firm name', async () => {
    await load('OWNER');

    await typeInto('#business-email', 'hello@syb.local');
    submit('#business-form');

    const req = http.expectOne((r) => r.url.endsWith('/settings/business'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.email).toBe('hello@syb.local');
    expect('businessName' in req.request.body).toBe(false);
    req.flush(settingsFor('OWNER'));
  });

  it('saves a new firm name from Workspace branding', async () => {
    await load('OWNER');

    await typeInto('#brand-name', '  SYB Admissions  ');
    submit('.brand-form');

    const req = http.expectOne((r) => r.url.endsWith('/settings/business'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ businessName: 'SYB Admissions' });
    req.flush(settingsFor('OWNER'));
  });

  it('uploads a chosen logo first, then saves the name', async () => {
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:logo-preview';
    URL.revokeObjectURL = () => {};
    try {
      await load('OWNER');
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'firm-logo.png', { type: 'image/png' });
      fixture.componentInstance.onLogoSelected({ target: { files: [file], value: 'firm-logo.png' } } as unknown as Event);
      await typeInto('#brand-name', 'SYB Admissions');
      expect(fixture.nativeElement.textContent).toContain('firm-logo.png is ready');

      submit('.brand-form');

      const upload = http.expectOne((r) => r.url.endsWith('/settings/business/logo'));
      expect(upload.request.method).toBe('POST');
      expect((upload.request.body as FormData).get('file')).toBe(file);
      upload.flush(settingsFor('OWNER'));

      const rename = http.expectOne((r) => r.url.endsWith('/settings/business'));
      expect(rename.request.body).toEqual({ businessName: 'SYB Admissions' });
      rename.flush(settingsFor('OWNER'));
    } finally {
      URL.createObjectURL = created;
      URL.revokeObjectURL = revoked;
    }
  });

  it('refuses a logo that is not a JPG, PNG or WEBP image', async () => {
    await load('OWNER');
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    fixture.componentInstance.onLogoSelected({ target: { files: [file], value: 'logo.svg' } } as unknown as Event);

    expect(fixture.componentInstance.selectedLogo()).toBeNull();
    expect(fixture.componentInstance.brandingChanged()).toBe(false);
  });
});
