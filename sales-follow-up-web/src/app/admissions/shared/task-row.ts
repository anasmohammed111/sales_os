import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Task } from '../admissions.models';
import {
  errorMessage,
  formatDateTime,
  formatTime,
  fromLocalInput,
  PRIORITY_LABELS,
  relativeDay,
  TASK_TYPE_LABELS,
  toLocalInput,
} from '../admissions.utils';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

/** One follow-up with complete / reschedule / cancel. Used by My tasks and the profile. */
@Component({
  selector: 'adm-task-row',
  imports: [FormsModule, RouterLink, CanDirective],
  templateUrl: './task-row.html',
  styleUrl: './task-row.scss',
})
export class TaskRow {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);

  readonly task = input.required<Task>();
  readonly showStudent = input(false);
  readonly showAssignee = input(false);
  readonly changed = output<Task>();

  readonly tz = computed(() => this.admissions.context()?.config.timezone);
  readonly overdue = computed(() => this.task().status === 'PENDING' && new Date(this.task().scheduledAt) < new Date());

  readonly rescheduling = signal(false);
  readonly completing = signal(false);
  readonly busy = signal(false);
  newTime = '';
  outcome = '';

  readonly typeLabels = TASK_TYPE_LABELS;
  readonly priorityLabels = PRIORITY_LABELS;

  when(): string {
    const at = this.task().scheduledAt;
    return `${relativeDay(at, this.tz())}, ${formatTime(at, this.tz())}`;
  }

  fullWhen(): string {
    return formatDateTime(this.task().scheduledAt, this.tz());
  }

  startReschedule(): void {
    this.newTime = toLocalInput(this.task().scheduledAt);
    this.rescheduling.set(true);
  }

  private save(body: Record<string, unknown>, message: string): void {
    this.busy.set(true);
    this.admissions.updateTask(this.task().id, body).subscribe({
      next: (task) => {
        this.busy.set(false);
        this.rescheduling.set(false);
        this.completing.set(false);
        this.outcome = '';
        toast.success(message);
        this.changed.emit(task);
      },
      error: (err) => {
        this.busy.set(false);
        toast.error(errorMessage(err, 'The task could not be updated.'));
      },
    });
  }

  complete(): void {
    this.save({ status: 'COMPLETED', ...(this.outcome.trim() && { outcome: this.outcome.trim() }) }, 'Marked done');
  }

  reschedule(): void {
    if (this.newTime) this.save({ scheduledAt: fromLocalInput(this.newTime) }, `Moved to ${formatDateTime(fromLocalInput(this.newTime), this.tz())}`);
  }

  cancel(): void {
    this.save({ status: 'CANCELLED' }, 'Task cancelled');
  }

  reopen(): void {
    this.save({ status: 'PENDING' }, 'Task reopened');
  }
}
