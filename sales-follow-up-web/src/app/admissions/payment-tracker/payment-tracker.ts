import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { MoneyRow, PaymentRow, Query } from '../admissions.models';
import {
  errorMessage,
  FEE_CATEGORY_LABELS,
  FEE_STATUS_LABELS,
  FEE_STATUS_TONE,
  formatDate,
  intakeLabel,
  money,
  MONTH_OPTIONS,
} from '../admissions.utils';

@Component({
  selector: 'adm-payment-tracker',
  imports: [RouterLink],
  templateUrl: './payment-tracker.html',
  styleUrl: './payment-tracker.scss',
})
export class PaymentTracker implements OnInit {
  private readonly admissions = inject(AdmissionsService);
  private readonly router = inject(Router);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly showCounsellor = computed(() => (this.ctx()?.counsellors.length ?? 0) > 1);

  readonly filters = signal<Query>({ status: 'OUTSTANDING' });
  readonly items = signal<PaymentRow[]>([]);
  readonly totals = signal<MoneyRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly exporting = signal(false);

  readonly months = MONTH_OPTIONS;
  readonly years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i);
  readonly categories = Object.entries(FEE_CATEGORY_LABELS);
  readonly categoryLabels = FEE_CATEGORY_LABELS;
  readonly statusLabels = FEE_STATUS_LABELS;
  readonly statusTone = FEE_STATUS_TONE;
  readonly money = money;
  readonly formatDate = formatDate;
  readonly intakeLabel = intakeLabel;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admissions.listPayments(this.filters()).subscribe({
      next: ({ items, totals }) => {
        this.items.set(items);
        this.totals.set(totals);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'Payments could not load.'));
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

  open(row: PaymentRow): void {
    this.router.navigate(['/admissions/students', row.applicationId], { queryParams: { tab: 'payments' } });
  }

  export(format: 'csv' | 'xlsx'): void {
    this.exporting.set(true);
    this.admissions.download('payments/export', { ...this.filters(), format }).subscribe({
      next: () => this.exporting.set(false),
      error: (err) => {
        this.exporting.set(false);
        toast.error(errorMessage(err, 'The export could not be created.'));
      },
    });
  }
}
