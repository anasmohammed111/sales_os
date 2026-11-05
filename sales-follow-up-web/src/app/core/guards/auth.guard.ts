import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // A super admin's read-only view has ended: back to the console
  if (authService.platformView()) {
    authService.exitPlatformView(null);
    return router.createUrlTree(['/platform']);
  }

  authService.logout();
  return router.createUrlTree(['/auth/login']);
};
