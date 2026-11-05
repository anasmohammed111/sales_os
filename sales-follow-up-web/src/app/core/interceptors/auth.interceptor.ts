import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const permissions = inject(PermissionService);
  const router = inject(Router);
  const token = authService.getToken();

  const authReq = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const code = error.error?.code;
      // A Kelto support session ended (exit, revoked, expired, owner withdrew permission)
      if (code === 'SUPPORT_SESSION_ENDED' && authService.supportSession()) {
        authService.exitSupportSession();
        return throwError(() => error);
      }
      // The company was suspended: sign out and say why on the sign-in page
      if (error.status === 403 && code === 'COMPANY_SUSPENDED') {
        authService.logout();
        router.navigate(['/auth/login'], { queryParams: { suspended: 1 } });
        return throwError(() => error);
      }
      // Redirect to login if token is expired or unauthorized
      if (
        error.status === 401 &&
        !req.url.includes('/auth/login') &&
        !req.url.includes('/auth/google') &&
        !req.url.includes('/support/exchange')
      ) {
        authService.logout();
      }
      // The person's role changed since the app loaded: show what they may do now.
      // READ_ONLY (a support session) is not a role change: nothing to refresh.
      if (error.status === 403 && code === 'PERMISSION_DENIED') {
        permissions.refresh();
      }
      return throwError(() => error);
    })
  );
};
