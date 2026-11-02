import { Routes } from '@angular/router';
import { guestGuard } from '../core/guards/guest.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: '',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./layout/layout').then((m) => m.Layout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'login',
      },
      {
        path: 'login',
        loadComponent: () =>
          import('./login/login').then((m) => m.Login),
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./register/register').then((m) => m.Register),
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('./forgot-password/forgot-password').then(
            (m) => m.ForgotPassword
          ),
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('./reset-password/reset-password').then(
            (m) => m.ResetPassword
          ),
      },
    ],
  },
];

export default AUTH_ROUTES;