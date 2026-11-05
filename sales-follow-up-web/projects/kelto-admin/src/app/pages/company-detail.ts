import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, CompanyDetail, CompanyUser, SubscriptionStatus, SupportMode } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';
import { SupportDialog } from './support-dialog';
import { STATUS_LABEL, STATUS_TONE } from './companies';

const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = { TRIALING: 'Trialing', ACTIVE: 'Active', PAST_DUE: 'Past due', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };

/** One company: status, modules, support access and its people. */
@Component({
  selector: 'ka-company-detail',
  imports: [FormsModule, DatePipe, DecimalPipe, RouterLink, SupportDialog],
  template: `
    <section class="pf-page">
      <a class="pf-back" routerLink="/companies">← All companies</a>

      @if (error()) {
        <p class="pf-error">{{ error() }}</p>
      } @else if (company(); as c) {
        <div class="pf-head">
          <div>
            <h1>{{ c.businessName }} <span class="pf-chip" [class]="'pf-chip pf-chip--' + tone[c.status]">{{ label[c.status] }}</span></h1>
            <p>{{ c.email || 'No email' }} · created {{ c.createdAt | date: 'd MMM y' }} · last activity
              {{ c.lastActivityAt ? (c.lastActivityAt | date: 'd MMM y, HH:mm') : 'none yet' }}</p>
          </div>
          @if (session.can('support.view')) {
            <button type="button" class="pf-btn pf-btn--primary" (click)="openSupport('VIEW_OWNER')">Open as support…</button>
          }
        </div>

        @if (c.status !== 'ACTIVE') {
          <p class="pf-note pf-note--bad">
            Suspended {{ c.statusChangedAt ? 'on ' + (c.statusChangedAt | date: 'd MMM y, HH:mm') : '' }}: {{ c.statusReason || 'no reason recorded' }}.
            Nobody in this company can use Kelto until it is reactivated; their data is kept.
          </p>
        }

        <dl class="pf-tiles">
          <div><dt>People</dt><dd>{{ c.counts.activeUsers }} <small class="of">of {{ c.counts.users }}</small></dd></div>
          <div><dt>Leads</dt><dd>{{ c.counts.leads | number }}</dd></div>
          <div><dt>Active students</dt><dd>{{ c.counts.activeStudents }} <small class="of">of {{ c.counts.students }}</small></dd></div>
        </dl>

        <div class="cards">
          <div class="pf-card subscription-card">
            <div class="pf-card-head"><h2>Subscription</h2>@if (session.can('subscriptions.manage')) { <a class="manage-link" routerLink="/subscriptions" [queryParams]="{ company: c.id }">Manage</a> }</div>
            <div class="pf-card-body">
              @if (c.subscription; as subscription) {
                <div class="subscription-title"><div><strong>{{ subscription.planName }}</strong><small>{{ subscription.billingCycle === 'MONTHLY' ? 'Monthly billing' : 'Annual billing' }}</small></div><span [class]="'sub-chip sub-chip--' + subscription.status.toLowerCase()">{{ subscriptionLabel[subscription.status] }}</span></div>
                <dl class="subscription-meta"><div><dt>Price</dt><dd>{{ money(subscription.amountMinor, subscription.currency) }}</dd></div><div><dt>{{ subscription.status === 'TRIALING' ? 'Trial ends' : 'Period ends' }}</dt><dd>{{ (subscription.status === 'TRIALING' ? subscription.trialEndsAt : subscription.currentPeriodEnd) | date: 'd MMM y' }}</dd></div></dl>
                @if (subscription.cancelAtPeriodEnd) { <p class="pf-note pf-note--warn">Cancellation is scheduled at the end of this period.</p> }
              } @else {
                <p class="hint">No SaaS plan has been assigned to this company.</p>
                @if (session.can('subscriptions.manage')) { <a class="pf-btn pf-btn--primary pf-btn--sm" routerLink="/subscriptions" [queryParams]="{ company: c.id }">Assign subscription</a> }
              }
            </div>
          </div>

          <div class="pf-card">
            <div class="pf-card-head"><h2>Status</h2></div>
            <div class="pf-card-body">
              @if (session.can('companies.lifecycle')) {
                @if (c.status === 'ACTIVE') {
                  <p class="hint">Suspending signs everyone in this company out at once and keeps all their data.</p>
                  <button type="button" class="pf-btn pf-btn--danger" (click)="lifecycle.set('suspend')">Suspend company…</button>
                } @else if (c.status === 'SUSPENDED') {
                  <button type="button" class="pf-btn pf-btn--primary" (click)="lifecycle.set('reactivate')">Reactivate company…</button>
                }
              } @else {
                <p class="hint">Your role can't change company status.</p>
              }
            </div>
          </div>

          <div class="pf-card">
            <div class="pf-card-head"><h2>Modules</h2></div>
            <div class="pf-card-body">
              <label class="pf-switch">
                <input type="checkbox" [checked]="c.features.admissions" [disabled]="saving() || !session.can('modules.manage')" (change)="toggleAdmissions($event)" />
                Admissions (student journey, payments, settings)
              </label>
              <p class="hint">Turning a module off hides it; its data is kept. Changes are audited.</p>
            </div>
          </div>

          <div class="pf-card">
            <div class="pf-card-head"><h2>Support edit access</h2></div>
            <div class="pf-card-body">
              @if (c.supportEditAllowedUntil) {
                <p class="pf-note pf-note--warn">The owner allows Kelto support to make changes until {{ c.supportEditAllowedUntil | date: 'd MMM, HH:mm' }}.</p>
              } @else {
                <p class="hint">The owner hasn't allowed support changes. Read-only support sessions are always possible.</p>
              }
            </div>
          </div>
        </div>

        <div class="pf-card">
          <div class="pf-card-head"><h2>People ({{ c.users.length }})</h2></div>
          <div class="pf-scroll">
            <table class="pf-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr>
              </thead>
              <tbody>
                @for (u of c.users; track u.id) {
                  <tr>
                    <td><strong>{{ u.name }}</strong>@if (u.isOwner) {<small>Owner</small>}</td>
                    <td>{{ u.email }}</td>
                    <td>{{ u.roleName }}</td>
                    <td><span class="pf-chip" [class.pf-chip--on]="u.isActive">{{ u.isActive ? 'Active' : 'Inactive' }}</span></td>
                    <td>{{ u.createdAt | date: 'd MMM y' }}</td>
                    <td class="actions">
                      @if (session.can('support.view') && u.isActive) {
                        <button type="button" class="pf-btn pf-btn--sm" (click)="openSupport('VIEW_USER', u)">View as…</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <p class="pf-empty">Loading company…</p>
      }
    </section>

    @if (lifecycle(); as action) {
      <div class="pf-backdrop" (click)="lifecycle.set(null)" role="presentation">
        <form class="pf-dialog" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (ngSubmit)="applyLifecycle(action)">
          <h2>{{ action === 'suspend' ? 'Suspend' : 'Reactivate' }} {{ company()?.businessName }}</h2>
          <p>
            @if (action === 'suspend') {
              Everyone in this company is signed out at once and can't sign in until it is reactivated. Their data is kept.
            } @else {
              People in this company can sign in and work again.
            }
          </p>
          <label>Reason (recorded in the audit log)
            <input class="pf-input" name="reason" [(ngModel)]="reason" required />
          </label>
          @if (lifecycleError()) {
            <p class="pf-error">{{ lifecycleError() }}</p>
          }
          <div class="pf-dialog-foot">
            <button type="button" class="pf-btn" (click)="lifecycle.set(null)">Cancel</button>
            <button type="submit" class="pf-btn" [class.pf-btn--danger]="action === 'suspend'" [class.pf-btn--primary]="action !== 'suspend'"
              [disabled]="saving() || reason.trim().length < 5">{{ action === 'suspend' ? 'Suspend' : 'Reactivate' }}</button>
          </div>
        </form>
      </div>
    }

    @if (support(); as s) {
      <ka-support-dialog [companyId]="id()" [companyName]="company()?.businessName ?? ''" [people]="company()?.users ?? []"
        [editAllowedUntil]="company()?.supportEditAllowedUntil ?? null" [initialMode]="s.mode" [initialUserId]="s.userId"
        (closed)="support.set(null)" />
    }
  `,
  styles: `
    .of { color: #64748b; font-size: 14px; font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .hint { margin: 0; color: #64748b; font-size: 13px; line-height: 1.5; }
    h1 .pf-chip { vertical-align: middle; margin-left: 6px; }
    .manage-link { color: var(--kelto-brand-600); font-size: 12px; font-weight: 750; text-decoration: none; }
    .subscription-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }.subscription-title > div { display: grid; gap: 2px; }.subscription-title strong { font-size: 17px; }.subscription-title small { color: #64748b; font-size: 11px; }
    .sub-chip { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; }.sub-chip--active { background: #ecfdf5; color: #047857; }.sub-chip--trialing { background: #f5f3ff; color: #6d28d9; }.sub-chip--past_due { background: #fff7ed; color: #c2410c; }.sub-chip--cancelled { background: #fef2f2; color: #b91c1c; }
    .subscription-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 2px 0 0; }.subscription-meta div { padding: 9px; border-radius: 9px; background: #f8fafc; }.subscription-meta dt { color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; }.subscription-meta dd { margin: 3px 0 0; font-size: 13px; font-weight: 750; }
  `,
})
export class CompanyDetailPage implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);

  /** Route parameter */
  readonly id = input.required<string>();

  readonly tone = STATUS_TONE;
  readonly label = STATUS_LABEL;
  readonly subscriptionLabel = SUBSCRIPTION_LABEL;
  readonly company = signal<CompanyDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly lifecycle = signal<'suspend' | 'reactivate' | null>(null);
  readonly lifecycleError = signal<string | null>(null);
  readonly support = signal<{ mode: SupportMode; userId: string | null } | null>(null);
  readonly hasPeople = computed(() => (this.company()?.users ?? []).some((u) => u.isActive));
  reason = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.company(this.id()).subscribe({
      next: (c) => this.company.set(c),
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'This company could not load.'),
    });
  }

  openSupport(mode: SupportMode, user?: CompanyUser): void {
    this.support.set({ mode, userId: user?.id ?? null });
  }

  toggleAdmissions(event: Event): void {
    const box = event.target as HTMLInputElement;
    const on = box.checked;
    if (!confirm(`${on ? 'Turn on' : 'Turn off'} Admissions for ${this.company()?.businessName}?`)) {
      box.checked = !on;
      return;
    }
    this.saving.set(true);
    this.api.setFeatures(this.id(), { admissions: on }).subscribe({
      next: (c) => {
        this.saving.set(false);
        const current = this.company();
        if (current) this.company.set({ ...current, features: c.features });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        box.checked = !on;
        alert(err.error?.message || 'The change could not be saved.');
      },
    });
  }

  applyLifecycle(action: 'suspend' | 'reactivate'): void {
    this.saving.set(true);
    this.lifecycleError.set(null);
    const call = action === 'suspend' ? this.api.suspend(this.id(), this.reason.trim()) : this.api.reactivate(this.id(), this.reason.trim());
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.lifecycle.set(null);
        this.reason = '';
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.lifecycleError.set(err.error?.message || 'The change could not be saved.');
      },
    });
  }

  money(minor: number, currency: string): string {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100); }
    catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
  }
}
