import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { adminInterceptor } from './core/admin-guards';
import { ADMIN_ROUTES } from './app.routes';

export const adminConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(ADMIN_ROUTES, withComponentInputBinding()),
    provideHttpClient(withInterceptors([adminInterceptor])),
  ],
};
