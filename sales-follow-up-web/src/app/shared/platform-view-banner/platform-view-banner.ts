import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

/** Stays on screen while a platform super admin is looking at a workspace read-only. */
@Component({
  selector: 'kt-platform-view-banner',
  imports: [DatePipe],
  template: `
    @if (auth.platformView(); as view) {
      <div class="banner" role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        <span>
          Viewing <strong>{{ view.businessName }}</strong> as super admin · <strong>read-only</strong>
          <small>· until {{ view.expiresAt | date: 'HH:mm' }}</small>
        </span>
        <button type="button" (click)="auth.exitPlatformView()">Exit</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; position: sticky; top: 0; z-index: 60; }
    .banner { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; padding: 10px 14px; border: 1px solid #fdba74;
      border-radius: 12px; background: #fff7ed; color: #9a3412; font-size: 14px; box-shadow: 0 8px 20px -14px rgba(154, 52, 18, 0.5); }
    .banner span { flex: 1; }
    .banner small { color: #c2410c; font-size: 13px; }
    .banner button { padding: 6px 14px; border: 1px solid #ea580c; border-radius: 9px; background: #ea580c; color: #fff;
      font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .banner button:hover { background: #c2410c; }
  `,
})
export class PlatformViewBanner {
  readonly auth = inject(AuthService);
}
