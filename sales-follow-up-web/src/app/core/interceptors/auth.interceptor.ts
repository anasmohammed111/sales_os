import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { PlatformService } from '../services/platform.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const permissions = inject(PermissionService);
  const platform = inject(PlatformService);

  // The super admin console has its own sign-in; workspace tokens never go there
  const isPlatformApi = req.url.includes('/api/platform/');
  const token = isPlatformApi ? platform.token() : authService.getToken();

  const authReq = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (isPlatformApi) {
        if (error.status === 401 && !req.url.includes('/platform/auth/login')) platform.signOut();
        return throwError(() => error);
      }
      // Redirect to login if token is expired or unauthorized
      // (a super admin's expired view goes back to the console instead)
      if (
        error.status === 401 &&
        !req.url.includes('/auth/login') &&
        !req.url.includes('/auth/google')
      ) {
        authService.logout();
      }
      // The person's role changed since the app loaded: show what they may do now.
      // READ_ONLY (a super admin's view) is not a role change: nothing to refresh.
      if (error.status === 403 && error.error?.code === 'PERMISSION_DENIED') {
        permissions.refresh();
      }
      return throwError(() => error);
    })
  );
};
