import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardData, MoneyRow, Query } from '../../admissions/admissions.models';
import { AdmissionsService } from '../../core/services/admissions.service';
import { CurrencyTotal, HomeSummary } from '../../core/services/home-dashboard.service';
import { PermissionService } from '../../core/services/permission.service';
import { formatMoney } from '../../core/services/settings.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Home dashboard cards for work that has slipped: leads, quotations and, where enabled, admissions. */
@Component({
  selector: 'app-home-insights',
  templateUrl: './home-insights.html',
  styleUrl: './home-insights.scss',
})
export class HomeInsights {
  readonly summary = input<HomeSummary | null>(null);
  /** The overdue row asks the dashboard to filter its queue rather than leave the page */
  readonly showOverdue = output<void>();

  private readonly router = inject(Router);
  private readonly admissions = inject(AdmissionsService);
  private readonly permissions = inject(PermissionService);

  readonly canSeeLeads = computed(() => this.permissions.can('leads.view'));
  readonly canSeeFollowUps = computed(() => this.permissions.can('followups.view'));
  readonly canAssignLeads = computed(() => this.permissions.can('leads.assign'));
  readonly canSeeQuotations = computed(() => this.permissions.can('quotations.view'));
  readonly canSeeFees = computed(() => this.permissions.can('admissions.payments'));
  readonly showAdmissions = computed(() => this.permissions.can('admissions.view') && this.admissions.context() !== null);

  readonly attention = computed(() => this.summary()?.attention ?? null);
  readonly quotations = computed(() => this.summary()?.quotations ?? null);
  readonly allClear = computed(() => {
    const a = this.attention();
    if (!a) return false;
    const overdue = this.canSeeFollowUps() ? a.overdueFollowUps.count : 0;
    const leads = (this.canSeeLeads() ? a.neglectedLeads.count : 0) + (this.canAssignLeads() ? a.unassignedLeads : 0);
    return overdue + leads === 0;
  });

  readonly admissionsData = signal<DashboardData | null>(null);
  readonly admissionsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly feesOverdue = computed(() => this.minorLine(this.admissionsData()?.outstandingByCurrency, 'overdueMinor'));
  readonly feesOutstanding = computed(() => this.minorLine(this.admissionsData()?.outstandingByCurrency, 'outstandingMinor'));

  private readonly loadAdmissionsWhenShown = effect(() => {
    if (this.showAdmissions()) untracked(() => this.loadAdmissions());
  });

  loadAdmissions(): void {
    this.admissionsState.set('loading');
    this.admissions.getDashboard({}).subscribe({
      next: (data) => {
        this.admissionsData.set(data);
        this.admissionsState.set('ready');
      },
      error: () => this.admissionsState.set('error'),
    });
  }

  money(amount: number, currency: string): string {
    return formatMoney(amount, currency);
  }

  totals(rows: CurrencyTotal[]): string {
    return rows.map((r) => formatMoney(r.amount, r.currency)).join(' + ');
  }

  overdueDetail(oldestAt: string | null): string {
    if (!oldestAt) return 'Nothing past its scheduled time';
    const daysLate = Math.floor((Date.now() - new Date(oldestAt).getTime()) / DAY_MS);
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(oldestAt));
    return daysLate < 1 ? 'Oldest is from earlier today' : `Oldest from ${day}, ${daysLate} ${daysLate === 1 ? 'day' : 'days'} late`;
  }

  expiresIn(daysLeft: number): string {
    return daysLeft <= 1 ? 'Expires within a day' : `Expires in ${daysLeft} days`;
  }

  open(path: string): void {
    this.router.navigate([path]);
  }

  openStudents(query: Query): void {
    this.router.navigate(['/admissions/students'], { queryParams: query });
  }

  private minorLine(rows: MoneyRow[] | undefined, key: 'overdueMinor' | 'outstandingMinor'): string {
    return (rows ?? [])
      .filter((r) => (r[key] ?? 0) > 0)
      .map((r) => formatMoney((r[key] ?? 0) / 100, r.currency))
      .join(' + ');
  }
}
