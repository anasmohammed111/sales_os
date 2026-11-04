import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { RolesSettings } from './roles-settings';

const catalog = {
  success: true,
  data: {
    modules: [
      { key: 'leads', label: 'Leads', scoped: true, actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'archive', label: 'Archive' }] },
      { key: 'admissions', label: 'Admissions', scoped: true, actions: [{ key: 'view', label: 'View' }, { key: 'payments', label: 'Payments' }, { key: 'record_payments', label: 'Record' }] },
    ],
    scopes: [
      { key: 'own', label: 'Own records', description: '' },
      { key: 'team', label: 'Their team', description: '' },
      { key: 'all', label: 'Everything', description: '' },
    ],
  },
};

const scopes = { leads: 'own', followups: 'own', quotations: 'own', admissions: 'own' };
const roles = {
  success: true,
  data: [
    { _id: 'owner', name: 'Owner', description: '', key: 'OWNER', isSystem: true, isBuiltIn: true, permissions: ['leads.view'], scopes, memberCount: 1, grantable: false },
    { _id: 'sales', name: 'Salesperson', description: '', key: 'SALESPERSON', isSystem: false, isBuiltIn: true, permissions: ['leads.view'], scopes, memberCount: 2, grantable: true },
  ],
};

describe('Roles & permissions screen', () => {
  let fixture: ComponentFixture<RolesSettings>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RolesSettings],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    TestBed.inject(AuthService).access.set({
      roleId: 'owner', roleKey: 'OWNER', roleName: 'Owner', isOwner: true, permissions: ['settings.roles'], scopes: {},
    });
    fixture = TestBed.createComponent(RolesSettings);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/roles/catalog')).flush(catalog);
    http.expectOne((r) => r.url.endsWith('/roles')).flush(roles);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('opens the first editable role, and keeps the Owner role read-only', () => {
    const screen = fixture.componentInstance;
    expect(screen.selected()?.name).toBe('Salesperson');
    screen.select(screen.roles()[0]);
    expect(screen.readOnly()).toBe(true);
    expect(screen.readOnlyReason()).toContain('cannot be changed');
  });

  it('turning on an action turns on what it needs; turning off View clears the area', () => {
    const screen = fixture.componentInstance;
    screen.toggle('admissions.record_payments', true);
    expect(screen.has('admissions.view')).toBe(true);
    expect(screen.has('admissions.payments')).toBe(true);

    screen.toggle('admissions.payments', false);
    expect(screen.has('admissions.record_payments')).toBe(false);

    screen.toggle('leads.archive', true);
    screen.toggle('leads.view', false);
    expect(screen.has('leads.archive')).toBe(false);
    expect(screen.dirty()).toBe(true);
  });

  it('saves the role with its permissions and data scopes', () => {
    const screen = fixture.componentInstance;
    screen.toggle('leads.edit', true);
    screen.setScope('leads', 'team');
    screen.save();

    const req = http.expectOne((r) => r.url.endsWith('/roles/sales') && r.method === 'PATCH');
    expect(req.request.body.permissions).toEqual(['leads.view', 'leads.edit']);
    expect(req.request.body.scopes.leads).toBe('team');
    req.flush({ success: true, data: { ...roles.data[1], permissions: ['leads.view', 'leads.edit'] } });

    http.expectOne((r) => r.url.endsWith('/roles/catalog')).flush(catalog);
    http.expectOne((r) => r.url.endsWith('/roles')).flush(roles);
    http.match((r) => r.url.endsWith('/auth/me'));
  });
});
