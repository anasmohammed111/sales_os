import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AdminSession } from './admin-session';

/** Adds the admin token; sends people to sign in or to change their password when the API says so. */
export const adminInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(AdminSession);
  const router = inject(Router);
  const token = session.token();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.endsWith('/auth/login')) {
        session.clear();
        router.navigate(['/login']);
      } else if (error.status === 403 && error.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
        router.navigate(['/account/password']);
      }
      return throwError(() => error);
    })
  );
};

/** Signed in, and no temporary password left to change. */
export const signedInGuard: CanActivateFn = () => {
  const session = inject(AdminSession);
  const router = inject(Router);
  if (!session.isSignedIn()) {
    session.clear();
    return router.createUrlTree(['/login']);
  }
  if (session.profile()?.mustChangePassword) return router.createUrlTree(['/account/password']);
  return true;
};

/** Signed in (a temporary password may still need changing). */
export const tokenGuard: CanActivateFn = () => {
  const session = inject(AdminSession);
  return session.isSignedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** The administrator's role must allow this page (the API checks again). */
export const allows =
  (permission: string): CanActivateFn =>
  () => {
    const session = inject(AdminSession);
    return session.can(permission) ? true : inject(Router).createUrlTree(['/']);
  };
