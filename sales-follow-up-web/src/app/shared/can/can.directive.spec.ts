import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthService, UserAccess } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { permissionGuard } from '../../core/guards/permission.guard';
import { CanDirective } from './can.directive';

@Component({
  imports: [CanDirective],
  template: `
    <button id="add" *ktCan="'leads.create'">Add</button>
    <button id="any" *ktCan="['team.edit', 'leads.edit']">Any</button>
    <button id="all" *ktCan="['admissions.create', 'leads.edit']; all: true">All</button>
    <span id="main" *ktCan="'leads.archive'; else readOnly">Archive</span>
    <ng-template #readOnly><span id="fallback">Read only</span></ng-template>
  `,
})
class Host {}

const access = (permissions: string[], scopes: UserAccess['scopes'] = {}): UserAccess => ({
  roleId: 'r1',
  roleKey: null,
  roleName: 'Tester',
  isOwner: false,
  permissions,
  scopes,
});

describe('Permissions in the app', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  const render = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, has: (id: string) => !!el.querySelector(`#${id}`) };
  };

  it('*ktCan shows only what the role allows, and updates when the role changes', () => {
    auth.access.set(access(['leads.view', 'leads.edit']));
    const { fixture, has } = render();
    expect(has('add')).toBe(false);
    expect(has('any')).toBe(true);
    expect(has('all')).toBe(false);
    expect(has('main')).toBe(false);
    expect(has('fallback')).toBe(true);

    auth.access.set(access(['leads.create', 'leads.edit', 'leads.archive', 'admissions.create']));
    fixture.detectChanges();
    expect(has('add')).toBe(true);
    expect(has('all')).toBe(true);
    expect(has('main')).toBe(true);
    expect(has('fallback')).toBe(false);
  });

  it('the guard lets people in, or sends them to the first page they may open', () => {
    const router = TestBed.inject(Router);
    const run = (perm: string) =>
      TestBed.runInInjectionContext(() => permissionGuard(perm)({} as never, {} as never));

    auth.access.set(access(['leads.view', 'followups.view']));
    expect(run('leads.view')).toBe(true);
    const redirect = run('team.view') as UrlTree;
    expect(router.serializeUrl(redirect)).toBe('/leads');

    auth.access.set(access([]));
    expect(router.serializeUrl(run('reports.view') as UrlTree)).toBe('/settings');
  });

  it('knows the data scope per module', () => {
    auth.access.set(access(['leads.view'], { leads: 'team' }));
    const permissions = TestBed.inject(PermissionService);
    expect(permissions.scope('leads')).toBe('team');
    expect(permissions.scope('admissions')).toBe('own');
  });
});
