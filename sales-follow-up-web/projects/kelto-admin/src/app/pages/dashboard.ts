import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AdminApi, SaaSDashboard, SubscriptionStatus } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Trialing',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/** Platform command centre: company health, subscription health and MRR. */
@Component({
  selector: 'ka-dashboard',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="pf-page dashboard">
      <div class="hero">
        <div>
          <span class="eyebrow">Kelto SaaS command centre</span>
          <h1>Good {{ greeting() }}, {{ firstName() }}</h1>
          <p>Revenue, customer health and subscriptions—one clear view of the platform.</p>
        </div>
        <div class="hero-actions">
          <span class="live"><i></i> Live platform data</span>
          <a class="pf-btn pf-btn--light" routerLink="/subscriptions">Manage subscriptions</a>
        </div>
      </div>

      @if (error()) {
        <div class="pf-card error-state">
          <p class="pf-error">{{ error() }}</p>
          <button class="pf-btn" type="button" (click)="load()">Try again</button>
        </div>
      } @else if (loading()) {
        <div class="metric-grid" aria-label="Loading dashboard">
          @for (item of [1, 2, 3, 4, 5]; track item) { <div class="metric skeleton"></div> }
        </div>
      } @else if (data(); as d) {
        <div class="metric-grid">
          <article class="metric metric--revenue">
            <div class="metric-icon">↗</div>
            <span class="metric-label">Monthly recurring revenue</span>
            @if (d.metrics.mrrByCurrency.length) {
              <div class="money-stack">
                @for (mrr of d.metrics.mrrByCurrency; track mrr.currency) {
                  <strong>{{ money(mrr.amountMinor, mrr.currency) }}</strong>
                }
              </div>
            } @else {
              <strong class="metric-value">—</strong>
            }
            <small>Active and past-due contracts</small>
          </article>

          <article class="metric">
            <div class="metric-icon metric-icon--green">✓</div>
            <span class="metric-label">Active subscriptions</span>
            <strong class="metric-value">{{ d.metrics.activeSubscriptions | number }}</strong>
            <small>{{ activeShare() }}% of subscriptions</small>
          </article>

          <article class="metric">
            <div class="metric-icon metric-icon--violet">◇</div>
            <span class="metric-label">Customers on trial</span>
            <strong class="metric-value">{{ d.metrics.trialingSubscriptions | number }}</strong>
            <small>Conversion opportunities</small>
          </article>

          <article class="metric" [class.metric--alert]="d.metrics.pastDueSubscriptions > 0">
            <div class="metric-icon metric-icon--amber">!</div>
            <span class="metric-label">Past due</span>
            <strong class="metric-value">{{ d.metrics.pastDueSubscriptions | number }}</strong>
            <small>{{ d.metrics.scheduledCancellations }} cancellation{{ d.metrics.scheduledCancellations === 1 ? '' : 's' }} scheduled</small>
          </article>

          <article class="metric">
            <div class="metric-icon metric-icon--blue">▦</div>
            <span class="metric-label">Companies</span>
            <strong class="metric-value">{{ d.metrics.companies | number }}</strong>
            <small>{{ d.metrics.newCompanies30d }} joined in 30 days</small>
          </article>
        </div>

        <div class="insight-grid">
          <article class="pf-card chart-card">
            <div class="pf-card-head">
              <div><h2>Subscription health</h2><p>Current lifecycle distribution</p></div>
              <a routerLink="/subscriptions">View all</a>
            </div>
            <div class="chart-body">
              @for (row of d.statusDistribution; track row.status) {
                <div class="bar-row">
                  <span class="dot" [class]="'dot dot--' + row.status.toLowerCase()"></span>
                  <span class="bar-label">{{ statusLabel[row.status] }}</span>
                  <div class="bar-track"><i [class]="'bar bar--' + row.status.toLowerCase()" [style.width.%]="barWidth(row.count)"></i></div>
                  <strong>{{ row.count }}</strong>
                </div>
              }
            </div>
          </article>

          <article class="pf-card chart-card">
            <div class="pf-card-head">
              <div><h2>Plan mix</h2><p>Customers by assigned plan</p></div>
              <a routerLink="/plans">Plan catalog</a>
            </div>
            <div class="chart-body">
              @if (!d.planDistribution.length) {
                <div class="mini-empty"><strong>No plans assigned yet</strong><span>Create plans and assign your first subscription.</span></div>
              } @else {
                @for (row of d.planDistribution; track row.key; let i = $index) {
                  <div class="plan-row">
                    <span class="plan-rank">{{ i + 1 }}</span>
                    <span><strong>{{ row.name }}</strong><small>{{ row.key }}</small></span>
                    <div class="bar-track"><i class="bar bar--plan" [style.width.%]="planBarWidth(row.count)"></i></div>
                    <strong>{{ row.count }}</strong>
                  </div>
                }
              }
            </div>
          </article>
        </div>

        <article class="pf-card">
          <div class="pf-card-head">
            <div><h2>Recently updated subscriptions</h2><p>The latest commercial account activity</p></div>
            <a class="pf-btn pf-btn--sm" routerLink="/subscriptions">Open subscriptions</a>
          </div>
          @if (!d.recentSubscriptions.length) {
            <div class="empty-subscriptions">
              <span class="empty-icon">◎</span>
              <div><strong>Your subscription workspace is ready</strong><p>Create a plan, then assign it to a company to start tracking recurring revenue.</p></div>
              <a class="pf-btn pf-btn--primary" routerLink="/plans">Create a plan</a>
            </div>
          } @else {
            <div class="pf-scroll">
              <table class="pf-table">
                <thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Billing</th><th class="num">Contract value</th><th>Renews / ends</th></tr></thead>
                <tbody>
                  @for (subscription of d.recentSubscriptions; track subscription.id) {
                    <tr>
                      <td><a [routerLink]="['/companies', subscription.workspace.id]"><strong>{{ subscription.workspace.businessName }}</strong></a><small>{{ subscription.workspace.email }}</small></td>
                      <td><strong>{{ subscription.plan.name }}</strong><small>{{ subscription.plan.key }}</small></td>
                      <td><span [class]="'subscription-chip subscription-chip--' + subscription.status.toLowerCase()">{{ statusLabel[subscription.status] }}</span></td>
                      <td>{{ subscription.billingCycle === 'MONTHLY' ? 'Monthly' : 'Annual' }}</td>
                      <td class="num"><strong>{{ money(subscription.amountMinor, subscription.currency) }}</strong></td>
                      <td>{{ subscription.currentPeriodEnd | date: 'd MMM y' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </article>
      }
    </section>
  `,
  styles: `
    .dashboard { gap: 20px; }
    .hero { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; overflow: hidden; padding: 28px 30px; border-radius: 20px; background: linear-gradient(125deg, #111827 0%, #1e293b 60%, #3b1f1b 100%); color: #fff; box-shadow: 0 18px 45px -32px #0f172a; }
    .hero::after { content: ''; position: absolute; top: -110px; right: -70px; width: 290px; height: 290px; border-radius: 50%; background: rgba(229, 96, 62, .18); }
    .hero > * { position: relative; z-index: 1; }
    .eyebrow { display: block; margin-bottom: 8px; color: #f6a68f; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .hero h1 { margin: 0; font-size: clamp(26px, 3vw, 36px); font-weight: 800; letter-spacing: -.035em; }
    .hero p { margin: 8px 0 0; color: #cbd5e1; font-size: 14px; }
    .hero-actions { display: flex; align-items: center; gap: 12px; }
    .live { display: inline-flex; align-items: center; gap: 7px; color: #cbd5e1; font-size: 12px; font-weight: 650; white-space: nowrap; }
    .live i { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 4px rgba(52, 211, 153, .14); }
    .pf-btn--light { border-color: rgba(255,255,255,.22); background: rgba(255,255,255,.1); color: #fff; backdrop-filter: blur(8px); }
    .metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .metric { position: relative; display: grid; min-height: 158px; padding: 18px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px -24px #0f172a; }
    .metric--revenue { border-color: #fed7cc; background: linear-gradient(150deg, #fff 20%, #fff7f4); }
    .metric--alert { border-color: #fed7aa; background: linear-gradient(150deg, #fff 30%, #fff7ed); }
    .metric-icon { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 16px; border-radius: 10px; background: #fff0eb; color: #c24120; font-size: 17px; font-weight: 900; }
    .metric-icon--green { background: #ecfdf5; color: #047857; }
    .metric-icon--violet { background: #f5f3ff; color: #7c3aed; }
    .metric-icon--amber { background: #fff7ed; color: #c2410c; }
    .metric-icon--blue { background: #eff6ff; color: #2563eb; }
    .metric-label { color: #64748b; font-size: 12px; font-weight: 700; }
    .metric-value, .money-stack strong { margin-top: 5px; font-size: 27px; line-height: 1.12; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .money-stack { display: grid; gap: 2px; }
    .money-stack strong + strong { font-size: 17px; color: #475569; }
    .metric small { align-self: end; margin-top: 8px; color: #94a3b8; font-size: 11.5px; }
    .insight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pf-card-head > div p { margin: 3px 0 0; color: #94a3b8; font-size: 12px; }
    .pf-card-head > a:not(.pf-btn) { color: var(--kelto-brand-600); font-size: 12px; font-weight: 750; text-decoration: none; }
    .chart-body { display: grid; gap: 16px; padding: 18px; }
    .bar-row, .plan-row { display: grid; grid-template-columns: 10px 78px minmax(80px, 1fr) 28px; align-items: center; gap: 10px; font-size: 12.5px; }
    .plan-row { grid-template-columns: 25px 112px minmax(80px, 1fr) 28px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; }
    .dot--active { background: #16a34a; } .dot--trialing { background: #7c3aed; } .dot--past_due { background: #f59e0b; } .dot--cancelled { background: #ef4444; }
    .bar-label { color: #475569; font-weight: 650; }
    .bar-track { height: 7px; overflow: hidden; border-radius: 20px; background: #f1f5f9; }
    .bar { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: #94a3b8; transition: width .25s ease; }
    .bar--active { background: #22c55e; } .bar--trialing { background: #8b5cf6; } .bar--past_due { background: #f59e0b; } .bar--cancelled { background: #ef4444; } .bar--expired { background: #64748b; } .bar--plan { background: linear-gradient(90deg, var(--kelto-brand-500), #f6a68f); }
    .plan-rank { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; background: #f8fafc; color: #64748b; font-size: 11px; font-weight: 800; }
    .plan-row > span:nth-child(2) { display: grid; }
    .plan-row small { color: #94a3b8; font-size: 10px; font-weight: 700; }
    .mini-empty { display: grid; gap: 4px; padding: 20px 4px; text-align: center; }
    .mini-empty span { color: #64748b; font-size: 13px; }
    .empty-subscriptions { display: flex; align-items: center; gap: 16px; padding: 26px; }
    .empty-subscriptions > div { flex: 1; }
    .empty-subscriptions strong { font-size: 14px; }
    .empty-subscriptions p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
    .empty-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #fff0eb; color: var(--kelto-brand-600); font-size: 24px; }
    .subscription-chip { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; }
    .subscription-chip--active { background: #ecfdf5; color: #047857; } .subscription-chip--trialing { background: #f5f3ff; color: #6d28d9; } .subscription-chip--past_due { background: #fff7ed; color: #c2410c; } .subscription-chip--cancelled { background: #fef2f2; color: #b91c1c; }
    .pf-table a { color: inherit; text-decoration: none; }
    .pf-table a:hover { color: var(--kelto-brand-600); }
    .error-state { display: grid; place-items: center; gap: 8px; padding: 24px; }
    .skeleton { overflow: hidden; background: #f1f5f9; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .55; } }
    @media (max-width: 1180px) { .metric-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 760px) { .hero { align-items: flex-start; flex-direction: column; padding: 22px; } .hero-actions { width: 100%; justify-content: space-between; } .metric-grid { grid-template-columns: repeat(2, 1fr); } .insight-grid { grid-template-columns: 1fr; } }
    @media (max-width: 480px) { .metric-grid { grid-template-columns: 1fr; } .metric { min-height: 140px; } .live { display: none; } .empty-subscriptions { align-items: flex-start; flex-wrap: wrap; } }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly session = inject(AdminSession);

  readonly data = signal<SaaSDashboard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly statusLabel = STATUS_LABEL;
  readonly firstName = computed(() => this.session.profile()?.name?.trim().split(/\s+/)[0] || 'there');
  readonly activeShare = computed(() => {
    const metrics = this.data()?.metrics;
    return metrics?.subscriptions ? Math.round((metrics.activeSubscriptions / metrics.subscriptions) * 100) : 0;
  });

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.dashboard().subscribe({
      next: (data) => { this.data.set(data); this.loading.set(false); },
      error: (error: HttpErrorResponse) => { this.loading.set(false); this.error.set(error.error?.message || 'The platform dashboard could not load.'); },
    });
  }

  greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  }

  money(amountMinor: number, currency: string): string {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amountMinor / 100); }
    catch { return `${currency} ${(amountMinor / 100).toFixed(2)}`; }
  }

  barWidth(count: number): number {
    const max = Math.max(1, ...(this.data()?.statusDistribution.map((row) => row.count) ?? [1]));
    return count ? Math.max(5, (count / max) * 100) : 0;
  }

  planBarWidth(count: number): number {
    const max = Math.max(1, ...(this.data()?.planDistribution.map((row) => row.count) ?? [1]));
    return Math.max(5, (count / max) * 100);
  }
}

