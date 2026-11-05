import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, Paged, PlatformUser } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';
import { SupportDialog } from './support-dialog';

/** Everyone with a Kelto account, across all companies. */
@Component({
  selector: 'ka-people',
  imports: [FormsModule, DatePipe, RouterLink, SupportDialog],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Company users</h1>
          <p>Everyone with an account, in every company.</p>
        </div>
      </div>
      <div class="pf-card">
        <div class="pf-card-head">
          <h2>{{ result()?.total ?? 0 }} people</h2>
          <input class="pf-input" type="search" placeholder="Search by name or email" aria-label="Search people"
            [(ngModel)]="search" (ngModelChange)="searchSoon()" />
        </div>
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else if (result(); as r) {
          @if (!r.items.length) {
            <p class="pf-empty">No one matches.</p>
          } @else {
            <div class="pf-scroll">
              <table class="pf-table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr>
                </thead>
                <tbody>
                  @for (u of r.items; track u.id) {
                    <tr>
                      <td><strong>{{ u.name }}</strong></td>
                      <td>{{ u.email }}</td>
                      <td>
                        @if (u.workspace) {
                          <a [routerLink]="['/companies', u.workspace.id]">{{ u.workspace.businessName }}</a>
                          @if (u.workspace.status !== 'ACTIVE') {
                            <small>Suspended</small>
                          }
                        } @else {
                          —
                        }
                      </td>
                      <td>{{ u.roleName }}</td>
                      <td><span class="pf-chip" [class.pf-chip--on]="u.isActive">{{ u.isActive ? 'Active' : 'Inactive' }}</span></td>
                      <td>{{ u.createdAt | date: 'd MMM y' }}</td>
                      <td class="actions">
                        @if (session.can('support.view') && u.isActive && u.workspace) {
                          <button type="button" class="pf-btn pf-btn--sm" (click)="viewAs.set(u)">View as…</button>
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
          <p class="pf-empty">Loading people…</p>
        }
      </div>
    </section>

    @if (viewAs(); as u) {
      <ka-support-dialog [companyId]="u.workspace!.id" [companyName]="u.workspace!.businessName" [people]="[u]"
        initialMode="VIEW_USER" [initialUserId]="u.id" (closed)="viewAs.set(null)" />
    }
  `,
  styles: `.pf-table a { font-weight: 600; text-decoration: none; }`,
})
export class PeoplePage implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);

  search = '';
  readonly result = signal<Paged<PlatformUser> | null>(null);
  readonly error = signal<string | null>(null);
  readonly viewAs = signal<PlatformUser | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.go(1);
  }

  pages(r: Paged<PlatformUser>): number {
    return Math.max(1, Math.ceil(r.total / r.limit));
  }

  searchSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.go(1), 300);
  }

  go(page: number): void {
    this.api.people(this.search.trim(), page).subscribe({
      next: (r) => {
        this.result.set(r);
        this.error.set(null);
      },
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'People could not load.'),
    });
  }
}
