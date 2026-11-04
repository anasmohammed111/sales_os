import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionService } from '../services/permission.service';

/**
 * Opens a page only when the person has at least one of the permissions;
 * otherwise sends them to the first page they may open.
 *
 *   canActivate: [authGuard, permissionGuard('team.view')]
 */
export const permissionGuard =
  (...permissions: string[]): CanActivateFn =>
  () => {
    const access = inject(PermissionService);
    const router = inject(Router);

    // Permissions not loaded yet (a session from before roles): let the page
    // load; the shell refreshes access and redirects if needed
    if (!access.loaded()) return true;
    if (access.canAny(...permissions)) return true;
    return router.createUrlTree([access.homePath()]);
  };
