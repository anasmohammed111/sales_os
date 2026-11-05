import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { PlatformService } from '../core/services/platform.service';

/** Super admin sign-in. Separate from the workspace sign-in, and not linked from it. */
@Component({
  selector: 'kt-platform-login',
  imports: [FormsModule],
  template: `
    <main class="login">
      <form class="login-card" (ngSubmit)="submit()">
        <div class="brand">
          <img src="kelto-mark.svg" alt="" width="40" height="40" />
          <div>
            <strong>Kelto platform</strong>
            <span>Super admin</span>
          </div>
        </div>
        <h1>Sign in</h1>
        <label>
          Email
          <input class="pf-input" type="email" name="email" [(ngModel)]="email" autocomplete="username" required />
        </label>
        <label>
          Password
          <input class="pf-input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required />
        </label>
        @if (error()) {
          <p class="pf-error" role="alert">{{ error() }}</p>
        }
        <button class="pf-btn pf-btn--primary" type="submit" [disabled]="busy() || !email || !password">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </main>
  `,
  styleUrl: './platform.scss',
  styles: `
    .login { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(120% 80% at 50% 0%, #16213a, #0a1020 60%); }
    .login-card { display: grid; gap: 14px; width: min(400px, 100%); padding: 28px; border-radius: 18px; background: #fff; box-shadow: 0 40px 100px -30px rgba(0,0,0,.6); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand strong { display: block; font-size: 16px; }
    .brand span { color: #64748b; font-size: 13px; font-weight: 600; }
    h1 { margin: 6px 0 0; font-size: 22px; font-weight: 800; }
    label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; }
    .pf-input { width: 100%; }
    .pf-error { padding: 10px 12px; border-radius: 10px; background: #fef2f2; text-align: left; }
  `,
})
export class PlatformLogin {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  submit(): void {
    this.busy.set(true);
    this.error.set(null);
    this.platform.login(this.email.trim(), this.password).subscribe({
      next: () => {
        this.busy.set(false);
        this.router.navigate(['/platform']);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.password = '';
        this.error.set(err.error?.message || 'Sign-in failed. Try again.');
      },
    });
  }
}
