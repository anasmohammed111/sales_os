import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AdminApi,
  BillingCycle,
  Company,
  Plan,
  Subscription,
  SubscriptionInput,
  SubscriptionStatus,
} from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Trialing', ACTIVE: 'Active', PAST_DUE: 'Past due', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
};

interface SubscriptionForm {
  companyId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  notes: string;
  reason: string;
  existing: Subscription | null;
}

/** Cross-company subscription operations and lifecycle management. */
@Component({
  selector: 'ka-subscriptions',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div><span class="section-kicker">Revenue</span><h1>Subscriptions</h1><p>Assign plans, manage trials and renewals, and keep billing status accurate.</p></div>
        @if (session.can('subscriptions.manage')) { <button class="pf-btn pf-btn--primary" type="button" (click)="openCreate()" [disabled]="!activePlans().length">+ Assign subscription</button> }
      </div>

      <div class="health-strip">
        <span><i class="health health--active"></i><strong>Active</strong> Paid and current</span>
        <span><i class="health health--trialing"></i><strong>Trialing</strong> Evaluation period</span>
        <span><i class="health health--past_due"></i><strong>Past due</strong> Payment attention</span>
        <span><i class="health health--cancelled"></i><strong>Cancelled</strong> Service ended</span>
      </div>

      <div class="pf-card">
        <div class="pf-card-head toolbar">
          <h2>{{ total() }} subscription{{ total() === 1 ? '' : 's' }}</h2>
          <div class="filters">
            <input class="pf-input" type="search" placeholder="Search company or email" [(ngModel)]="search" (ngModelChange)="searchSoon()" />
            <select class="pf-select" [(ngModel)]="status" (ngModelChange)="filterChanged()"><option value="">All statuses</option>@for (option of statuses; track option) { <option [value]="option">{{ statusLabel[option] }}</option> }</select>
            <select class="pf-select" [(ngModel)]="plan" (ngModelChange)="filterChanged()"><option value="">All plans</option>@for (p of plans(); track p.id) { <option [value]="p.key">{{ p.name }}</option> }</select>
            <select class="pf-select" [(ngModel)]="billingCycle" (ngModelChange)="filterChanged()"><option value="">Any billing</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Annual</option></select>
          </div>
        </div>
        @if (error()) { <p class="pf-error">{{ error() }}</p> }
        @if (notice()) { <p class="pf-note" role="status">{{ notice() }}</p> }
        @else if (loading()) { <p class="pf-empty">Loading subscriptions…</p> }
        @else if (!items().length) {
          <div class="empty"><span>◎</span><h2>No subscriptions match</h2><p>{{ search || status || plan ? 'Clear a filter or search for another company.' : 'Assign a plan to a company to begin.' }}</p>
            @if (!plans().length) { <a class="pf-btn pf-btn--primary" routerLink="/plans">Create a plan first</a> }
            @else if (session.can('subscriptions.manage') && !search && !status && !plan) { <button class="pf-btn pf-btn--primary" type="button" (click)="openCreate()">Assign subscription</button> }
          </div>
        } @else {
          <div class="pf-scroll">
            <table class="pf-table subscription-table">
              <thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Billing</th><th class="num">Price</th><th>Period end</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                @for (item of items(); track item.id) {
                  <tr>
                    <td><a [routerLink]="['/companies', item.workspace.id]"><strong>{{ item.workspace.businessName }}</strong></a><small>{{ item.workspace.email }}</small></td>
                    <td><strong>{{ item.plan.name }}</strong><small>{{ item.plan.key }}</small></td>
                    <td><span [class]="'subscription-chip subscription-chip--' + item.status.toLowerCase()">{{ statusLabel[item.status] }}</span>@if (item.cancelAtPeriodEnd) { <small class="cancel-note">Cancels at period end</small> }</td>
                    <td>{{ item.billingCycle === 'MONTHLY' ? 'Monthly' : 'Annual' }}</td>
                    <td class="num"><strong>{{ money(item.amountMinor, item.currency) }}</strong><small>/ {{ item.billingCycle === 'MONTHLY' ? 'month' : 'year' }}</small></td>
                    <td>{{ item.currentPeriodEnd | date: 'd MMM y' }}@if (item.status === 'TRIALING' && item.trialEndsAt) { <small>Trial ends {{ item.trialEndsAt | date: 'd MMM' }}</small> }</td>
                    <td>{{ item.updatedAt | date: 'd MMM y' }}</td>
                    <td class="actions">@if (session.can('subscriptions.manage')) { <button class="pf-btn pf-btn--sm" type="button" (click)="openEdit(item)">Manage</button> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="pf-pager"><span>Page {{ page }} of {{ pages() }}</span><span><button class="pf-btn pf-btn--sm" type="button" [disabled]="page <= 1" (click)="go(page - 1)">Previous</button> <button class="pf-btn pf-btn--sm" type="button" [disabled]="page >= pages()" (click)="go(page + 1)">Next</button></span></div>
        }
      </div>
    </section>

    @if (form(); as f) {
      <div class="pf-backdrop" role="presentation" (click)="close()">
        <form class="pf-dialog subscription-dialog" (click)="$event.stopPropagation()" (ngSubmit)="save()">
          <div class="dialog-head"><div><span class="section-kicker">{{ f.existing ? 'Manage account' : 'New subscription' }}</span><h2>{{ f.existing ? f.existing.workspace.businessName : 'Assign a subscription' }}</h2></div><button class="close" type="button" aria-label="Close" (click)="close()">×</button></div>
          @if (!f.existing) {
            <label>Company<select class="pf-select" name="companyId" [(ngModel)]="f.companyId" required><option value="" disabled>Select company</option>@for (company of companies(); track company.id) { <option [value]="company.id">{{ company.businessName }}{{ company.subscription ? ' · ' + company.subscription.planName : '' }}</option> }</select><small>Choosing a subscribed company updates its existing subscription.</small></label>
          }
          <div class="field-grid">
            <label>Plan<select class="pf-select" name="planId" [(ngModel)]="f.planId" required>@for (p of assignablePlans(f); track p.id) { <option [value]="p.id">{{ p.name }} · {{ money(p.prices.monthly, p.currency) }}/mo</option> }</select></label>
            <label>Billing cycle<select class="pf-select" name="billingCycle" [(ngModel)]="f.billingCycle"><option value="MONTHLY">Monthly</option><option value="YEARLY">Annual</option></select></label>
          </div>
          <div class="field-grid">
            <label>Status<select class="pf-select" name="subscriptionStatus" [(ngModel)]="f.status">@for (option of allowedStatuses(f); track option) { <option [value]="option">{{ statusLabel[option] }}</option> }</select></label>
            <label class="schedule-cancel"><span>Renewal behavior</span><span class="toggle-row"><input type="checkbox" name="cancelAtPeriodEnd" [(ngModel)]="f.cancelAtPeriodEnd" [disabled]="f.status === 'CANCELLED' || f.status === 'EXPIRED'" /> Cancel at period end</span></label>
          </div>
          @if (f.existing && f.planId !== f.existing.planId) { <p class="pf-note pf-note--warn">Changing the plan applies the selected plan's current catalog price and keeps the previous terms in audit history.</p> }
          <h3>Billing period</h3>
          <div class="field-grid field-grid--3">
            <label>Period start<input class="pf-input" type="date" name="periodStart" [(ngModel)]="f.currentPeriodStart" /></label>
            <label>Period end<input class="pf-input" type="date" name="periodEnd" [(ngModel)]="f.currentPeriodEnd" /></label>
            <label>Trial end<input class="pf-input" type="date" name="trialEnd" [(ngModel)]="f.trialEndsAt" [disabled]="f.status !== 'TRIALING'" /></label>
          </div>
          @if (!f.existing) { <p class="pf-note">Dates left blank are calculated from the plan, billing cycle and trial settings.</p> }
          <label>Internal notes<textarea class="pf-textarea" rows="2" name="notes" [(ngModel)]="f.notes" maxlength="1000" placeholder="Purchase order, negotiated terms, or customer context"></textarea></label>
          <label>Change note <span class="required">Required for audit</span><input class="pf-input" name="reason" [(ngModel)]="f.reason" required minlength="5" placeholder="e.g. Annual contract approved" /></label>
          @if (saveError()) { <p class="pf-note pf-note--bad">{{ saveError() }}</p> }
          <div class="pf-dialog-foot"><button class="pf-btn" type="button" (click)="close()">Cancel</button><button class="pf-btn pf-btn--primary" type="submit" [disabled]="saving() || !valid(f)">{{ saving() ? 'Saving…' : (f.existing ? 'Save subscription' : 'Assign subscription') }}</button></div>
        </form>
      </div>
    }
  `,
  styles: `
    .section-kicker { display: block; margin-bottom: 5px; color: var(--kelto-brand-600); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .health-strip { display: flex; flex-wrap: wrap; gap: 9px; }
    .health-strip span { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #64748b; font-size: 11px; }
    .health-strip strong { color: #334155; }.health { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.health--active { background: #22c55e; }.health--trialing { background: #8b5cf6; }.health--past_due { background: #f59e0b; }.health--cancelled { background: #ef4444; }
    .toolbar { align-items: center; }.filters { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }.filters .pf-input { width: 230px; }.filters .pf-select { max-width: 150px; }
    .subscription-table a { color: inherit; text-decoration: none; }.subscription-table a:hover { color: var(--kelto-brand-600); }
    .subscription-chip { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; }
    .subscription-chip--active { background: #ecfdf5; color: #047857; }.subscription-chip--trialing { background: #f5f3ff; color: #6d28d9; }.subscription-chip--past_due { background: #fff7ed; color: #c2410c; }.subscription-chip--cancelled { background: #fef2f2; color: #b91c1c; }.subscription-chip--expired { background: #f1f5f9; color: #475569; }
    .cancel-note { color: #c2410c !important; }.empty { display: grid; place-items: center; padding: 46px 18px; text-align: center; }.empty > span { color: #cbd5e1; font-size: 38px; }.empty h2 { margin: 6px 0 0; font-size: 17px; }.empty p { margin: 4px 0 15px; color: #64748b; font-size: 13px; }
    .subscription-dialog { width: min(720px, 100%); }.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; }.dialog-head h2 { margin-top: 0; }.close { border: 0; background: none; color: #64748b; font-size: 26px; cursor: pointer; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.field-grid--3 { grid-template-columns: repeat(3, 1fr); }.subscription-dialog .pf-select, .subscription-dialog .pf-input { width: 100%; }.subscription-dialog h3 { margin: 3px 0 -4px; font-size: 13px; }.subscription-dialog label small { color: #94a3b8; font-size: 10px; font-weight: 500; }
    .schedule-cancel { align-content: start; }.toggle-row { display: flex; align-items: center; gap: 8px; height: 38px; color: #475569; font-weight: 600; }.toggle-row input { width: 17px; height: 17px; accent-color: var(--kelto-brand-600); }.pf-textarea { width: 100%; height: auto; padding-block: 10px; resize: vertical; }.required { color: #b45309; font-size: 10px; font-weight: 700; }
    @media (max-width: 800px) { .toolbar { align-items: stretch; }.filters { justify-content: flex-start; }.filters .pf-input { width: 100%; }.field-grid, .field-grid--3 { grid-template-columns: 1fr; } }
  `,
})
export class SubscriptionsPage implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  readonly session = inject(AdminSession);
  readonly plans = signal<Plan[]>([]);
  readonly companies = signal<Company[]>([]);
  readonly items = signal<Subscription[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly form = signal<SubscriptionForm | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  /** Modules the last save switched on or off for the company */
  readonly notice = signal<string | null>(null);
  readonly statuses: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'];
  readonly statusLabel = STATUS_LABEL;
  search = '';
  status = '';
  plan = '';
  billingCycle = '';
  page = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private companyFocus = '';
  private autoOpened = false;

  ngOnInit(): void {
    this.companyFocus = this.route.snapshot.queryParamMap.get('company') || '';
    forkJoin({ plans: this.api.plans(), companies: this.api.companies() }).subscribe({
      next: ({ plans, companies }) => { this.plans.set(plans.items); this.companies.set(companies.items); this.load(); },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(e.error?.message || 'Subscription setup could not load.'); },
    });
  }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); }
  activePlans(): Plan[] { return this.plans().filter((p) => p.status === 'ACTIVE'); }
  assignablePlans(form: SubscriptionForm): Plan[] { return this.plans().filter((p) => p.status === 'ACTIVE' || p.id === form.existing?.planId); }
  allowedStatuses(form: SubscriptionForm): SubscriptionStatus[] {
    if (!form.existing) return this.statuses;
    const transitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
      TRIALING: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'],
      ACTIVE: ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'],
      PAST_DUE: ['PAST_DUE', 'ACTIVE', 'CANCELLED', 'EXPIRED'],
      CANCELLED: ['CANCELLED', 'ACTIVE', 'TRIALING'],
      EXPIRED: ['EXPIRED', 'ACTIVE', 'TRIALING'],
    };
    return transitions[form.existing.status];
  }
  load(): void {
    this.loading.set(true); this.error.set(null);
    this.api.subscriptions({ search: this.search.trim(), status: this.status, plan: this.plan, billingCycle: this.billingCycle, businessId: this.companyFocus, page: this.page }).subscribe({
      next: (result) => {
        this.items.set(result.items); this.total.set(result.total); this.loading.set(false);
        if (this.companyFocus && !this.autoOpened) {
          this.autoOpened = true;
          const item = result.items[0];
          if (item) this.openEdit(item); else this.openCreate(this.companyFocus);
        }
      },
      error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(e.error?.message || 'Subscriptions could not load.'); },
    });
  }
  searchSoon(): void { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.page = 1; this.companyFocus = ''; this.load(); }, 300); }
  filterChanged(): void { this.page = 1; this.companyFocus = ''; this.load(); }
  go(page: number): void { this.page = page; this.load(); }
  pages(): number { return Math.max(1, Math.ceil(this.total() / 25)); }
  openCreate(companyId = ''): void {
    const plan = this.activePlans()[0]; if (!plan) return;
    this.saveError.set(null);
    this.form.set({ companyId, planId: plan.id, status: plan.trialDays ? 'TRIALING' : 'ACTIVE', billingCycle: 'MONTHLY', trialEndsAt: '', currentPeriodStart: '', currentPeriodEnd: '', cancelAtPeriodEnd: false, notes: '', reason: '', existing: null });
  }
  openEdit(item: Subscription): void {
    this.saveError.set(null);
    this.form.set({ companyId: item.workspace.id, planId: item.planId, status: item.status, billingCycle: item.billingCycle, trialEndsAt: this.dateInput(item.trialEndsAt), currentPeriodStart: this.dateInput(item.currentPeriodStart), currentPeriodEnd: this.dateInput(item.currentPeriodEnd), cancelAtPeriodEnd: item.cancelAtPeriodEnd, notes: item.notes, reason: '', existing: item });
  }
  close(): void { if (!this.saving()) this.form.set(null); }
  valid(form: SubscriptionForm): boolean { return !!form.companyId && !!form.planId && form.reason.trim().length >= 5; }
  save(): void {
    const f = this.form(); if (!f || !this.valid(f)) return;
    const body: SubscriptionInput = { planId: f.planId, status: f.status, billingCycle: f.billingCycle, cancelAtPeriodEnd: f.cancelAtPeriodEnd, notes: f.notes.trim(), reason: f.reason.trim() };
    if (f.currentPeriodStart) body.currentPeriodStart = f.currentPeriodStart;
    if (f.currentPeriodEnd) body.currentPeriodEnd = f.currentPeriodEnd;
    if (f.status === 'TRIALING' && f.trialEndsAt) body.trialEndsAt = f.trialEndsAt;
    this.saving.set(true); this.saveError.set(null); this.notice.set(null);
    const company = this.companies().find((c) => c.id === f.companyId)?.businessName ?? 'the company';
    this.api.saveSubscription(f.companyId, body).subscribe({
      next: ({ modulesChanged }) => {
        this.saving.set(false); this.form.set(null); this.companyFocus = ''; this.loadCompaniesAndSubscriptions();
        const changes = Object.entries(modulesChanged ?? {}).map(([module, c]) => `${module[0].toUpperCase()}${module.slice(1)} switched ${c.to ? 'on' : 'off'}`);
        if (changes.length) this.notice.set(`${changes.join(', ')} for ${company}, following its plan.`);
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.saveError.set(e.error?.message || 'The subscription could not be saved.'); },
    });
  }
  private loadCompaniesAndSubscriptions(): void { this.api.companies().subscribe({ next: ({ items }) => { this.companies.set(items); this.load(); }, error: () => this.load() }); }
  private dateInput(value: string | null): string { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
  money(minor: number, currency: string): string { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; } }
}

