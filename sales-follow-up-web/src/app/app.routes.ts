import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { ownerGuard } from './core/guards/owner.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'leads',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'follow-ups',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'team',
    canActivate: [authGuard, ownerGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'pipeline',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'quotations',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    // SYB admissions: rendered inside the app shell's outlet
    path: 'admissions',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./dashboard/dashboard').then((m) => m.Dashboard),
    loadChildren: () =>
      import('./admissions/admissions.routes').then((m) => m.ADMISSIONS_ROUTES),
  },
  {
    path: 'auth',
    loadChildren: () =>
      import('./auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];

