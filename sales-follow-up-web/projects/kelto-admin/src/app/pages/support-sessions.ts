import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, Paged, SupportSession } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

export const MODE_LABEL: Record<string, string> = {
  VIEW_OWNER: 'View as owner',
  VIEW_USER: 'View as person',
  SUPPORT_EDIT: 'Support edit',
};

/** Support sessions: who is (or was) inside which company, why, and until when. */
@Component({
  selector: 'ka-support-sessions',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Support sessions</h1>
          <p>Every visit by Kelto staff to a company's workspace. Ending a session takes effect at once.</p>
        </div>
      </div>
      <div class="pf-card">
        <div class="pf-card-head">
          <h2>{{ result()?.total ?? 0 }} sessions</h2>
          <select class="pf-select" aria-label="Status" [(ngModel)]="status" (ngModelChange)="go(1)">
            <option value="ACTIVE">Active now</option>
            <option value="">All</option>
            <option value="ENDED">Ended</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </div>
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else if (result(); as r) {
          @if (!r.items.length) {
            <p class="pf-empty">No sessions.</p>
          } @else {
            <div class="pf-scroll">
              <table class="pf-table">
                <thead>
                  <tr><th>Started</th><th>Administrator</th><th>Company</th><th>Mode</th><th>Reason</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  @for (s of r.items; track s.id) {
                    <tr>
                      <td>{{ s.startedAt | date: 'd MMM, HH:mm' }}<small>until {{ s.expiresAt | date: 'HH:mm' }}</small></td>
                      <td>{{ s.admin?.name ?? '—' }}</td>
                      <td>{{ s.workspace?.businessName ?? '—' }}</td>
                      <td>
                        {{ modeLabel[s.mode] }}
                        @if (s.targetUser) {
                          <small>as {{ s.targetUser.name }}</small>
                        }
                        @if (s.mode === 'SUPPORT_EDIT') {
                          <small>{{ s.writeCount }} change{{ s.writeCount === 1 ? '' : 's' }}</small>
                        }
                      </td>
                      <td>{{ s.reason }}</td>
                      <td>
                        <span class="pf-chip" [class.pf-chip--on]="s.status === 'ACTIVE'" [class.pf-chip--bad]="s.status === 'REVOKED'">{{ statusLabel(s) }}</span>
                        @if (s.endReason) {
                          <small>{{ s.endReason }}</small>
                        }
                      </td>
                      <td class="actions">
                        @if (s.status === 'ACTIVE' && canEnd(s)) {
                          <button type="button" class="pf-btn pf-btn--sm" (click)="end(s)">End now</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="pf-pager">
              <span>Page {{ r.page }} of {{ pages(r) }}</span>
              <span>
                <button type="button" class="pf-btn pf-btn--sm" [disabled]="r.page <= 1" (click)="go(r.page - 1)">Previous</button>
                <button type="button" class="pf-btn pf-btn--sm" [disabled]="r.page >= pages(r)" (click)="go(r.page + 1)">Next</button>
              </span>
            </div>
          }
        } @else {
          <p class="pf-empty">Loading…</p>
        }
      </div>
    </section>
  `,
})
export class SupportSessionsPage implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);

  status = 'ACTIVE';
  readonly modeLabel = MODE_LABEL;
  readonly result = signal<Paged<SupportSession> | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.go(1);
  }

  pages(r: Paged<SupportSession>): number {
    return Math.max(1, Math.ceil(r.total / r.limit));
  }

  statusLabel(s: SupportSession): string {
    return { ACTIVE: 'Active', ENDED: 'Ended', REVOKED: 'Revoked', EXPIRED: 'Expired' }[s.status];
  }

  canEnd(s: SupportSession): boolean {
    return s.admin?.id === this.session.profile()?.id || this.session.can('sessions.revoke');
  }

  end(s: SupportSession): void {
    const own = s.admin?.id === this.session.profile()?.id;
    const reason = own ? 'Ended by the administrator' : prompt(`Why end ${s.admin?.name}'s session? (recorded in the audit log)`);
    if (!reason) return;
    this.api.revokeSupportSession(s.id, reason).subscribe({
      next: () => this.go(this.result()?.page ?? 1),
      error: (err: HttpErrorResponse) => alert(err.error?.message || 'The session could not be ended.'),
    });
  }

  go(page: number): void {
    this.api.supportSessions(this.status, '', page).subscribe({
      next: (r) => {
        this.result.set(r);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'Sessions could not load.'),
    });
  }
}
