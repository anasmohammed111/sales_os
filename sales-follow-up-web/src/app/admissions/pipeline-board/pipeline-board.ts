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
  relativeDay,
  WARNING_LABELS,
  WARNING_TONE,
} from '../admissions.utils';
import { MoveRequest, StageMoveDialog } from '../shared/stage-move-dialog';

interface Column extends StageRef {
  order: number;
  isArchived: boolean;
  items: Application[];
}

@Component({
  selector: 'adm-pipeline-board',
  imports: [StageMoveDialog, NgTemplateOutlet],
  templateUrl: './pipeline-board.html',
  styleUrl: './pipeline-board.scss',
})
export class PipelineBoard implements OnInit {
  private readonly admissions = inject(AdmissionsService);
  private readonly router = inject(Router);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly showCounsellor = computed(() => (this.ctx()?.counsellors.length ?? 0) > 1);

  readonly applications = signal<Application[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filters = signal<Query>({});

  readonly dragId = signal<string | null>(null);
  readonly dropKey = signal<string | null>(null);
  readonly movingId = signal<string | null>(null);
  readonly moveRequest = signal<MoveRequest | null>(null);
  readonly pickerFor = signal<Application | null>(null);
  readonly mobileStage = signal<string | null>(null);

  readonly warningLabels = WARNING_LABELS;
  readonly warningTone = WARNING_TONE;
  readonly initials = initials;
  readonly intakeLabel = intakeLabel;

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
      .map((s) => ({ key: s.key, name: s.name, order: s.order, isArchived: s.isArchived, items: byStage.get(s.key) || [] }));
  });

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

  onSearch(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.setFilter('search', value.trim()), 300);
  }

  open(app: Application): void {
    this.router.navigate(['/admissions/students', app.id]);
  }

  // The card template variable is untyped, so warnings go through typed helpers
  toneOf(w: Warning): string {
    return this.warningTone[w];
  }

  labelOf(w: Warning): string {
    return this.warningLabels[w];
  }

  universityOf(app: Application): string {
    const choice = app.finalChoice?.universityName ? app.finalChoice : app.shortlist?.[0];
    if (!choice?.universityName) return '';
    return choice.courseName ? `${choice.universityName}, ${choice.courseName}` : choice.universityName;
  }

  followUp(app: Application): string {
    return app.nextFollowUpAt ? relativeDay(app.nextFollowUpAt, this.tz()) : 'none';
  }

  // Drag and drop (desktop). The server validates every move.
  onDragStart(event: DragEvent, app: Application): void {
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
