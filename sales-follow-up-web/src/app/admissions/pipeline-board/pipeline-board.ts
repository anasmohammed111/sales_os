import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Application, ApplicationDetail, Query, StageRef, Warning } from '../admissions.models';
import {
  errorMessage,
  initials,
  intakeLabel,
  LEVEL_LABELS,
  relativeDay,
  WARNING_LABELS,
  WARNING_TONE,
} from '../admissions.utils';
import { MoveRequest, StageMoveDialog } from '../shared/stage-move-dialog';
import { menuOpensUp } from '../../core/utils/menu-placement';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';
import { ColumnSearch } from '../../shared/column-search/column-search';

interface Column extends StageRef {
  order: number;
  isArchived: boolean;
  color: string;
  stuck: number;
  items: Application[];
}

type ProfileTab = 'checklist' | 'overview' | 'documents' | 'payments' | 'tasks' | 'activity';

/** The one warning a card shows as a pill, most serious first */
const WARNING_PRIORITY: Warning[] = ['NEEDS_REVIEW', 'PAYMENT_OVERDUE', 'STUCK', 'FOLLOW_UP_OVERDUE', 'UNASSIGNED'];

@Component({
  selector: 'adm-pipeline-board',
  imports: [StageMoveDialog, NgTemplateOutlet, CanDirective],
  templateUrl: './pipeline-board.html',
  styleUrl: './pipeline-board.scss',
})
export class PipelineBoard implements OnInit {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);
  private readonly router = inject(Router);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly showCounsellor = computed(() => (this.ctx()?.counsellors.length ?? 0) > 1);

  readonly applications = signal<Application[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filters = signal<Query>({});
  readonly searchText = signal('');

  readonly dragId = signal<string | null>(null);
  readonly dropKey = signal<string | null>(null);
  readonly movingId = signal<string | null>(null);
  readonly moveRequest = signal<MoveRequest | null>(null);
  readonly pickerFor = signal<Application | null>(null);
  readonly menuFor = signal<string | null>(null);
  /** The open card menu flips up near the bottom of a column */
  readonly menuUp = signal(false);
  readonly mobileStage = signal<string | null>(null);

  readonly initials = initials;
  readonly intakeLabel = intakeLabel;

  readonly hasActiveFilters = computed(() => Object.keys(this.filters()).length > 0);

  /** KPI tiles; they count what the board is showing */
  readonly stats = computed(() => {
    const apps = this.applications();
    return {
      total: apps.length,
      stuck: apps.filter((a) => a.isStuck).length,
      followUpOverdue: apps.filter((a) => a.isFollowUpOverdue).length,
      paymentOverdue: apps.filter((a) => a.isPaymentOverdue).length,
    };
  });

  readonly columns = computed<Column[]>(() => {
    const stages = [...(this.ctx()?.config.stages || [])].sort((a, b) => a.order - b.order);
    const byStage = new Map<string, Application[]>();
    for (const app of this.applications()) {
      const list = byStage.get(app.currentStage.key) || [];
      list.push(app);
      byStage.set(app.currentStage.key, list);
    }
    return stages
      .filter((s) => !s.isArchived || byStage.has(s.key))
      .map((s) => {
        const items = byStage.get(s.key) || [];
        return {
          key: s.key,
          name: s.name,
          order: s.order,
          isArchived: s.isArchived,
          // Stages have no colour of their own; walk the Kelto chart palette in stage order
          color: `var(--kelto-chart-${((s.order - 1) % 8 + 8) % 8 + 1})`,
          stuck: items.filter((a) => a.isStuck).length,
          items,
        };
      });
  });

  /** A search box inside each column, narrowing that column's students */
  readonly columnSearch = new ColumnSearch();
  readonly visibleItems = computed(
    () =>
      new Map(
        this.columns().map((col) => [
          col.key,
          this.columnSearch.apply(col.key, col.items, (a) => [
            a.student.name,
            a.student.phone,
            a.student.email,
            a.student.city,
            a.finalChoice?.universityName,
            a.finalChoice?.courseName,
          ]),
        ])
      )
  );

  readonly activeStages = computed(() => this.columns().filter((c) => !c.isArchived));
  readonly selectedColumn = computed(() => {
    const key = this.mobileStage() ?? this.columns().find((c) => c.items.length)?.key ?? this.columns()[0]?.key;
    return this.columns().find((c) => c.key === key) ?? null;
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admissions.listApplications({ ...this.filters(), limit: '500', sort: 'stage' }).subscribe({
      next: (result) => {
        this.applications.set(result.items);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'The pipeline could not load.'));
        this.loading.set(false);
      },
    });
  }

  setFilter(key: string, value: string): void {
    const next = { ...this.filters() };
    if (value) next[key] = value;
    else delete next[key];
    this.filters.set(next);
    this.load();
  }

  /** KPI tiles switch their filter on and off */
  toggleFilter(key: string, value = '1'): void {
    this.setFilter(key, this.filters()[key] === value ? '' : value);
  }

  onSearch(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.setFilter('search', value.trim()), 300);
  }

  clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchText.set('');
    this.setFilter('search', '');
  }

  clearFilters(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchText.set('');
    this.filters.set({});
    this.load();
  }

  goToStudents(): void {
    this.router.navigate(['/admissions/students']);
  }

  open(app: Application): void {
    this.menuFor.set(null);
    this.router.navigate(['/admissions/students', app.id]);
  }

  /** Enter on the card itself; Enter on a button inside it is that button's */
  onCardKey(event: Event, app: Application): void {
    if (event.target === event.currentTarget) this.open(app);
  }

  openTab(app: Application, tab: ProfileTab): void {
    this.menuFor.set(null);
    this.router.navigate(['/admissions/students', app.id], { queryParams: { tab } });
  }

  toggleMenu(event: Event, app: Application): void {
    event.stopPropagation();
    const opening = this.menuFor() !== app.id;
    if (opening) this.menuUp.set(menuOpensUp(event.currentTarget));
    this.menuFor.set(opening ? app.id : null);
  }

  closeMenu(): void {
    this.menuFor.set(null);
  }

  openPicker(app: Application): void {
    this.menuFor.set(null);
    this.pickerFor.set(app);
  }

  // The card template variable is untyped, so card values go through typed helpers
  topWarning(app: Application): Warning | null {
    return WARNING_PRIORITY.find((w) => app.warnings.includes(w)) ?? null;
  }

  levelOf(app: Application): string {
    return LEVEL_LABELS[app.studyLevel];
  }

  toneOf(w: Warning): string {
    return WARNING_TONE[w];
  }

  labelOf(w: Warning): string {
    return WARNING_LABELS[w];
  }

  /** Left edge colour: red for review or money problems, amber for time problems */
  cardTone(app: Application): 'bad' | 'warn' | null {
    if (app.needsReview || app.isPaymentOverdue) return 'bad';
    if (app.isStuck || app.isFollowUpOverdue) return 'warn';
    return null;
  }

  /** How far through the stage's time limit the student is */
  stagePercent(app: Application): number {
    return Math.min(100, Math.round((app.daysInStage / Math.max(1, app.stuckThresholdDays)) * 100));
  }

  universityOf(app: Application): string {
    const choice = app.finalChoice?.universityName ? app.finalChoice : app.shortlist?.[0];
    if (!choice?.universityName) return '';
    return choice.courseName ? `${choice.universityName}, ${choice.courseName}` : choice.universityName;
  }

  followUpText(app: Application): string {
    return app.nextFollowUpAt ? `Follow-up ${relativeDay(app.nextFollowUpAt, this.tz())}` : 'No follow-up set';
  }

  // Drag and drop (desktop). The server validates every move.
  onDragStart(event: DragEvent, app: Application): void {
    this.menuFor.set(null);
    this.dragId.set(app.id);
    event.dataTransfer?.setData('text/plain', app.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd(): void {
    this.dragId.set(null);
    this.dropKey.set(null);
  }

  onDragOver(event: DragEvent, column: Column): void {
    if (column.isArchived || !this.dragId()) return;
    event.preventDefault();
    this.dropKey.set(column.key);
  }

  onDrop(event: DragEvent, column: Column): void {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') || this.dragId();
    this.onDragEnd();
    const app = this.applications().find((a) => a.id === id);
    if (app && !column.isArchived) this.requestMove(app, column);
  }

  requestMove(app: Application, target: StageRef): void {
    this.pickerFor.set(null);
    this.menuFor.set(null);
    if (app.currentStage.key === target.key) return;
    this.movingId.set(app.id);
    this.moveRequest.set({
      applicationId: app.id,
      studentName: app.student.name,
      fromStageKey: app.currentStage.key,
      toStageKey: target.key,
      toStageName: target.name,
    });
  }

  onMoved(detail: ApplicationDetail): void {
    this.applications.update((list) => list.map((a) => (a.id === detail.id ? detail : a)));
    toast.success(`${detail.student.name} moved to ${detail.currentStage.name}`);
    this.closeMove();
  }

  closeMove(): void {
    this.moveRequest.set(null);
    this.movingId.set(null);
  }

  onStale(): void {
    this.load();
  }
}
