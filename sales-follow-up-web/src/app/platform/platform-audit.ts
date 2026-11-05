import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AuditEntry, Paged, PlatformService, WorkspaceSummary } from '../core/services/platform.service';

const ACTIONS: Record<AuditEntry['action'], { label: string; tone: '' | 'on' | 'warn' | 'bad' }> = {
  LOGIN: { label: 'Signed in', tone: 'on' },
  LOGIN_FAILED: { label: 'Failed sign-in', tone: 'bad' },
  VIEW_WORKSPACE: { label: 'Opened workspace', tone: 'warn' },
  FEATURE_CHANGED: { label: 'Changed a module', tone: '' },
};

/** Everything super admins did: sign-ins, workspace visits and module changes. */
@Component({
  selector: 'kt-platform-audit',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Audit log</h1>
          <p>Every super admin sign-in, workspace visit and module change. Workspaces never see this.</p>
        </div>
      </div>
      <div class="pf-card">
        <div class="pf-card-head">
          <h2>{{ result()?.total ?? 0 }} entries</h2>
          <select class="pf-select" aria-label="Workspace" [(ngModel)]="businessId" (ngModelChange)="go(1)">
            <option value="">All workspaces</option>
            @for (w of workspaces(); track w.id) {
              <option [value]="w.id">{{ w.businessName }}</option>
            }
          </select>
        </div>
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else if (result(); as r) {
          @if (!r.items.length) {
            <p class="pf-empty">Nothing recorded yet.</p>
          } @else {
            <div class="pf-scroll">
              <table class="pf-table">
                <thead>
                  <tr><th>When</th><th>Who</th><th>What</th><th>Workspace</th><th>Details</th><th>IP</th></tr>
                </thead>
                <tbody>
                  @for (e of r.items; track e.id) {
                    <tr>
                      <td>{{ e.createdAt | date: 'd MMM y, HH:mm:ss' }}</td>
                      <td>{{ e.admin?.name ?? 'Unknown' }}<small>{{ e.admin?.email ?? e.details['email'] }}</small></td>
                      <td><span class="pf-chip" [class]="'pf-chip' + (actions[e.action].tone ? ' pf-chip--' + actions[e.action].tone : '')">{{ actions[e.action].label }}</span></td>
                      <td>{{ e.workspace?.businessName ?? '—' }}</td>
                      <td>{{ describe(e) }}</td>
                      <td><small>{{ e.ip || '—' }}</small></td>
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
  styleUrl: './platform.scss',
})
export class PlatformAudit implements OnInit {
  private readonly platform = inject(PlatformService);

  readonly actions = ACTIONS;
  businessId = '';
  readonly workspaces = signal<WorkspaceSummary[]>([]);
  readonly result = signal<Paged<AuditEntry> | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.platform.workspaces().subscribe({ next: ({ items }) => this.workspaces.set(items) });
    this.go(1);
  }

  pages(r: Paged<AuditEntry>): number {
    return Math.max(1, Math.ceil(r.total / r.limit));
  }

  describe(e: AuditEntry): string {
    const d = e.details || {};
    switch (e.action) {
      case 'VIEW_WORKSPACE':
        return `"${e.reason}"${d['firstPath'] ? ` · started at ${d['firstPath']}` : ''}`;
      case 'FEATURE_CHANGED':
        return `${d['feature']} turned ${d['to'] ? 'on' : 'off'}`;
      case 'LOGIN_FAILED':
        return `${d['why'] ?? 'failed'}${d['locked'] ? ' · account locked for 15 minutes' : ''}`;
      default:
        return '';
    }
  }

  go(page: number): void {
    this.platform.audit(this.businessId, page).subscribe({
      next: (r) => {
        this.result.set(r);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'The audit log could not load.'),
    });
  }
}
