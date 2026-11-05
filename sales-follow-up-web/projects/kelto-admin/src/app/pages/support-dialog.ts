import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, CompanyUser, SUPPORT_PERMISSION_LABELS, SupportMode } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';
import { environment } from '../../environments/environment';

/**
 * Starts a Kelto support session and opens the company's CRM in a new tab
 * through a single-use link (valid two minutes). The CRM shows a banner for
 * the whole session; it ends on Exit, expiry or revocation.
 */
@Component({
  selector: 'ka-support-dialog',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="pf-backdrop" (click)="closed.emit()" role="presentation">
      <form class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title" (click)="$event.stopPropagation()" (ngSubmit)="start()">
        <h2 id="support-title">Support session: {{ companyName() }}</h2>

        @if (link(); as url) {
          <p>Your browser blocked the new tab. Open the workspace with this single-use link (valid for two minutes):</p>
          <a class="pf-btn pf-btn--primary" [href]="url" target="_blank" rel="noopener" (click)="closed.emit()">Open the workspace</a>
        } @else {
          <div class="pf-options" role="radiogroup" aria-label="How to open the company">
            <label class="pf-option">
              <input type="radio" name="mode" value="VIEW_OWNER" [(ngModel)]="mode" />
              <span>View as the owner<small>Read-only. Everything the owner sees.</small></span>
            </label>
            <label class="pf-option">
              <input type="radio" name="mode" value="VIEW_USER" [(ngModel)]="mode" [disabled]="!activePeople().length" />
              <span>View as a person<small>Read-only. Exactly what they see: their role, menus and records.</small></span>
            </label>
            @if (session.can('support.edit')) {
              <label class="pf-option" [class.is-disabled]="!editAllowed()">
                <input type="radio" name="mode" value="SUPPORT_EDIT" [(ngModel)]="mode" [disabled]="!editAllowed()" />
                <span>Support edit
                  <small>
                    @if (editAllowed()) {
                      Make limited changes, recorded under your name. The owner allows this until {{ editAllowedUntil() | date: 'd MMM, HH:mm' }}.
                    } @else {
                      Needs the owner's permission (Settings → Kelto support access in their workspace).
                    }
                  </small>
                </span>
              </label>
            }
          </div>

          @if (mode === 'VIEW_USER') {
            <label>Person
              <select class="pf-select" name="userId" [(ngModel)]="userId" required>
                @for (p of activePeople(); track p.id) {
                  <option [value]="p.id">{{ p.name }} · {{ p.roleName }}</option>
                }
              </select>
            </label>
          }

          @if (mode === 'SUPPORT_EDIT') {
            <fieldset class="perms">
              <legend>This session may</legend>
              @for (p of editOptions(); track p) {
                <label class="pf-switch"><input type="checkbox" [checked]="chosen().has(p)" (change)="toggle(p)" />{{ labels[p] || p }}</label>
              }
              <small>Creating or deleting records, payments, people, roles and passwords are never allowed.</small>
            </fieldset>
          }

          <label>Reason (recorded in the audit log)
            <input class="pf-input" name="reason" [(ngModel)]="reason" placeholder="For example: customer reported a missing lead" required />
          </label>
          <label>Start at
            <select class="pf-select" name="landing" [(ngModel)]="landing">
              <option value="/dashboard">Dashboard</option>
              <option value="/leads">Leads</option>
              <option value="/follow-ups">Follow-ups</option>
              <option value="/admissions/overview">Admissions</option>
              <option value="/settings">Settings</option>
            </select>
          </label>
          @if (error()) {
            <p class="pf-error">{{ error() }}</p>
          }
          <div class="pf-dialog-foot">
            <button type="button" class="pf-btn" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="pf-btn pf-btn--primary" [disabled]="busy() || !ready()">Open workspace</button>
          </div>
        }
      </form>
    </div>
  `,
  styles: `
    .perms { display: grid; gap: 8px; margin: 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; }
    .perms legend { padding: 0 6px; font-size: 13px; font-weight: 700; }
    .perms small { color: #64748b; font-size: 12px; }
  `,
})
export class SupportDialog implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);

  readonly companyId = input.required<string>();
  readonly companyName = input.required<string>();
  readonly people = input<CompanyUser[]>([]);
  readonly editAllowedUntil = input<string | null>(null);
  readonly initialMode = input<SupportMode>('VIEW_OWNER');
  readonly initialUserId = input<string | null>(null);
  readonly closed = output<void>();

  readonly labels = SUPPORT_PERMISSION_LABELS;
  readonly activePeople = computed(() => this.people().filter((p) => p.isActive));
  readonly editAllowed = computed(() => !!this.editAllowedUntil() && new Date(this.editAllowedUntil()!) > new Date());
  readonly editOptions = signal<string[]>([]);
  readonly chosen = signal(new Set<string>());
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly link = signal<string | null>(null);

  mode: SupportMode = 'VIEW_OWNER';
  userId = '';
  reason = '';
  landing = '/dashboard';

  ngOnInit(): void {
    this.mode = this.initialMode();
    this.userId = this.initialUserId() ?? this.activePeople()[0]?.id ?? '';
    if (this.session.can('support.edit')) {
      this.api.supportEditOptions().subscribe({ next: (o) => this.editOptions.set(o.permissions) });
    }
  }

  toggle(permission: string): void {
    const next = new Set(this.chosen());
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    this.chosen.set(next);
  }

  ready(): boolean {
    if (this.reason.trim().length < 5) return false;
    if (this.mode === 'VIEW_USER') return !!this.userId;
    if (this.mode === 'SUPPORT_EDIT') return this.chosen().size > 0;
    return true;
  }

  start(): void {
    // Opened now, while the click still counts as the user's: popup blockers allow it
    const tab = window.open('about:blank', '_blank');
    this.busy.set(true);
    this.error.set(null);
    this.api
      .startSupportSession(this.companyId(), {
        mode: this.mode,
        reason: this.reason.trim(),
        landingPath: this.landing,
        ...(this.mode === 'VIEW_USER' && { userId: this.userId }),
        ...(this.mode === 'SUPPORT_EDIT' && { allowedPermissions: [...this.chosen()] }),
      })
      .subscribe({
        next: ({ handoffCode }) => {
          this.busy.set(false);
          const url = `${environment.crmUrl}/support/enter?code=${encodeURIComponent(handoffCode)}`;
          if (tab) {
            tab.opener = null;
            tab.location.href = url;
            this.closed.emit();
          } else {
            this.link.set(url);
          }
        },
        error: (err: HttpErrorResponse) => {
          tab?.close();
          this.busy.set(false);
          this.error.set(err.error?.message || 'The support session could not be started.');
        },
      });
  }
}
