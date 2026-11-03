import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdmissionsService } from '../../core/services/admissions.service';
import { ApplicationDetail, MissingItem } from '../admissions.models';
import { errorMessage } from '../admissions.utils';

export interface MoveRequest {
  applicationId: string;
  studentName: string;
  fromStageKey: string;
  toStageKey: string;
  toStageName: string;
}

/**
 * Tries a stage move. Shows nothing when it succeeds; otherwise explains
 * exactly what is missing. Admins can override with a reason.
 */
@Component({
  selector: 'adm-stage-move-dialog',
  imports: [FormsModule],
  templateUrl: './stage-move-dialog.html',
  styles: `
  .missing {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .missing li {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--adm-line);
    border-left: 3px solid var(--adm-warn);
    border-radius: 8px;
    font-size: 13.5px;
  }

  .missing strong {
    color: var(--adm-ink);
    font-weight: 650;
  }

  .missing span {
    color: var(--adm-muted);
    font-size: 12.5px;
  }
`,
})
export class StageMoveDialog {
  private readonly admissions = inject(AdmissionsService);

  readonly request = input<MoveRequest | null>(null);
  readonly isAdmin = input(false);
  readonly moved = output<ApplicationDetail>();
  readonly closed = output<void>();
  /** The record changed elsewhere; the parent should reload. */
  readonly stale = output<void>();

  readonly busy = signal(false);
  readonly blocked = signal<{ message: string; missing: MissingItem[]; gateError: string | null } | null>(null);
  readonly error = signal<string | null>(null);
  readonly reason = signal('');

  constructor() {
    effect(() => {
      const request = this.request();
      this.blocked.set(null);
      this.error.set(null);
      this.reason.set('');
      if (request) this.attempt(request, false);
    });
  }

  attempt(request: MoveRequest, override: boolean): void {
    this.busy.set(true);
    this.admissions
      .moveStage(request.applicationId, {
        fromStageKey: request.fromStageKey,
        toStageKey: request.toStageKey,
        override,
        reason: override ? this.reason() : undefined,
      })
      .subscribe({
        next: (detail) => {
          this.busy.set(false);
          this.moved.emit(detail);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          if (err.error?.code === 'STAGE_REQUIREMENTS_MISSING') {
            this.blocked.set({
              message: err.error.message,
              missing: err.error.data?.missing ?? [],
              gateError: err.error.data?.gateError ?? null,
            });
          } else if (err.error?.code === 'STAGE_CONFLICT') {
            this.stale.emit();
            this.error.set(err.error.message);
          } else {
            this.error.set(errorMessage(err, 'The stage could not be changed.'));
          }
        },
      });
  }

  override(): void {
    const request = this.request();
    if (request) this.attempt(request, true);
  }
}
