import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, AuditEntry, Company, Paged } from '../core/admin-api';
import { MODE_LABEL } from './support-sessions';

const ACTIONS: Record<string, { label: string; tone: string }> = {
  LOGIN: { label: 'Signed in', tone: 'on' },
  LOGIN_FAILED: { label: 'Failed sign-in', tone: 'bad' },
  PASSWORD_CHANGED: { label: 'Changed password', tone: '' },
  VIEW_WORKSPACE: { label: 'Opened company (old view)', tone: 'warn' },
  FEATURE_CHANGED: { label: 'Changed a module', tone: '' },
  COMPANY_SUSPENDED: { label: 'Suspended company', tone: 'bad' },
  COMPANY_REACTIVATED: { label: 'Reactivated company', tone: 'on' },
  SUPPORT_SESSION_STARTED: { label: 'Started support session', tone: 'warn' },
  SUPPORT_SESSION_ENDED: { label: 'Ended support session', tone: '' },
  SUPPORT_SESSION_REVOKED: { label: 'Revoked support session', tone: 'bad' },
  SUPPORT_ACTION: { label: 'Support change', tone: 'warn' },
  SUPPORT_ACCESS_CHANGED: { label: 'Owner changed support access', tone: '' },
  ADMIN_CREATED: { label: 'Added administrator', tone: '' },
  ADMIN_UPDATED: { label: 'Changed administrator', tone: '' },
  ADMIN_PASSWORD_RESET: { label: 'Reset administrator password', tone: 'warn' },
  ADMIN_SESSIONS_REVOKED: { label: 'Signed administrator out', tone: 'warn' },
  PLAN_CREATED: { label: 'Created SaaS plan', tone: 'on' },
  PLAN_UPDATED: { label: 'Updated SaaS plan', tone: '' },
  SUBSCRIPTION_CREATED: { label: 'Assigned subscription', tone: 'on' },
  SUBSCRIPTION_UPDATED: { label: 'Updated subscription', tone: 'warn' },
};

/** Everything Kelto staff did. Companies never see this. */
@Component({
  selector: 'ka-audit',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Audit log</h1>
          <p>Sign-ins, company changes, support sessions and every change made during support edits.</p>
        </div>
      </div>
      <div class="pf-card">
        <div class="pf-card-head">
          <h2>{{ result()?.total ?? 0 }} entries</h2>
          <span class="filters">
            <select class="pf-select" aria-label="Company" [(ngModel)]="businessId" (ngModelChange)="go(1)">
              <option value="">All companies</option>
              @for (c of companies(); track c.id) {
                <option [value]="c.id">{{ c.businessName }}</option>
              }
            </select>
            <select class="pf-select" aria-label="Action" [(ngModel)]="action" (ngModelChange)="go(1)">
              <option value="">All actions</option>
              @for (a of actionKeys; track a) {
                <option [value]="a">{{ actions[a].label }}</option>
              }
            </select>
          </span>
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
                  <tr><th>When</th><th>Who</th><th>What</th><th>Company</th><th>Details</th><th>IP</th></tr>
                </thead>
                <tbody>
                  @for (e of r.items; track e.id) {
                    <tr>
                      <td>{{ e.createdAt | date: 'd MMM y, HH:mm:ss' }}</td>
                      <td>{{ who(e) }}<small>{{ e.admin?.email ?? '' }}</small></td>
                      <td><span class="pf-chip" [class]="'pf-chip pf-chip--' + (actions[e.action]?.tone || 'none')">{{ actions[e.action]?.label ?? e.action }}</span></td>
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
  styles: `.filters { display: flex; flex-wrap: wrap; gap: 8px; }`,
})
export class AuditPage implements OnInit {
  private readonly api = inject(AdminApi);

  readonly actions = ACTIONS;
  readonly actionKeys = Object.keys(ACTIONS);
  businessId = '';
  action = '';
  readonly companies = signal<Company[]>([]);
  readonly result = signal<Paged<AuditEntry> | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.companies().subscribe({ next: ({ items }) => this.companies.set(items), error: () => undefined });
    this.go(1);
  }

  pages(r: Paged<AuditEntry>): number {
    return Math.max(1, Math.ceil(r.total / r.limit));
  }

  who(e: AuditEntry): string {
    if (e.admin) return e.admin.name;
    if (e.action === 'SUPPORT_ACCESS_CHANGED') return `${(e.details['byName'] as string) ?? 'Owner'} (company owner)`;
    return 'Unknown';
  }

  describe(e: AuditEntry): string {
    const d = e.details || {};
    switch (e.action) {
      case 'FEATURE_CHANGED':
        return `${d['feature']} turned ${d['to'] ? 'on' : 'off'}`;
      case 'COMPANY_SUSPENDED':
      case 'COMPANY_REACTIVATED':
        return `"${e.reason}"`;
      case 'SUPPORT_SESSION_STARTED':
        return `${MODE_LABEL[d['mode'] as string] ?? d['mode']} · "${e.reason}"`;
      case 'SUPPORT_SESSION_ENDED':
      case 'SUPPORT_SESSION_REVOKED':
        return e.reason;
      case 'SUPPORT_ACTION':
        return `${d['method']} ${d['path']} → ${d['status']}`;
      case 'SUPPORT_ACCESS_CHANGED':
        return d['hours'] ? `Allowed support changes for ${d['hours']} hours` : 'Withdrew support changes';
      case 'LOGIN_FAILED':
        return `${d['why'] ?? 'failed'}${d['locked'] ? ' · account locked for 15 minutes' : ''}`;
      case 'ADMIN_CREATED':
        return `${e.targetAdmin?.name ?? ''} as ${d['role']}`;
      case 'ADMIN_UPDATED':
      case 'ADMIN_PASSWORD_RESET':
      case 'ADMIN_SESSIONS_REVOKED':
        return e.targetAdmin?.name ?? '';
      case 'PLAN_CREATED':
        return `${d['name']} (${d['key']})`;
      case 'PLAN_UPDATED':
        return String(d['key'] ?? '');
      case 'SUBSCRIPTION_CREATED':
      case 'SUBSCRIPTION_UPDATED':
        return `${d['toPlanKey']} · ${d['toStatus']} · "${e.reason}"`;
      case 'VIEW_WORKSPACE':
        return `"${e.reason}"`;
      default:
        return '';
    }
  }

  go(page: number): void {
    this.api.audit({ businessId: this.businessId, action: this.action, page }).subscribe({
      next: (r) => {
        this.result.set(r);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'The audit log could not load.'),
    });
  }
}
