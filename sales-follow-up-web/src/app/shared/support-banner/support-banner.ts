import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

const MODES = {
  VIEW_OWNER: 'Read-only',
  VIEW_USER: 'Read-only',
  SUPPORT_EDIT: 'Support edit',
} as const;

/** Stays on screen for the whole of a Kelto support session. */
@Component({
  selector: 'kt-support-banner',
  imports: [DatePipe],
  template: `
    @if (auth.supportSession(); as s) {
      <div class="banner" [class.is-edit]="s.mode === 'SUPPORT_EDIT'" role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        <span class="text">
          <strong>Kelto Support Session</strong> — Viewing <strong>{{ s.businessName }}</strong> as <strong>{{ viewer() }}</strong>
          <span class="meta">{{ modes[s.mode] }} · {{ s.adminName }} · until {{ s.expiresAt | date: 'HH:mm' }}</span>
        </span>
        <button type="button" (click)="auth.exitSupportSession()">Exit</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; position: sticky; top: 0; z-index: 60; }
    .banner { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; padding: 10px 14px; border: 1px solid #fdba74;
      border-radius: 12px; background: #fff7ed; color: #9a3412; font-size: 14px; box-shadow: 0 8px 20px -14px rgba(154, 52, 18, 0.5); }
    .banner.is-edit { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
    .text { flex: 1; }
    .meta { display: block; font-size: 12.5px; opacity: 0.85; }
    button { padding: 6px 14px; border: 0; border-radius: 9px; background: #ea580c; color: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .is-edit button { background: #dc2626; }
  `,
})
export class SupportBanner {
  readonly auth = inject(AuthService);
  readonly modes = MODES;
  readonly viewer = computed(() => {
    const s = this.auth.supportSession();
    if (!s) return '';
    if (s.mode === 'SUPPORT_EDIT') return 'Kelto support (editing)';
    return s.targetUserName || 'the owner';
  });
}
