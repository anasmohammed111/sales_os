import { Routes } from '@angular/router';
import { ownerGuard } from '../core/guards/owner.guard';

export const ADMISSIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/admissions-layout').then((m) => m.AdmissionsLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        title: 'Admissions overview',
        loadComponent: () => import('./overview/overview').then((m) => m.Overview),
      },
      {
        path: 'pipeline',
        title: 'Admissions pipeline',
        loadComponent: () => import('./pipeline-board/pipeline-board').then((m) => m.PipelineBoard),
      },
      {
        path: 'students',
        title: 'Students',
        loadComponent: () => import('./students/students').then((m) => m.Students),
      },
      {
        path: 'students/:id',
        title: 'Student',
        loadComponent: () => import('./student-profile/student-profile').then((m) => m.StudentProfile),
      },
      {
        path: 'tasks',
        title: 'My tasks',
        loadComponent: () => import('./my-tasks/my-tasks').then((m) => m.MyTasks),
      },
      {
        path: 'payments',
        title: 'Payments',
        loadComponent: () => import('./payment-tracker/payment-tracker').then((m) => m.PaymentTracker),
      },
      {
        path: 'settings',
        title: 'Admissions settings',
        canActivate: [ownerGuard],
        loadComponent: () => import('./settings/settings').then((m) => m.Settings),
      },
    ],
  },
];

export default ADMISSIONS_ROUTES;
