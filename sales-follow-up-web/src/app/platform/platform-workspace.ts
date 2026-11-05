import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { PlatformService, WorkspaceDetail } from '../core/services/platform.service';
import { AuthService } from '../core/services/auth.service';

/** One workspace: its people, its modules, and a read-only way in. */
@Component({
  selector: 'kt-platform-workspace',
  imports: [FormsModule, DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="pf-page">
      <a class="pf-back" routerLink="/platform">← All workspaces</a>

      @if (error()) {
        <p class="pf-error">{{ error() }}</p>
      } @else if (workspace(); as w) {
        <div class="pf-head">
          <div>
            <h1>{{ w.businessName }}</h1>
            <p>{{ w.email || 'No email' }} · created {{ w.createdAt | date: 'd MMM y' }}
              · last activity {{ w.lastActivityAt ? (w.lastActivityAt | date: 'd MMM y, HH:mm') : 'none yet' }}</p>
          </div>
          <button type="button" class="pf-btn pf-btn--primary" (click)="startOpen()">Open workspace (read-only)</button>
        </div>

        <dl class="pf-tiles">
          <div><dt>People</dt><dd>{{ w.counts.activeUsers }} <small class="of">of {{ w.counts.users }}</small></dd></div>
          <div><dt>Leads</dt><dd>{{ w.counts.leads | number }}</dd></div>
          <div><dt>Active students</dt><dd>{{ w.counts.activeStudents }} <small class="of">of {{ w.counts.students }}</small></dd></div>
        </dl>

        <div class="pf-card">
          <div class="pf-card-head">
            <h2>Modules</h2>
          </div>
          <div class="modules">
            <label class="pf-switch">
              <input type="checkbox" [checked]="w.features.admissions" [disabled]="saving()" (change)="toggleAdmissions($event)" />
              Admissions (student journey, payments, settings)
            </label>
            <small>Changes are recorded in the audit log.</small>
          </div>
        </div>

        <div class="pf-card">
          <div class="pf-card-head">
            <h2>People ({{ w.users.length }})</h2>
          </div>
          <div class="pf-scroll">
            <table class="pf-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr>
              </thead>
              <tbody>
                @for (u of w.users; track u.id) {
                  <tr>
                    <td><strong>{{ u.name }}</strong></td>
                    <td>{{ u.email }}</td>
                    <td>{{ u.roleName }}</td>
                    <td><span class="pf-chip" [class.pf-chip--on]="u.isActive">{{ u.isActive ? 'Active' : 'Inactive' }}</span></td>
                    <td>{{ u.createdAt | date: 'd MMM y' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <p class="pf-empty">Loading workspace…</p>
      }
    </section>

    @if (opening()) {
      <div class="pf-backdrop" (click)="opening.set(false)" role="presentation">
        <form class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="open-title" (click)="$event.stopPropagation()" (ngSubmit)="open()">
          <h2 id="open-title">Open {{ workspace()?.businessName }}</h2>
          <p>You'll see everything in this workspace for one hour. Nothing can be changed, and the visit is recorded in the audit log with your reason.</p>
          <label>
            Reason
            <input class="pf-input" name="reason" [(ngModel)]="reason" placeholder="For example: checking a support request" required />
          </label>
          <label>
            Start at
            <select class="pf-select" name="path" [(ngModel)]="path">
              @for (p of landings(); track p.path) {
                <option [value]="p.path">{{ p.label }}</option>
              }
            </select>
          </label>
          @if (openError()) {
            <p class="pf-error">{{ openError() }}</p>
          }
          <div class="pf-dialog-foot">
            <button type="button" class="pf-btn" (click)="opening.set(false)">Cancel</button>
            <button type="submit" class="pf-btn pf-btn--primary" [disabled]="saving() || reason.trim().length < 5">Open read-only</button>
          </div>
        </form>
      </div>
    }
  `,
  styleUrl: './platform.scss',
  styles: `
    .of { color: #64748b; font-size: 14px; font-weight: 600; }
    .modules { display: grid; gap: 6px; padding: 16px; }
    .modules small { color: #64748b; font-size: 12.5px; }
  `,
})
export class PlatformWorkspace implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly auth = inject(AuthService);

  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  readonly workspace = signal<WorkspaceDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly opening = signal(false);
  readonly openError = signal<string | null>(null);
  reason = '';
  path = '/dashboard';

  readonly landings = computed(() => [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/leads', label: 'Leads' },
    ...(this.workspace()?.features.admissions ? [{ path: '/admissions/overview', label: 'Admissions overview' }] : []),
    { path: '/team', label: 'Team' },
    { path: '/settings', label: 'Settings' },
  ]);

  ngOnInit(): void {
    this.platform.workspace(this.id).subscribe({
      next: (w) => this.workspace.set(w),
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'This workspace could not load.'),
    });
  }

  toggleAdmissions(event: Event): void {
    const box = event.target as HTMLInputElement;
    const on = box.checked;
    const name = this.workspace()?.businessName;
    if (!confirm(`${on ? 'Turn on' : 'Turn off'} Admissions for ${name}?`)) {
      box.checked = !on;
      return;
    }
    this.saving.set(true);
    this.platform.setFeatures(this.id, { admissions: on }).subscribe({
      next: (summary) => {
        this.saving.set(false);
        const current = this.workspace();
        if (current) this.workspace.set({ ...current, features: summary.features });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        box.checked = !on;
        alert(err.error?.message || 'The change could not be saved.');
      },
    });
  }

  startOpen(): void {
    this.reason = '';
    this.path = '/dashboard';
    this.openError.set(null);
    this.opening.set(true);
  }

  open(): void {
    this.saving.set(true);
    this.openError.set(null);
    this.platform.openWorkspace(this.id, this.reason.trim(), this.path).subscribe({
      next: (view) => {
        this.auth.startPlatformView(view);
        // A full load so the app starts fresh inside the workspace
        window.location.assign(this.path);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.openError.set(err.error?.message || 'The workspace could not be opened.');
      },
    });
  }
}
