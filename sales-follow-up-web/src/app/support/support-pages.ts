import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { environment } from '../../environments/environment';

const PAGE_STYLES = `
  :host { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f8fafc; }
  .card { display: grid; gap: 12px; width: min(440px, 100%); padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; text-align: center; }
  img { justify-self: center; }
  h1 { margin: 0; font-size: 20px; font-weight: 800; color: #0f172a; }
  p { margin: 0; color: #475569; font-size: 14px; line-height: 1.5; }
  .error { color: #b91c1c; }
  a { color: var(--kelto-brand-600, #cc4626); font-weight: 700; }
`;

/**
 * /support/enter?code=… — where the Kelto admin app sends a support
 * administrator. Exchanges the single-use code, then opens the workspace.
 */
@Component({
  selector: 'kt-support-enter',
  template: `
    <div class="card" role="status">
      <img src="kelto-mark.svg" alt="" width="40" height="40" />
      @if (error()) {
        <h1>Support session not started</h1>
        <p class="error">{{ error() }}</p>
        <p>Start a new session from the Kelto admin app.</p>
      } @else {
        <h1>Opening the workspace…</h1>
        <p>Starting a Kelto support session.</p>
      }
    </div>
  `,
  styles: PAGE_STYLES,
})
export class SupportEnter implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    // Keep the code out of the address bar and history
    if (typeof history !== 'undefined') history.replaceState(null, '', '/support/enter');
    if (!code) {
      this.error.set('This link has no support code.');
      return;
    }
    this.auth.beginSupportSession(code).subscribe({
      // A full load so the app starts fresh inside the workspace
      next: (landing) => window.location.replace(landing),
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'The support link could not be used.'),
    });
  }
}

/** /support/ended — shown after a support session ends, expires or is revoked. */
@Component({
  selector: 'kt-support-ended',
  template: `
    <div class="card">
      <img src="kelto-mark.svg" alt="" width="40" height="40" />
      <h1>Support session ended</h1>
      <p>This Kelto support session is over. You can close this tab.</p>
      @if (adminUrl) {
        <p><a [href]="adminUrl">Back to the Kelto admin app</a></p>
      }
    </div>
  `,
  styles: PAGE_STYLES,
})
export class SupportEnded {
  readonly adminUrl = environment.adminUrl;
}

/** /platform/** — the admin console moved to its own app. */
@Component({
  selector: 'kt-admin-moved',
  template: `
    <div class="card">
      <img src="kelto-mark.svg" alt="" width="40" height="40" />
      <h1>The Kelto admin app has moved</h1>
      @if (adminUrl) {
        <p>Opening it now… <a [href]="adminUrl">Open the admin app</a></p>
      } @else {
        <p>The admin console is now a separate app with its own address.</p>
      }
    </div>
  `,
  styles: PAGE_STYLES,
})
export class AdminMoved implements OnInit {
  readonly adminUrl = environment.adminUrl;

  ngOnInit(): void {
    if (this.adminUrl) window.location.replace(this.adminUrl);
  }
}
