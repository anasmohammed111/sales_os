import { bootstrapApplication } from '@angular/platform-browser';
import { AdminApp } from './app/app';
import { adminConfig } from './app/app.config';

bootstrapApplication(AdminApp, adminConfig).catch((err) => console.error(err));
