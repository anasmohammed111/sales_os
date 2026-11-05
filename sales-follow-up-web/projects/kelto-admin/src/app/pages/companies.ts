import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, Company, Totals } from '../core/admin-api';

export const STATUS_TONE: Record<string, string> = { ACTIVE: 'on', SUSPENDED: 'bad', ARCHIVED: '' };
export const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', ARCHIVED: 'Archived' };

/** Every company on Kelto, with its status, size and last activity. */
@Component({
  selector: 'ka-companies',
  imports: [FormsModule, DatePipe, DecimalPipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Companies</h1>
          <p>Every business on Kelto. Open one to manage it or to start a support session.</p>
        </div>
      </div>

      @if (totals(); as t) {
        <dl class="pf-tiles">
          <div><dt>Companies</dt><dd>{{ t.workspaces | number }}</dd></div>
          <div><dt>Suspended</dt><dd>{{ t.suspended | number }}</dd></div>
          <div><dt>People</dt><dd>{{ t.users | number }}</dd></div>
          <div><dt>Leads</dt><dd>{{ t.leads | number }}</dd></div>
          <div><dt>Admissions students</dt><dd>{{ t.students | number }}</dd></div>
        </dl>
      }

      <div class="pf-card">
        <div class="pf-card-head">
          <h2>All companies</h2>
          <span class="filters">
            <select class="pf-select" aria-label="Status" [(ngModel)]="status" (ngModelChange)="load()">
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <input class="pf-input" type="search" placeholder="Search by name or email" aria-label="Search companies"
              [(ngModel)]="search" (ngModelChange)="searchSoon()" />
          </span>
        </div>
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else if (loading()) {
          <p class="pf-empty">Loading companies…</p>
        } @else if (!items().length) {
          <p class="pf-empty">No companies match.</p>
        } @else {
          <div class="pf-scroll">
            <table class="pf-table">
              <thead>
                <tr>
                  <th>Company</th><th>Status</th><th>Created</th><th class="num">People</th><th class="num">Leads</th>
                  <th class="num">Students</th><th>Admissions</th><th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                @for (c of items(); track c.id) {
                  <tr class="is-link" tabindex="0" (click)="open(c)" (keydown.enter)="open(c)">
                    <td><strong>{{ c.businessName }}</strong><small>{{ c.email || '—' }}</small></td>
                    <td><span class="pf-chip" [class]="'pf-chip pf-chip--' + tone[c.status]">{{ label[c.status] }}</span></td>
                    <td>{{ c.createdAt | date: 'd MMM y' }}</td>
                    <td class="num">{{ c.counts.activeUsers }}<small>of {{ c.counts.users }}</small></td>
                    <td class="num">{{ c.counts.leads | number }}</td>
                    <td class="num">{{ c.counts.activeStudents }}<small>of {{ c.counts.students }}</small></td>
                    <td><span class="pf-chip" [class.pf-chip--on]="c.features.admissions">{{ c.features.admissions ? 'On' : 'Off' }}</span></td>
                    <td>{{ c.lastActivityAt ? (c.lastActivityAt | date: 'd MMM y, HH:mm') : 'No activity yet' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </section>
  `,
  styles: `.filters { display: flex; flex-wrap: wrap; gap: 8px; }`,
})
export class CompaniesPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);

  search = '';
  status = '';
  readonly tone = STATUS_TONE;
  readonly label = STATUS_LABEL;
  readonly items = signal<Company[]>([]);
  readonly totals = signal<Totals | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  searchSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  load(): void {
    this.api.companies(this.search.trim(), this.status).subscribe({
      next: ({ items, totals }) => {
        this.items.set(items);
        if (!this.search.trim() && !this.status) this.totals.set(totals);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Companies could not load.');
      },
    });
  }

  open(c: Company): void {
    this.router.navigate(['/companies', c.id]);
  }
}
