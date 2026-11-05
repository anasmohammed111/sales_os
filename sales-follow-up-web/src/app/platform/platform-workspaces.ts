import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { PlatformService, WorkspaceSummary } from '../core/services/platform.service';

/** Every workspace on the platform, with its size and last activity. */
@Component({
  selector: 'kt-platform-workspaces',
  imports: [FormsModule, DatePipe, DecimalPipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Workspaces</h1>
          <p>Every business on Kelto. Open one to see everything inside it, read-only.</p>
        </div>
      </div>

      @if (totals(); as t) {
        <dl class="pf-tiles">
          <div><dt>Workspaces</dt><dd>{{ t.workspaces | number }}</dd></div>
          <div><dt>People</dt><dd>{{ t.users | number }}</dd></div>
          <div><dt>Leads</dt><dd>{{ t.leads | number }}</dd></div>
          <div><dt>Admissions students</dt><dd>{{ t.students | number }}</dd></div>
        </dl>
      }

      <div class="pf-card">
        <div class="pf-card-head">
          <h2>All workspaces</h2>
          <input class="pf-input" type="search" placeholder="Search by name or email" aria-label="Search workspaces"
            [(ngModel)]="search" (ngModelChange)="searchSoon()" />
        </div>
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else if (loading()) {
          <p class="pf-empty">Loading workspaces…</p>
        } @else if (!items().length) {
          <p class="pf-empty">No workspaces match.</p>
        } @else {
          <div class="pf-scroll">
            <table class="pf-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Created</th>
                  <th class="num">People</th>
                  <th class="num">Leads</th>
                  <th class="num">Students</th>
                  <th>Admissions</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                @for (w of items(); track w.id) {
                  <tr class="is-link" tabindex="0" (click)="open(w)" (keydown.enter)="open(w)">
                    <td><strong>{{ w.businessName }}</strong><small>{{ w.email || '—' }}</small></td>
                    <td>{{ w.createdAt | date: 'd MMM y' }}</td>
                    <td class="num">{{ w.counts.activeUsers }}<small>of {{ w.counts.users }}</small></td>
                    <td class="num">{{ w.counts.leads | number }}</td>
                    <td class="num">{{ w.counts.activeStudents }}<small>of {{ w.counts.students }}</small></td>
                    <td>
                      <span class="pf-chip" [class.pf-chip--on]="w.features.admissions">{{ w.features.admissions ? 'On' : 'Off' }}</span>
                    </td>
                    <td>{{ w.lastActivityAt ? (w.lastActivityAt | date: 'd MMM y, HH:mm') : 'No activity yet' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </section>
  `,
  styleUrl: './platform.scss',
})
export class PlatformWorkspaces implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);

  search = '';
  readonly items = signal<WorkspaceSummary[]>([]);
  readonly totals = signal<{ workspaces: number; users: number; leads: number; students: number } | null>(null);
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
    this.platform.workspaces(this.search.trim()).subscribe({
      next: ({ items, totals }) => {
        this.items.set(items);
        if (!this.search.trim()) this.totals.set(totals);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Workspaces could not load.');
      },
    });
  }

  open(w: WorkspaceSummary): void {
    this.router.navigate(['/platform/workspaces', w.id]);
  }
}
