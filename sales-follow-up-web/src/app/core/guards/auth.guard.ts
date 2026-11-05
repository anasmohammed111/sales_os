import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // A Kelto support session has expired
  if (authService.supportSession()) {
    authService.exitSupportSession(null);
    return router.createUrlTree(['/support/ended']);
  }

  authService.logout();
  return router.createUrlTree(['/auth/login']);
};
