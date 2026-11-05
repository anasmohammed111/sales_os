import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, Plan, PlanInput } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

interface PlanForm {
  id: string | null;
  key: string;
  name: string;
  description: string;
  currency: string;
  monthly: number;
  yearly: number;
  trialDays: number;
  users: number;
  leads: number;
  students: number;
  storageGb: number;
  crm: boolean;
  admissions: boolean;
}

const blankForm = (): PlanForm => ({
  id: null, key: '', name: '', description: '', currency: 'USD', monthly: 0, yearly: 0, trialDays: 14,
  users: 5, leads: 1000, students: 0, storageGb: 5, crm: true, admissions: false,
});

/** Commercial plan catalog with immutable keys and auditable price updates. */
@Component({
  selector: 'ka-plans',
  imports: [FormsModule, DecimalPipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div><span class="section-kicker">Revenue</span><h1>Plans & pricing</h1><p>Define the offers available to companies. Existing subscriptions keep the price originally assigned.</p></div>
        @if (session.can('plans.manage')) { <button class="pf-btn pf-btn--primary" type="button" (click)="openCreate()">+ New plan</button> }
      </div>

      <div class="catalog-summary">
        <div><span>Active plans</span><strong>{{ activeCount() }}</strong></div>
        <div><span>Archived plans</span><strong>{{ archivedCount() }}</strong></div>
        <label class="archive-toggle"><input type="checkbox" [ngModel]="showArchived()" (ngModelChange)="showArchived.set($event)" /> Show archived plans</label>
      </div>

      @if (error()) { <p class="pf-error pf-card">{{ error() }}</p> }
      @else if (loading()) { <p class="pf-empty pf-card">Loading plan catalog…</p> }
      @else if (!visiblePlans().length) {
        <div class="pf-card empty"><span>◫</span><h2>No plans yet</h2><p>Create a commercial plan before assigning subscriptions.</p>
          @if (session.can('plans.manage')) { <button class="pf-btn pf-btn--primary" type="button" (click)="openCreate()">Create first plan</button> }
        </div>
      } @else {
        <div class="plan-grid">
          @for (plan of visiblePlans(); track plan.id) {
            <article class="plan-card" [class.is-archived]="plan.status === 'ARCHIVED'">
              <div class="plan-top">
                <div><span class="plan-key">{{ plan.key }}</span><h2>{{ plan.name }}</h2></div>
                <span class="pf-chip" [class.pf-chip--on]="plan.status === 'ACTIVE'">{{ plan.status === 'ACTIVE' ? 'Active' : 'Archived' }}</span>
              </div>
              <p class="description">{{ plan.description || 'No description added.' }}</p>
              <div class="price">
                <strong>{{ money(plan.prices.monthly, plan.currency) }}</strong><span>/ month</span>
                <small>{{ money(plan.prices.yearly, plan.currency) }} billed annually</small>
              </div>
              <div class="trial">{{ plan.trialDays ? plan.trialDays + '-day free trial' : 'No free trial' }}</div>
              <dl class="limits">
                <div><dt>Users</dt><dd>{{ limit(plan.limits.users) }}</dd></div>
                <div><dt>Leads</dt><dd>{{ limit(plan.limits.leads) }}</dd></div>
                <div><dt>Students</dt><dd>{{ plan.modules.includes('admissions') ? limit(plan.limits.students) : 'Not included' }}</dd></div>
                <div><dt>Storage</dt><dd>{{ plan.limits.storageMb ? ((plan.limits.storageMb / 1024) | number: '1.0-1') + ' GB' : 'Unlimited' }}</dd></div>
              </dl>
              <div class="modules">
                @for (module of plan.modules; track module) { <span>{{ module === 'crm' ? 'Core CRM' : 'Admissions' }}</span> }
                @if (!plan.modules.length) { <span class="muted">No modules</span> }
              </div>
              @if (session.can('plans.manage')) {
                <div class="card-actions">
                  <button class="pf-btn pf-btn--sm" type="button" (click)="openEdit(plan)">Edit plan</button>
                  @if (plan.status === 'ACTIVE') { <button class="text-action" type="button" (click)="archive(plan)">Archive</button> }
                  @else { <button class="text-action" type="button" (click)="restore(plan)">Restore</button> }
                </div>
              }
            </article>
          }
        </div>
      }
    </section>

    @if (form(); as f) {
      <div class="pf-backdrop" (click)="close()" role="presentation">
        <form class="pf-dialog plan-dialog" (click)="$event.stopPropagation()" (ngSubmit)="save()">
          <div class="dialog-head"><div><span class="section-kicker">Plan catalog</span><h2>{{ f.id ? 'Edit ' + f.name : 'Create a plan' }}</h2></div><button type="button" class="close" aria-label="Close" (click)="close()">×</button></div>
          <div class="field-grid">
            <label>Plan name<input class="pf-input" name="name" [(ngModel)]="f.name" required maxlength="100" /></label>
            <label>Plan key<input class="pf-input" name="key" [(ngModel)]="f.key" required [disabled]="!!f.id" placeholder="GROWTH" /><small>Permanent identifier</small></label>
          </div>
          <label>Description<textarea class="pf-textarea" name="description" [(ngModel)]="f.description" rows="2" maxlength="500"></textarea></label>
          <h3>Pricing</h3>
          <div class="field-grid field-grid--3">
            <label>Currency<input class="pf-input" name="currency" [(ngModel)]="f.currency" maxlength="3" required /></label>
            <label>Monthly price<input class="pf-input" name="monthly" type="number" min="0" step="0.01" [(ngModel)]="f.monthly" required /></label>
            <label>Annual price<input class="pf-input" name="yearly" type="number" min="0" step="0.01" [(ngModel)]="f.yearly" required /></label>
          </div>
          <label>Free trial (days)<input class="pf-input compact" name="trialDays" type="number" min="0" max="365" [(ngModel)]="f.trialDays" /></label>
          <h3>Included limits <small>Use 0 for unlimited</small></h3>
          <div class="field-grid field-grid--4">
            <label>Users<input class="pf-input" name="users" type="number" min="0" [(ngModel)]="f.users" /></label>
            <label>Leads<input class="pf-input" name="leads" type="number" min="0" [(ngModel)]="f.leads" /></label>
            <label>Students<input class="pf-input" name="students" type="number" min="0" [(ngModel)]="f.students" /></label>
            <label>Storage (GB)<input class="pf-input" name="storageGb" type="number" min="0" step="0.5" [(ngModel)]="f.storageGb" /></label>
          </div>
          <h3>Modules</h3>
          <div class="module-options">
            <label class="pf-switch"><input type="checkbox" name="crm" [(ngModel)]="f.crm" /> Core CRM</label>
            <label class="pf-switch"><input type="checkbox" name="admissions" [(ngModel)]="f.admissions" /> Admissions</label>
          </div>
          @if (saveError()) { <p class="pf-note pf-note--bad">{{ saveError() }}</p> }
          <div class="pf-dialog-foot"><button type="button" class="pf-btn" (click)="close()">Cancel</button><button type="submit" class="pf-btn pf-btn--primary" [disabled]="saving() || !valid(f)">{{ saving() ? 'Saving…' : (f.id ? 'Save changes' : 'Create plan') }}</button></div>
        </form>
      </div>
    }
  `,
  styles: `
    .section-kicker { display: block; margin-bottom: 5px; color: var(--kelto-brand-600); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .catalog-summary { display: flex; align-items: center; gap: 10px; }
    .catalog-summary > div { display: flex; align-items: baseline; gap: 8px; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 11px; background: #fff; color: #64748b; font-size: 12px; }
    .catalog-summary strong { color: #0f172a; font-size: 17px; }
    .archive-toggle { display: flex; align-items: center; gap: 7px; margin-left: auto; color: #64748b; font-size: 12px; font-weight: 650; }
    .archive-toggle input { accent-color: var(--kelto-brand-600); }
    .plan-grid { display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)); gap: 14px; align-items: start; }
    .plan-card { display: grid; gap: 16px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 10px 30px -28px #0f172a; }
    .plan-card.is-archived { opacity: .72; }
    .plan-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .plan-top h2 { margin: 3px 0 0; font-size: 20px; letter-spacing: -.02em; }
    .plan-key { color: #94a3b8; font: 700 10px/1 ui-monospace, monospace; letter-spacing: .08em; }
    .description { min-height: 40px; margin: 0; color: #64748b; font-size: 13px; line-height: 1.55; }
    .price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; padding: 16px 0; border-block: 1px solid #f1f5f9; }
    .price strong { font-size: 27px; font-weight: 800; letter-spacing: -.03em; }
    .price span { color: #64748b; font-size: 12px; }
    .price small { width: 100%; margin-top: 3px; color: #94a3b8; font-size: 11px; }
    .trial { width: fit-content; padding: 5px 9px; border-radius: 8px; background: #fff7ed; color: #9a3412; font-size: 11px; font-weight: 750; }
    .limits { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
    .limits div { padding: 9px 10px; border-radius: 10px; background: #f8fafc; }
    .limits dt { color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .limits dd { margin: 3px 0 0; font-size: 13px; font-weight: 750; }
    .modules { display: flex; flex-wrap: wrap; gap: 6px; }
    .modules span { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 7px; color: #475569; font-size: 11px; font-weight: 650; }
    .modules .muted { color: #94a3b8; }
    .card-actions { display: flex; align-items: center; justify-content: space-between; padding-top: 4px; }
    .text-action { padding: 5px; border: 0; background: none; color: #64748b; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .text-action:hover { color: var(--kelto-brand-600); }
    .empty { display: grid; place-items: center; padding: 48px; text-align: center; }
    .empty > span { font-size: 34px; color: #cbd5e1; }.empty h2 { margin: 8px 0 0; font-size: 18px; }.empty p { margin: 4px 0 16px; color: #64748b; font-size: 13px; }
    .plan-dialog { width: min(760px, 100%); }
    .dialog-head { display: flex; justify-content: space-between; align-items: flex-start; }.dialog-head h2 { margin-top: 0; }.close { border: 0; background: none; color: #64748b; font-size: 26px; cursor: pointer; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.field-grid--3 { grid-template-columns: .65fr 1fr 1fr; }.field-grid--4 { grid-template-columns: repeat(4, 1fr); }
    .pf-textarea { width: 100%; height: auto; padding-block: 10px; resize: vertical; }
    .plan-dialog h3 { margin: 4px 0 -4px; font-size: 13px; }.plan-dialog h3 small { color: #94a3b8; font-weight: 500; }
    label small { color: #94a3b8; font-size: 10px; font-weight: 500; }.compact { max-width: 160px; }.module-options { display: flex; gap: 20px; }
    @media (max-width: 1080px) { .plan-grid { grid-template-columns: repeat(2, minmax(260px, 1fr)); } }
    @media (max-width: 680px) { .plan-grid { grid-template-columns: 1fr; } .catalog-summary { flex-wrap: wrap; }.archive-toggle { margin-left: 0; width: 100%; }.field-grid, .field-grid--3, .field-grid--4 { grid-template-columns: 1fr 1fr; } }
  `,
})
export class PlansPage implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);
  readonly plans = signal<Plan[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly form = signal<PlanForm | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showArchived = signal(false);
  readonly activeCount = computed(() => this.plans().filter((p) => p.status === 'ACTIVE').length);
  readonly archivedCount = computed(() => this.plans().filter((p) => p.status === 'ARCHIVED').length);
  readonly visiblePlans = computed(() => this.plans().filter((p) => this.showArchived() || p.status === 'ACTIVE'));

  ngOnInit(): void { this.load(); }
  load(): void { this.api.plans().subscribe({ next: ({ items }) => { this.plans.set(items); this.loading.set(false); }, error: (e: HttpErrorResponse) => { this.loading.set(false); this.error.set(e.error?.message || 'Plans could not load.'); } }); }
  openCreate(): void { this.saveError.set(null); this.form.set(blankForm()); }
  openEdit(plan: Plan): void {
    this.saveError.set(null);
    this.form.set({ id: plan.id, key: plan.key, name: plan.name, description: plan.description, currency: plan.currency, monthly: plan.prices.monthly / 100, yearly: plan.prices.yearly / 100, trialDays: plan.trialDays, users: plan.limits.users, leads: plan.limits.leads, students: plan.limits.students, storageGb: plan.limits.storageMb / 1024, crm: plan.modules.includes('crm'), admissions: plan.modules.includes('admissions') });
  }
  close(): void { if (!this.saving()) this.form.set(null); }
  valid(form: PlanForm): boolean { return !!form.name.trim() && /^[A-Za-z][A-Za-z0-9 _-]+$/.test(form.key) && /^[A-Za-z]{3}$/.test(form.currency) && [form.monthly, form.yearly, form.trialDays, form.users, form.leads, form.students, form.storageGb].every((v) => Number(v) >= 0); }
  save(): void {
    const f = this.form(); if (!f || !this.valid(f)) return;
    const body: PlanInput = { name: f.name.trim(), description: f.description.trim(), currency: f.currency.toUpperCase(), prices: { monthly: Math.round(f.monthly * 100), yearly: Math.round(f.yearly * 100) }, trialDays: Math.round(f.trialDays), limits: { users: Math.round(f.users), leads: Math.round(f.leads), students: Math.round(f.students), storageMb: Math.round(f.storageGb * 1024) }, modules: [...(f.crm ? ['crm'] : []), ...(f.admissions ? ['admissions'] : [])] };
    if (!f.id) body.key = f.key.trim().toUpperCase().replace(/[\s-]+/g, '_');
    this.saving.set(true); this.saveError.set(null);
    const call = f.id ? this.api.updatePlan(f.id, body) : this.api.createPlan(body);
    call.subscribe({ next: ({ plan }) => { this.plans.update((items) => f.id ? items.map((p) => p.id === plan.id ? plan : p) : [...items, plan].sort((a, b) => a.name.localeCompare(b.name))); this.saving.set(false); this.form.set(null); }, error: (e: HttpErrorResponse) => { this.saving.set(false); this.saveError.set(e.error?.message || 'The plan could not be saved.'); } });
  }
  archive(plan: Plan): void { if (confirm(`Archive ${plan.name}? It stays on existing subscriptions but cannot be newly assigned.`)) this.setStatus(plan, 'ARCHIVED'); }
  restore(plan: Plan): void { this.setStatus(plan, 'ACTIVE'); }
  private setStatus(plan: Plan, status: 'ACTIVE' | 'ARCHIVED'): void { this.api.updatePlan(plan.id, { status }).subscribe({ next: ({ plan: updated }) => this.plans.update((items) => items.map((p) => p.id === updated.id ? updated : p)), error: (e: HttpErrorResponse) => alert(e.error?.message || 'The plan status could not be changed.') }); }
  money(minor: number, currency: string): string { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; } }
  limit(value: number): string { return value ? new Intl.NumberFormat('en').format(value) : 'Unlimited'; }
}

