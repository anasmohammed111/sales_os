import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Activity, ApplicationDetail } from '../admissions.models';
import { errorMessage, formatDateTime, initials } from '../admissions.utils';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

@Component({
  selector: 'adm-profile-activity',
  imports: [FormsModule, CanDirective],
  template: `
    <form *ktCan="'admissions.edit'" class="adm-panel composer" (ngSubmit)="addNote()">
      <label class="adm-visually-hidden" for="note">Add a note</label>
      <textarea id="note" name="note" [(ngModel)]="note" rows="3" placeholder="Add a note: a call summary, what the parents said, anything the team should know"></textarea>
      <div class="composer-foot">
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="saving() || !note.trim()">Add note</button>
      </div>
    </form>

    <div class="filters adm-segmented" role="group" aria-label="Show">
      <button type="button" [attr.aria-pressed]="!notesOnly()" (click)="notesOnly.set(false)">Everything</button>
      <button type="button" [attr.aria-pressed]="notesOnly()" (click)="notesOnly.set(true)">Notes only</button>
    </div>

    @if (loading()) {
      <div class="adm-skeleton" style="height: 200px"></div>
    } @else {
      <ol class="timeline">
        @for (entry of shown(); track entry.id) {
          <li [class.is-note]="entry.type === 'NOTE'">
            <span class="adm-avatar">{{ initials(entry.actor?.name || 'System') }}</span>
            <div>
              <p class="line">
                <strong>{{ entry.actor?.name || 'System' }}</strong>
                @if (entry.type !== 'NOTE') { {{ entry.message }} }
              </p>
              @if (entry.type === 'NOTE') {
                <p class="body">{{ entry.body }}</p>
              }
              <time [attr.datetime]="entry.createdAt">{{ formatDateTime(entry.createdAt, tz()) }}</time>
            </div>
          </li>
        } @empty {
          <li class="empty">Nothing recorded yet.</li>
        }
      </ol>
    }
  `,
  styles: `
    .composer { display: grid; gap: 8px; padding: 12px; margin-bottom: 14px; }
    .composer textarea { width: 100%; min-height: 72px; padding: 10px; border: 1px solid var(--adm-line-strong); border-radius: 10px; font: inherit; font-size: 14px; resize: vertical; }
    .composer textarea:focus { outline: none; border-color: var(--adm-route); box-shadow: var(--focus-ring, 0 0 0 3px rgba(37,99,235,.2)); }
    .composer-foot { display: flex; justify-content: flex-end; }
    .filters { margin-bottom: 10px; }
    .timeline { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .timeline li { display: grid; grid-template-columns: 28px 1fr; gap: 12px; padding: 12px 4px; border-top: 1px solid #f1f5f9; }
    .timeline li:first-child { border-top: 0; }
    .line { margin: 0; color: var(--adm-ink-2); font-size: 13.5px; }
    .line strong { color: var(--adm-ink); }
    .body { margin: 6px 0 0; padding: 10px 12px; border-radius: 10px; background: #f9fafb; color: var(--adm-ink); font-size: 14px; white-space: pre-wrap; }
    time { display: block; margin-top: 4px; color: var(--adm-faint); font-size: 12px; }
    .empty { display: block !important; color: var(--adm-muted); font-size: 13.5px; }
  `,
})
export class ProfileActivity {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  readonly tz = computed(() => this.admissions.context()?.config.timezone);

  readonly entries = signal<Activity[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly notesOnly = signal(false);
  readonly shown = computed(() => (this.notesOnly() ? this.entries().filter((e) => e.type === 'NOTE') : this.entries()));
  note = '';

  readonly initials = initials;
  readonly formatDateTime = formatDateTime;

  constructor() {
    effect(() => {
      this.application().updatedAt;
      this.load();
    });
  }

  load(): void {
    this.admissions.listActivity(this.application().id).subscribe({
      next: (entries) => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        toast.error(errorMessage(err, 'History could not load.'));
      },
    });
  }

  addNote(): void {
    this.saving.set(true);
    this.admissions.addNote(this.application().id, this.note.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.note = '';
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        toast.error(errorMessage(err, 'The note could not be saved.'));
      },
    });
  }
}
