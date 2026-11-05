import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AdminApi } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';
import { AUTH_CARD_STYLES } from './login';

/** Change your password. Required at the first sign-in with a temporary password. */
@Component({
  selector: 'ka-change-password',
  imports: [FormsModule, RouterLink],
  template: `
    <form class="card" (ngSubmit)="submit()">
      <div class="brand">
        <img src="kelto-mark.svg" alt="" width="40" height="40" />
        <div><strong>Kelto admin</strong><span>{{ session.profile()?.email }}</span></div>
      </div>
      <h1>{{ forced ? 'Choose your own password' : 'Change password' }}</h1>
      @if (forced) {
        <p>You signed in with a temporary password. Choose your own before continuing.</p>
      }
      <label>Current password <input class="pf-input" type="password" name="current" [(ngModel)]="current" autocomplete="current-password" required /></label>
      <label>New password (at least 12 characters)
        <input class="pf-input" type="password" name="next" [(ngModel)]="next" autocomplete="new-password" required />
      </label>
      <label>Repeat new password <input class="pf-input" type="password" name="repeat" [(ngModel)]="repeat" autocomplete="new-password" required /></label>
      @if (error()) {
        <p class="pf-error" role="alert">{{ error() }}</p>
      }
      <button class="pf-btn pf-btn--primary" type="submit" [disabled]="busy() || next.length < 12 || next !== repeat || !current">
        {{ busy() ? 'Saving…' : 'Save password' }}
      </button>
      @if (!forced) {
        <a routerLink="/">Back</a>
      }
    </form>
  `,
  styles: AUTH_CARD_STYLES,
})
export class ChangePasswordPage {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);
  private readonly router = inject(Router);
  readonly forced = this.session.profile()?.mustChangePassword === true;

  current = '';
  next = '';
  repeat = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  submit(): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.changePassword(this.current, this.next).subscribe({
      next: ({ token, admin }) => {
        this.session.set(token, admin);
        this.router.navigate(['/']);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(err.error?.message || 'The password could not be changed.');
      },
    });
  }
}
