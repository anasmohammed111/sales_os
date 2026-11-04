import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const permissions = inject(PermissionService);
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
      // Redirect to login if token is expired or unauthorized
      if (
        error.status === 401 &&
        !req.url.includes('/auth/login') &&
        !req.url.includes('/auth/google')
      ) {
        authService.logout();
      }
      // The person's role changed since the app loaded: show what they may do now
      if (error.status === 403 && error.error?.code === 'PERMISSION_DENIED') {
        permissions.refresh();
      }
      return throwError(() => error);
    })
  );
};


