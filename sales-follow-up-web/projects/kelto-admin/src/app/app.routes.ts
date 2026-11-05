import { Routes } from '@angular/router';
import { allows, signedInGuard, tokenGuard } from './core/admin-guards';
import { AdminHome, AdminShell } from './shell/admin-shell';

export const ADMIN_ROUTES: Routes = [
  { path: 'login', title: 'Sign in | Kelto admin', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  {
    path: 'account/password',
    title: 'Change password | Kelto admin',
    canActivate: [tokenGuard],
    loadComponent: () => import('./pages/change-password').then((m) => m.ChangePasswordPage),
  },
  {
    path: '',
    component: AdminShell,
    canActivate: [signedInGuard],
    children: [
      { path: '', pathMatch: 'full', component: AdminHome },
      {
        path: 'dashboard',
        title: 'Overview | Kelto admin',
        canActivate: [allows('dashboard.view')],
        loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage),
      },
      {
        path: 'subscriptions',
        title: 'Subscriptions | Kelto admin',
        canActivate: [allows('subscriptions.view')],
        loadComponent: () => import('./pages/subscriptions').then((m) => m.SubscriptionsPage),
      },
      {
        path: 'plans',
        title: 'Plans | Kelto admin',
        canActivate: [allows('plans.view')],
        loadComponent: () => import('./pages/plans').then((m) => m.PlansPage),
      },
      {
        path: 'companies',
        title: 'Companies | Kelto admin',
        canActivate: [allows('companies.view')],
        loadComponent: () => import('./pages/companies').then((m) => m.CompaniesPage),
      },
      {
        path: 'companies/:id',
        title: 'Company | Kelto admin',
        canActivate: [allows('companies.view')],
        loadComponent: () => import('./pages/company-detail').then((m) => m.CompanyDetailPage),
      },
      {
        path: 'people',
        title: 'Company users | Kelto admin',
        canActivate: [allows('companies.view')],
        loadComponent: () => import('./pages/people').then((m) => m.PeoplePage),
      },
      {
        path: 'admins',
        title: 'Platform administrators | Kelto admin',
        canActivate: [allows('admins.view')],
        loadComponent: () => import('./pages/admins').then((m) => m.AdminsPage),
      },
      {
        path: 'support-sessions',
        title: 'Support sessions | Kelto admin',
        canActivate: [allows('sessions.view')],
        loadComponent: () => import('./pages/support-sessions').then((m) => m.SupportSessionsPage),
      },
      {
        path: 'audit',
        title: 'Audit log | Kelto admin',
        canActivate: [allows('audit.view')],
        loadComponent: () => import('./pages/audit').then((m) => m.AuditPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
