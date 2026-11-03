import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { ApplicationDetail, Task, TaskPriority, TaskType } from '../admissions.models';
import { errorMessage, fromLocalInput, TASK_TYPE_LABELS, toLocalInput } from '../admissions.utils';
import { TaskRow } from '../shared/task-row';

@Component({
  selector: 'adm-profile-tasks',
  imports: [FormsModule, TaskRow],
  template: `
    <div class="head">
      <p class="adm-muted">Follow-ups for this application. They also appear in the assigned person's task list.</p>
      <button type="button" class="adm-btn adm-btn--primary" (click)="startAdd()">Add follow-up</button>
    </div>

    @if (adding()) {
      <form class="adm-panel adm-panel__body adm-form add" (ngSubmit)="add()">
        <div class="adm-form-row">
          <label class="adm-field">
            <span>Type</span>
            <select name="type" [(ngModel)]="type">
              @for (t of types; track t[0]) {
                <option [value]="t[0]">{{ t[1] }}</option>
              }
            </select>
          </label>
          <label class="adm-field">
            <span>When</span>
            <input type="datetime-local" name="when" [(ngModel)]="when" required />
          </label>
          <label class="adm-field">
            <span>Priority</span>
            <select name="priority" [(ngModel)]="priority">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          @if (canAssign()) {
            <label class="adm-field">
              <span>For</span>
              <select name="assignedTo" [(ngModel)]="assignedTo">
                @for (c of ctx()?.counsellors; track c._id) {
                  <option [value]="c._id">{{ c.name }}</option>
                }
              </select>
            </label>
          }
        </div>
        <label class="adm-field">
          <span>What needs doing</span>
          <input name="title" [(ngModel)]="title" placeholder="For example: call about pending transcripts" />
        </label>
        <div class="foot">
          <button type="button" class="adm-btn" (click)="adding.set(false)">Cancel</button>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="saving() || !when">Add follow-up</button>
        </div>
      </form>
    }

    @if (loading()) {
      <div class="adm-skeleton" style="height: 120px"></div>
    } @else if (!tasks().length) {
      <div class="adm-panel adm-state">
        <strong>No follow-ups yet</strong>
        <span>Every active student should have a next follow-up date.</span>
      </div>
    } @else {
      <div class="adm-panel list">
        @for (task of tasks(); track task.id) {
          <adm-task-row [task]="task" [showAssignee]="true" (changed)="onChanged()" />
        }
      </div>
    }
  `,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .head p { margin: 0; font-size: 13.5px; }
    .add { margin-bottom: 12px; }
    .foot { display: flex; justify-content: flex-end; gap: 8px; }
    .list { overflow: hidden; }
    .list adm-task-row + adm-task-row { display: block; border-top: 1px solid #f1f5f9; }
  `,
})
export class ProfileTasks {
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  readonly updated = output<void>();

  readonly ctx = this.admissions.context;
  readonly canAssign = computed(() => this.ctx()?.role !== 'SALESPERSON');

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly adding = signal(false);
  readonly saving = signal(false);

  readonly types = Object.entries(TASK_TYPE_LABELS) as [TaskType, string][];
  type: TaskType = 'CALL';
  when = '';
  priority: TaskPriority = 'MEDIUM';
  title = '';
  assignedTo = '';

  constructor() {
    effect(() => {
      this.application().id;
      this.load();
    });
  }

  load(): void {
    this.admissions.listApplicationTasks(this.application().id).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        toast.error(errorMessage(err, 'Follow-ups could not load.'));
      },
    });
  }

  startAdd(): void {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(11, 0, 0, 0);
    this.when = toLocalInput(tomorrow);
    this.assignedTo = this.application().counsellorId || this.ctx()?.userId || '';
    this.title = '';
    this.adding.set(true);
  }

  add(): void {
    this.saving.set(true);
    this.admissions
      .createTask(this.application().id, {
        type: this.type,
        title: this.title,
        scheduledAt: fromLocalInput(this.when),
        priority: this.priority,
        ...(this.canAssign() && this.assignedTo ? { assignedTo: this.assignedTo } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.adding.set(false);
          toast.success('Follow-up added');
          this.onChanged();
        },
        error: (err) => {
          this.saving.set(false);
          toast.error(errorMessage(err, 'The follow-up could not be added.'));
        },
      });
  }

  onChanged(): void {
    this.load();
    this.updated.emit();
  }
}
