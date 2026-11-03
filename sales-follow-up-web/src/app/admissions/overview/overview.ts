import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AdmissionsService } from '../../core/services/admissions.service';
import { DashboardData, Query } from '../admissions.models';
import { errorMessage, formatDate, money, MONTH_OPTIONS } from '../admissions.utils';
import { JourneyRail, RailStage } from '../shared/journey-rail';

@Component({
  selector: 'adm-overview',
  imports: [JourneyRail, RouterLink],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit {
  private readonly admissions = inject(AdmissionsService);
  private readonly router = inject(Router);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly showCounsellor = computed(() => (this.ctx()?.counsellors.length ?? 0) > 1);

  readonly data = signal<DashboardData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filters = signal<Query>({});

  readonly months = MONTH_OPTIONS;
  readonly years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i);
  readonly money = money;

  readonly rail = computed<RailStage[]>(() =>
    (this.data()?.stages ?? []).map((s) => ({ key: s.key, name: s.name, order: s.order ?? 0, isArchived: s.isArchived, count: s.count, stuck: s.stuck }))
  );

  readonly periodLabel = computed(() => {
    const p = this.data()?.period;
    return p ? `${formatDate(p.from, p.timezone)} to ${formatDate(p.to, p.timezone)}` : '';
  });

  readonly conversionPercent = computed(() => {
    const rate = this.data()?.conversion.rate;
    return rate === null || rate === undefined ? null : Math.round(rate * 1000) / 10;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admissions.getDashboard(this.filters()).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'The overview could not load.'));
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

  openList(query: Query): void {
    this.router.navigate(['/admissions/students'], { queryParams: query });
  }

  openStage(key: string): void {
    const stage = this.data()?.stages.find((s) => s.key === key);
    if (stage) this.openList(stage.query);
  }
}
