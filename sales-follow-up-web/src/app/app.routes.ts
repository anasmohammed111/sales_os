import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'dashboard',
    title: 'Dashboard | Kelto',
    canActivate: [authGuard, permissionGuard('dashboard.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'leads',
    title: 'Leads | Kelto',
    canActivate: [authGuard, permissionGuard('leads.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'follow-ups',
    title: 'Follow-ups | Kelto',
    canActivate: [authGuard, permissionGuard('followups.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'reports',
    title: 'Reports | Kelto',
    canActivate: [authGuard, permissionGuard('reports.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'team',
    title: 'Team | Kelto',
    canActivate: [authGuard, permissionGuard('team.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'pipeline',
    title: 'Sales pipeline | Kelto',
    canActivate: [authGuard, permissionGuard('pipeline.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'quotations',
    title: 'Quotations | Kelto',
    canActivate: [authGuard, permissionGuard('quotations.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'settings',
    title: 'Settings | Kelto',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'settings/roles',
    title: 'Roles & permissions | Kelto',
    canActivate: [authGuard, permissionGuard('settings.roles')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    // SYB admissions: rendered inside the app shell's outlet
    path: 'admissions',
    title: 'Admissions | Kelto',
    canActivate: [authGuard, permissionGuard('admissions.view')],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
    children: [
      {
        path: '',
        loadChildren: () =>
          import('./admissions/admissions.routes').then((m) => m.ADMISSIONS_ROUTES),
      },
    ],
  },
  {
    // Kelto support sessions opened from the admin app
    path: 'support/enter',
    title: 'Kelto support | Kelto',
    loadComponent: () => import('./support/support-pages').then((m) => m.SupportEnter),
  },
  {
    path: 'support/ended',
    title: 'Support session ended | Kelto',
    loadComponent: () => import('./support/support-pages').then((m) => m.SupportEnded),
  },
  {
    // The admin console is a separate app now (projects/kelto-admin)
    path: 'platform',
    children: [
      { path: '', loadComponent: () => import('./support/support-pages').then((m) => m.AdminMoved) },
      { path: '**', loadComponent: () => import('./support/support-pages').then((m) => m.AdminMoved) },
    ],
  },
  {
    path: 'auth',
    title: 'Account | Kelto',
    loadChildren: () =>
      import('./auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
