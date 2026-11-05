import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { AdminApi } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

export const AUTH_CARD_STYLES = `
  :host { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(120% 80% at 50% 0%, #16213a, #0a1020 60%); }
  .card { display: grid; gap: 14px; width: min(400px, 100%); padding: 28px; border-radius: 18px; background: #fff; box-shadow: 0 40px 100px -30px rgba(0,0,0,.6); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand strong { display: block; font-size: 16px; }
  .brand span { color: #64748b; font-size: 13px; font-weight: 600; }
  h1 { margin: 6px 0 0; font-size: 22px; font-weight: 800; }
  p { margin: 0; color: #475569; font-size: 14px; line-height: 1.5; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; }
  .pf-input { width: 100%; }
  .pf-error { padding: 10px 12px; border-radius: 10px; background: #fef2f2; text-align: left; }
`;

/** Kelto admin sign-in (Kelto staff only; workspace users sign in to the CRM). */
@Component({
  selector: 'ka-login',
  imports: [FormsModule],
  template: `
    <form class="card" (ngSubmit)="submit()">
      <div class="brand">
        <img src="kelto-mark.svg" alt="" width="40" height="40" />
        <div><strong>Kelto admin</strong><span>Platform administration</span></div>
      </div>
      <h1>Sign in</h1>
      <label>Email <input class="pf-input" type="email" name="email" [(ngModel)]="email" autocomplete="username" required /></label>
      <label>Password <input class="pf-input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required /></label>
      @if (error()) {
        <p class="pf-error" role="alert">{{ error() }}</p>
      }
      <button class="pf-btn pf-btn--primary" type="submit" [disabled]="busy() || !email || !password">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  `,
  styles: AUTH_CARD_STYLES,
})
export class LoginPage {
  private readonly api = inject(AdminApi);
  private readonly session = inject(AdminSession);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  submit(): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.login(this.email.trim(), this.password).subscribe({
      next: ({ token, admin }) => {
        this.busy.set(false);
        this.session.set(token, admin);
        this.router.navigate([admin.mustChangePassword ? '/account/password' : '/']);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.password = '';
        this.error.set(err.error?.message || 'Sign-in failed. Try again.');
      },
    });
  }
}
