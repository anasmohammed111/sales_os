import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Task } from '../admissions.models';
import { dayKey, errorMessage } from '../admissions.utils';
import { TaskRow } from '../shared/task-row';

@Component({
  selector: 'adm-my-tasks',
  imports: [TaskRow],
  template: `
    <div class="adm-page">
      <header class="adm-head">
        <div>
          <h1 class="adm-title">{{ staff() === '' ? 'My tasks' : 'Tasks' }}</h1>
          <p class="adm-sub">Follow-ups for your students, earliest first. Times are shown in {{ tz() }}.</p>
        </div>
        @if (canFilter()) {
          <label class="adm-filters">
            <span class="adm-visually-hidden">Whose tasks</span>
            <select [value]="staff()" (change)="setStaff($any($event.target).value)">
              <option value="">Mine</option>
              <option value="ALL">{{ ctx()?.isAdmin ? 'Everyone' : 'My team' }}</option>
              @for (c of ctx()?.counsellors; track c._id) {
                @if (c._id !== ctx()?.userId) {
                  <option [value]="c._id">{{ c.name }}</option>
                }
              }
            </select>
          </label>
        }
      </header>

      @if (error(); as message) {
        <div class="adm-panel adm-state"><strong>{{ message }}</strong><button type="button" class="adm-btn" (click)="load()">Try again</button></div>
      } @else if (loading()) {
        <div class="adm-skeleton" style="height: 280px"></div>
      } @else if (!tasks().length) {
        <div class="adm-panel adm-state">
          <strong>Nothing to follow up</strong>
          <span>Add follow-ups from a student's profile and they will show here.</span>
        </div>
      } @else {
        @for (group of groups(); track group.key) {
          @if (group.items.length) {
            <section class="group">
              <h2 [class.is-warn]="group.key === 'overdue'">
                {{ group.label }} <span class="adm-num">{{ group.items.length }}</span>
              </h2>
              <div class="adm-panel list">
                @for (task of group.items; track task.id) {
                  <adm-task-row [task]="task" [showStudent]="true" [showAssignee]="staff() !== ''" (changed)="load()" />
                }
              </div>
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    .group { display: grid; gap: 8px; }
    h2 { margin: 0; color: var(--adm-ink); font-size: 15px; font-weight: 800; }
    h2 span { margin-left: 6px; color: var(--adm-muted); font-weight: 700; }
    h2.is-warn { color: var(--adm-warn); }
    .list { overflow: hidden; }
    .list adm-task-row + adm-task-row { display: block; border-top: 1px solid #f1f5f9; }
    .adm-filters select { min-width: 180px; }
  `,
})
export class MyTasks implements OnInit {
  private readonly admissions = inject(AdmissionsService);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone || 'Asia/Kolkata');
  readonly canFilter = computed(() => this.ctx()?.role !== 'SALESPERSON' && (this.ctx()?.counsellors.length ?? 0) > 1);

  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly staff = signal('');

  readonly groups = computed(() => {
    const now = new Date();
    const today = dayKey(now, this.tz());
    const overdue: Task[] = [];
    const todays: Task[] = [];
    const upcoming: Task[] = [];
    for (const task of this.tasks()) {
      const at = new Date(task.scheduledAt);
      if (at < now) overdue.push(task);
      else if (dayKey(at, this.tz()) === today) todays.push(task);
      else upcoming.push(task);
    }
    return [
      { key: 'overdue', label: 'Overdue', items: overdue },
      { key: 'today', label: 'Today', items: todays },
      { key: 'upcoming', label: 'Upcoming', items: upcoming },
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  setStaff(value: string): void {
    this.staff.set(value);
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.admissions.listTasks(this.staff() ? { assignedTo: this.staff() } : {}).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'Tasks could not load.'));
      },
    });
  }
}
