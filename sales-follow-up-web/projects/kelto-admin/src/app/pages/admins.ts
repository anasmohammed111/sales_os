import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminApi, PlatformAdminRow, RoleInfo } from '../core/admin-api';
import { AdminSession } from '../core/admin-session';

interface LoginRow {
  id: string;
  action: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

/**
 * Kelto platform administrators. Super admins add people with a role; the
 * temporary password is shown once and must be changed at first sign-in.
 */
@Component({
  selector: 'ka-admins',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pf-page">
      <div class="pf-head">
        <div>
          <h1>Platform administrators</h1>
          <p>Kelto staff who can use this app, and what each role allows.</p>
        </div>
        @if (session.can('admins.manage')) {
          <button type="button" class="pf-btn pf-btn--primary" (click)="startAdd()">Add administrator</button>
        }
      </div>

      @if (secret(); as s) {
        <div class="pf-card">
          <div class="pf-card-body">
            <strong>{{ s.title }}</strong>
            <p class="hint">Give this temporary password to {{ s.name }} privately. It is shown only now, and they must change it when they sign in.</p>
            <div class="pf-secret">{{ s.password }}</div>
            <button type="button" class="pf-btn pf-btn--sm" (click)="secret.set(null)">Done</button>
          </div>
        </div>
      }

      <div class="pf-card">
        @if (error()) {
          <p class="pf-error">{{ error() }}</p>
        } @else {
          <div class="pf-scroll">
            <table class="pf-table">
              <thead>
                <tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr>
              </thead>
              <tbody>
                @for (a of admins(); track a.id) {
                  <tr>
                    <td><strong>{{ a.name }}</strong><small>{{ a.email }}{{ a.id === me() ? ' · you' : '' }}</small></td>
                    <td>
                      @if (session.can('admins.manage') && a.id !== me()) {
                        <select class="pf-select" [ngModel]="a.role" (ngModelChange)="update(a, { role: $event })" [attr.aria-label]="'Role of ' + a.name">
                          @for (r of roles(); track r.key) {
                            <option [value]="r.key">{{ r.name }}</option>
                          }
                        </select>
                      } @else {
                        {{ a.roleName }}
                      }
                    </td>
                    <td>
                      <span class="pf-chip" [class.pf-chip--on]="a.isActive" [class.pf-chip--bad]="!a.isActive">{{ a.isActive ? 'Active' : 'Deactivated' }}</span>
                      @if (a.mustChangePassword) {
                        <small>Temporary password</small>
                      }
                      @if (a.lockedUntil) {
                        <small>Locked until {{ a.lockedUntil | date: 'HH:mm' }}</small>
                      }
                    </td>
                    <td>{{ a.lastLoginAt ? (a.lastLoginAt | date: 'd MMM y, HH:mm') : 'Never' }}</td>
                    <td class="actions">
                      <button type="button" class="pf-btn pf-btn--sm" (click)="showLogins(a)">Sign-ins</button>
                      @if (session.can('admins.manage') && a.id !== me()) {
                        <button type="button" class="pf-btn pf-btn--sm" (click)="update(a, { isActive: !a.isActive })">{{ a.isActive ? 'Deactivate' : 'Activate' }}</button>
                        <button type="button" class="pf-btn pf-btn--sm" (click)="reset(a)">Reset password</button>
                        <button type="button" class="pf-btn pf-btn--sm" (click)="revoke(a)">Sign out everywhere</button>
                      }
                    </td>
                  </tr>
                  @if (logins()?.id === a.id) {
                    <tr>
                      <td colspan="5">
                        @for (l of logins()!.items; track l.id) {
                          <small>{{ l.createdAt | date: 'd MMM y, HH:mm' }} · {{ loginLabel(l) }} · {{ l.ip || 'unknown IP' }}</small>
                        } @empty {
                          <small>No sign-ins recorded.</small>
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="pf-card">
        <div class="pf-card-head"><h2>Roles</h2></div>
        <div class="pf-card-body roles">
          @for (r of roles(); track r.key) {
            <div><strong>{{ r.name }}</strong><small>{{ describeRole(r) }}</small></div>
          }
        </div>
      </div>
    </section>

    @if (adding()) {
      <div class="pf-backdrop" (click)="adding.set(false)" role="presentation">
        <form class="pf-dialog" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (ngSubmit)="add()">
          <h2>Add administrator</h2>
          <label>Name <input class="pf-input" name="name" [(ngModel)]="draft.name" required /></label>
          <label>Email (used to sign in) <input class="pf-input" type="email" name="email" [(ngModel)]="draft.email" required /></label>
          <label>Role
            <select class="pf-select" name="role" [(ngModel)]="draft.role">
              @for (r of roles(); track r.key) {
                <option [value]="r.key">{{ r.name }}</option>
              }
            </select>
          </label>
          @if (addError()) {
            <p class="pf-error">{{ addError() }}</p>
          }
          <div class="pf-dialog-foot">
            <button type="button" class="pf-btn" (click)="adding.set(false)">Cancel</button>
            <button type="submit" class="pf-btn pf-btn--primary" [disabled]="busy() || !draft.name.trim() || !draft.email.trim()">Add</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .hint { margin: 0; color: #64748b; font-size: 13px; }
    .actions .pf-btn { margin-left: 6px; }
    .roles { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .roles small { display: block; color: #64748b; font-size: 12.5px; line-height: 1.5; }
  `,
})
export class AdminsPage implements OnInit {
  private readonly api = inject(AdminApi);
  readonly session = inject(AdminSession);

  readonly admins = signal<PlatformAdminRow[]>([]);
  readonly roles = signal<RoleInfo[]>([]);
  readonly permissionNames = signal<Record<string, string>>({});
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);
  readonly secret = signal<{ title: string; name: string; password: string } | null>(null);
  readonly logins = signal<{ id: string; items: LoginRow[] } | null>(null);
  draft = { name: '', email: '', role: 'SUPPORT_ADMIN' };

  me = () => this.session.profile()?.id;

  ngOnInit(): void {
    this.load();
    this.api.roles().subscribe({
      next: (r) => {
        this.roles.set(r.roles);
        this.permissionNames.set(r.permissions);
      },
    });
  }

  load(): void {
    this.api.admins().subscribe({
      next: (r) => this.admins.set(r.items),
      error: (err: HttpErrorResponse) => this.error.set(err.error?.message || 'Administrators could not load.'),
    });
  }

  describeRole(r: RoleInfo): string {
    const names = this.permissionNames();
    return r.permissions.map((p) => names[p] ?? p).join('; ');
  }

  loginLabel(l: LoginRow): string {
    if (l.action === 'LOGIN') return 'Signed in';
    if (l.action === 'PASSWORD_CHANGED') return 'Changed password';
    return `Failed sign-in (${(l.details['why'] as string) ?? 'unknown'})`;
  }

  startAdd(): void {
    this.draft = { name: '', email: '', role: 'SUPPORT_ADMIN' };
    this.addError.set(null);
    this.adding.set(true);
  }

  add(): void {
    this.busy.set(true);
    this.api.createAdmin({ name: this.draft.name.trim(), email: this.draft.email.trim(), role: this.draft.role }).subscribe({
      next: ({ admin, temporaryPassword }) => {
        this.busy.set(false);
        this.adding.set(false);
        this.secret.set({ title: `${admin.name} was added`, name: admin.name, password: temporaryPassword });
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.addError.set(err.error?.message || 'The administrator could not be added.');
      },
    });
  }

  update(a: PlatformAdminRow, changes: { role?: string; isActive?: boolean }): void {
    if (changes.isActive === false && !confirm(`Deactivate ${a.name}? They are signed out at once.`)) return;
    this.api.updateAdmin(a.id, changes).subscribe({
      next: () => this.load(),
      error: (err: HttpErrorResponse) => {
        alert(err.error?.message || 'The change could not be saved.');
        this.load();
      },
    });
  }

  reset(a: PlatformAdminRow): void {
    if (!confirm(`Give ${a.name} a new temporary password? They are signed out at once.`)) return;
    this.api.resetAdminPassword(a.id).subscribe({
      next: ({ temporaryPassword }) => {
        this.secret.set({ title: `New temporary password for ${a.name}`, name: a.name, password: temporaryPassword });
        this.load();
      },
      error: (err: HttpErrorResponse) => alert(err.error?.message || 'The password could not be reset.'),
    });
  }

  revoke(a: PlatformAdminRow): void {
    if (!confirm(`Sign ${a.name} out of every device and end their support sessions?`)) return;
    this.api.revokeAdminSessions(a.id).subscribe({
      next: () => this.load(),
      error: (err: HttpErrorResponse) => alert(err.error?.message || 'This could not be done.'),
    });
  }

  showLogins(a: PlatformAdminRow): void {
    if (this.logins()?.id === a.id) {
      this.logins.set(null);
      return;
    }
    this.api.adminLogins(a.id).subscribe({ next: (r) => this.logins.set({ id: a.id, items: r.items }) });
  }
}
