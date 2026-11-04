import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Application, Query } from '../admissions.models';
import {
  errorMessage,
  formatTime,
  initials,
  intakeLabel,
  LEVEL_LABELS,
  MONTH_OPTIONS,
  relativeDay,
  WARNING_LABELS,
  WARNING_TONE,
} from '../admissions.utils';
import { AddStudent } from './add-student';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

const PAGE_SIZE = 50;

/** Filters that live in the URL, so dashboard cards can link straight to a filtered list. */
const FILTER_KEYS = [
  'search',
  'stage',
  'studyLevel',
  'intakeMonth',
  'intakeYear',
  'counsellorId',
  'universityId',
  'status',
  'overdue',
  'stuck',
  'needsReview',
  'paymentStatus',
  'visaOutcome',
  'createdFrom',
  'createdTo',
  'visaFrom',
  'visaTo',
  'sort',
] as const;

@Component({
  selector: 'adm-students',
  imports: [FormsModule, AddStudent, CanDirective],
  templateUrl: './students.html',
  styleUrl: './students.scss',
})
export class Students implements OnInit {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly stages = computed(() => (this.ctx()?.config.stages || []).filter((s) => !s.isArchived));
  readonly showCounsellor = computed(() => (this.ctx()?.counsellors.length ?? 0) > 1);
  readonly months = MONTH_OPTIONS;
  readonly years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i);

  readonly filters = signal<Query>({});
  readonly items = signal<Application[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly adding = signal(false);
  readonly exporting = signal(false);

  readonly hasPeriodFilter = computed(() =>
    ['createdFrom', 'createdTo', 'visaFrom', 'visaTo'].some((k) => this.filters()[k])
  );
  readonly activeFilterCount = computed(
    () => Object.entries(this.filters()).filter(([k, v]) => v && k !== 'search' && k !== 'sort').length
  );

  readonly levelLabels = LEVEL_LABELS;
  readonly warningLabels = WARNING_LABELS;
  readonly warningTone = WARNING_TONE;
  readonly intakeLabel = intakeLabel;
  readonly initials = initials;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const next: Query = {};
      for (const key of FILTER_KEYS) {
        const value = params.get(key);
        if (value) next[key] = value;
      }
      this.filters.set(next);
      this.load(1);
    });
  }

  load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.admissions.listApplications({ ...this.filters(), page: String(page), limit: String(PAGE_SIZE) }).subscribe({
      next: (result) => {
        this.items.set(page === 1 ? result.items : [...this.items(), ...result.items]);
        this.total.set(result.total);
        this.page.set(page);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'Students could not load.'));
        this.loading.set(false);
      },
    });
  }

  setFilter(key: string, value: string | null): void {
    const next = { ...this.filters() };
    if (value) next[key] = value;
    else delete next[key];
    this.router.navigate([], { relativeTo: this.route, queryParams: next, replaceUrl: true });
  }

  toggle(key: 'overdue' | 'stuck' | 'needsReview'): void {
    this.setFilter(key, this.filters()[key] ? null : '1');
  }

  onSearch(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.setFilter('search', value.trim() || null), 300);
  }

  clearFilters(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  open(application: Application): void {
    this.router.navigate(['/admissions/students', application.id]);
  }

  onCreated(application: Application): void {
    this.adding.set(false);
    toast.success(`${application.student.name} added`);
    this.open(application);
  }

  export(format: 'csv' | 'xlsx'): void {
    this.exporting.set(true);
    this.admissions.download('applications/export', { ...this.filters(), format }).subscribe({
      next: () => this.exporting.set(false),
      error: (err) => {
        this.exporting.set(false);
        toast.error(errorMessage(err, 'The export could not be created.'));
      },
    });
  }

  followUpText(app: Application): string {
    if (!app.nextFollowUpAt) return 'Not set';
    return `${relativeDay(app.nextFollowUpAt, this.tz())}, ${formatTime(app.nextFollowUpAt, this.tz())}`;
  }
}
