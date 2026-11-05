import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { toast } from 'ngx-sonner';
import { environment } from '../../../environments/environment';

interface SupportAccess {
  editAllowedUntil: string | null;
  grantedBy: string | null;
  grantedAt: string | null;
  liveEditSessions: number;
}

/**
 * Owner-only card: whether Kelto support may make changes in this workspace.
 * Support can always look (read-only) when helping; changing anything needs
 * this permission, for a limited time, and every change is logged.
 */
@Component({
  selector: 'kt-support-access',
  imports: [DatePipe],
  template: `
    <section class="card wide support-card">
      <div class="head">
        <div>
          <h2>Kelto support access</h2>
          <p>
            Kelto support can view your workspace read-only when helping you. Allow changes only when you've asked support
            to fix something; it ends automatically, and every change is recorded under the support person's name.
          </p>
        </div>
      </div>
      @if (access(); as a) {
        @if (a.editAllowedUntil) {
          <p class="state on">
            Support may make changes until <strong>{{ a.editAllowedUntil | date: 'd MMM, HH:mm' }}</strong>
            {{ a.grantedBy ? '(allowed by ' + a.grantedBy + ')' : '' }}.
            @if (a.liveEditSessions) {
              A support session is making changes now.
            }
          </p>
          <div class="actions">
            <button type="button" class="btn danger" [disabled]="busy()" (click)="set(0)">Withdraw now</button>
          </div>
        } @else {
          <p class="state">Support can't make changes.</p>
          <div class="actions">
            <button type="button" class="btn" [disabled]="busy()" (click)="set(4)">Allow for 4 hours</button>
            <button type="button" class="btn" [disabled]="busy()" (click)="set(24)">Allow for 24 hours</button>
            <button type="button" class="btn" [disabled]="busy()" (click)="set(72)">Allow for 3 days</button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host { display: contents; }
    .support-card { display: grid; gap: 12px; }
    h2 { margin: 0 0 4px; font-size: 16px; font-weight: 750; color: #0f172a; }
    p { margin: 0; color: #475569; font-size: 13.5px; line-height: 1.5; }
    .state { padding: 10px 12px; border-radius: 10px; background: #f8fafc; color: #334155; }
    .state.on { background: #fef2f2; color: #991b1b; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn { height: 36px; padding: 0 14px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #0f172a; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
    .btn.danger { border-color: #dc2626; background: #dc2626; color: #fff; }
    .btn:disabled { opacity: 0.55; cursor: default; }
  `,
})
export class SupportAccessCard implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/settings/support-access`;
  readonly access = signal<SupportAccess | null>(null);
  readonly busy = signal(false);

  ngOnInit(): void {
    this.http.get<{ data: SupportAccess }>(this.url).subscribe({ next: (r) => this.access.set(r.data), error: () => undefined });
  }

  set(hours: number): void {
    this.busy.set(true);
    this.http.put<{ data: SupportAccess }>(this.url, { hours }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.access.set(r.data);
        toast.success(hours ? 'Kelto support may make changes for now' : 'Support changes withdrawn');
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        toast.error(err.error?.message || 'This could not be saved.');
      },
    });
  }
}
