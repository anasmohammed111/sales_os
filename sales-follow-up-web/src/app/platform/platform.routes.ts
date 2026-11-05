import { Routes } from '@angular/router';
import { platformGuard } from '../core/guards/platform.guard';

/** The super admin console (/platform). Its own sign-in; not linked from the workspace app. */
export const PLATFORM_ROUTES: Routes = [
  {
    path: 'login',
    title: 'Super admin sign-in | Kelto',
    loadComponent: () => import('./platform-login').then((m) => m.PlatformLogin),
  },
  {
    path: '',
    canActivate: [platformGuard],
    loadComponent: () => import('./platform-shell').then((m) => m.PlatformShell),
    children: [
      {
        path: '',
        title: 'Workspaces | Kelto platform',
        loadComponent: () => import('./platform-workspaces').then((m) => m.PlatformWorkspaces),
      },
      {
        path: 'workspaces/:id',
        title: 'Workspace | Kelto platform',
        loadComponent: () => import('./platform-workspace').then((m) => m.PlatformWorkspace),
      },
      {
        path: 'users',
        title: 'People | Kelto platform',
        loadComponent: () => import('./platform-users').then((m) => m.PlatformUsers),
      },
      {
        path: 'audit',
        title: 'Audit log | Kelto platform',
        loadComponent: () => import('./platform-audit').then((m) => m.PlatformAudit),
      },
    ],
  },
];
