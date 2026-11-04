import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { FollowUp, FollowUpService } from '../core/services/follow-up.service';
import { Lead, LeadService } from '../core/services/lead.service';
import { formatMoney, SettingsService } from '../core/services/settings.service';

type ReportPeriod = 7 | 30 | 90;

interface ChartBucket {
  label: string;
  count: number;
}

interface StageSummary {
  status: string;
  label: string;
  count: number;
  value: number;
}

interface ReportSummary {
  start: Date;
  newLeads: Lead[];
  openLeads: Lead[];
  pipelineValue: number;
  winRate: number | null;
  won: number;
  closed: number;
  followUps: FollowUp[];
  completedFollowUps: number;
  completionRate: number | null;
  trend: ChartBucket[];
  sources: { label: string; count: number }[];
  stages: StageSummary[];
  activityTypes: { label: string; count: number }[];
  recentFollowUps: FollowUp[];
}

const OPEN_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTATION_SENT', 'NEGOTIATION'];
const STAGES: { status: Lead['status']; label: string }[] = [
  { status: 'NEW', label: 'New' },
  { status: 'CONTACTED', label: 'Contacted' },
  { status: 'QUALIFIED', label: 'Qualified' },
  { status: 'QUOTATION_SENT', label: 'Quotation sent' },
  { status: 'NEGOTIATION', label: 'Negotiation' },
  { status: 'WON', label: 'Won' },
  { status: 'LOST', label: 'Lost' },
];
const SOURCE_LABELS: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone',
  EMAIL: 'Email',
  WEBSITE: 'Website',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};
const TYPE_LABELS: Record<string, string> = {
  CALL: 'Phone call',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  OTHER: 'Other',
  TASK: 'To-do',
  DOCUMENT: 'Documents',
  PAYMENT: 'Payment',
  EXAM: 'Entrance exam',
  INTERVIEW: 'Interview',
  VISA: 'Visa',
};

@Component({
  imports: [CommonModule],
  selector: 'app-reports',
  styleUrl: './reports.scss',
  templateUrl: './reports.html',
})
export class Reports implements OnInit {
  private readonly leadService = inject(LeadService);
  private readonly followUpService = inject(FollowUpService);
  private readonly settingsService = inject(SettingsService);

  readonly periods: { value: ReportPeriod; label: string }[] = [
    { value: 7, label: '7 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
  ];
  readonly period = signal<ReportPeriod>(30);
  readonly currency = this.settingsService.currency;
  readonly leads = signal<Lead[]>([]);
  readonly followUps = signal<FollowUp[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly summary = computed<ReportSummary>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - this.period() + 1);
    const isInPeriod = (value: string | null | undefined): boolean => {
      if (!value) return false;
      const date = new Date(value);
      return Number.isFinite(date.getTime()) && date >= start && date <= now;
    };

    const newLeads = this.leads().filter((lead) => isInPeriod(lead.createdAt));
    const openLeads = this.leads().filter((lead) => OPEN_STATUSES.includes(lead.status));
    const followUps = this.followUps().filter((item) => isInPeriod(item.scheduledAt));
    const completedFollowUps = followUps.filter((item) => item.status === 'COMPLETED').length;
    const closedLeads = newLeads.filter((lead) => lead.status === 'WON' || lead.status === 'LOST');
    const won = closedLeads.filter((lead) => lead.status === 'WON').length;
    const trend = this.buildTrend(newLeads, start, now);
    const sourceCounts = new Map<string, number>();
    for (const lead of newLeads) {
      sourceCounts.set(lead.source, (sourceCounts.get(lead.source) ?? 0) + 1);
    }

    const stageCounts = new Map<Lead['status'], Lead[]>();
    for (const lead of this.leads()) {
      stageCounts.set(lead.status, [...(stageCounts.get(lead.status) ?? []), lead]);
    }

    const typeCounts = new Map<string, number>();
    for (const item of followUps) {
      typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1);
    }

    return {
      start,
      newLeads,
      openLeads,
      pipelineValue: openLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0),
      winRate: closedLeads.length ? (won / closedLeads.length) * 100 : null,
      won,
      closed: closedLeads.length,
      followUps,
      completedFollowUps,
      completionRate: followUps.length ? (completedFollowUps / followUps.length) * 100 : null,
      trend,
      sources: [...sourceCounts.entries()]
        .map(([source, count]) => ({ label: SOURCE_LABELS[source] ?? source, count }))
        .sort((a, b) => b.count - a.count),
      stages: STAGES.map(({ status, label }) => {
        const stageLeads = stageCounts.get(status) ?? [];
        return {
          status,
          label,
          count: stageLeads.length,
          value: stageLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0),
        };
      }),
      activityTypes: [...typeCounts.entries()]
        .map(([type, count]) => ({ label: TYPE_LABELS[type] ?? type, count }))
        .sort((a, b) => b.count - a.count),
      recentFollowUps: [...followUps].sort(
        (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
      ).slice(0, 5),
    };
  });

  ngOnInit(): void {
    this.loadReportData();
  }

  loadReportData(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    forkJoin([this.loadAllLeads(), this.loadAllFollowUps()]).subscribe({
      next: ([leads, followUps]) => {
        this.leads.set(leads);
        this.followUps.set(followUps);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.errorMessage.set(error?.error?.message || 'Reports could not be loaded. Check your connection and try again.');
        this.isLoading.set(false);
      },
    });
  }

  money(value: number): string {
    return formatMoney(value, this.currency());
  }

  periodName(): string {
    return `Last ${this.period()} days`;
  }

  barWidth(value: number, values: number[]): number {
    const max = Math.max(...values, 1);
    return Math.max(value ? 4 : 0, (value / max) * 100);
  }

  chartValues(items: { count: number }[]): number[] {
    return items.map((item) => item.count);
  }

  exportCsv(): void {
    const report = this.summary();
    const rows = [
      ['Metric', 'Value'],
      ['Period', this.periodName()],
      ['New leads', String(report.newLeads.length)],
      ['Open pipeline value', this.money(report.pipelineValue)],
      ['Scheduled follow-ups', String(report.followUps.length)],
      ['Completed follow-ups', String(report.completedFollowUps)],
      ['Win rate', report.winRate === null ? 'No closed leads' : `${report.winRate.toFixed(1)}%`],
      [],
      ['Lead source', 'Leads'],
      ...report.sources.map((source) => [source.label, String(source.count)]),
      [],
      ['Pipeline stage', 'Leads', 'Estimated value'],
      ...report.stages.map((stage) => [stage.label, String(stage.count), this.money(stage.value)]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csvCell(value ?? '')).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kelto-report-${this.period()}-days.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  followUpLead(item: FollowUp): string {
    return typeof item.leadId === 'string' ? 'Lead' : item.leadId.customerName;
  }

  followUpType(item: FollowUp): string {
    return TYPE_LABELS[item.type] ?? item.type;
  }

  private loadAllLeads(): Observable<Lead[]> {
    const limit = 100;
    return this.leadService.getLeads({ page: 1, limit }).pipe(
      switchMap((first) => {
        const remainingPages = Array.from(
          { length: Math.max(0, first.pagination.totalPages - 1) },
          (_, index) => this.leadService.getLeads({ page: index + 2, limit })
        );
        return remainingPages.length
          ? forkJoin(remainingPages).pipe(map((pages) => [...first.leads, ...pages.flatMap((page) => page.leads)]))
          : of(first.leads);
      })
    );
  }

  private loadAllFollowUps(): Observable<FollowUp[]> {
    const limit = 100;
    return this.followUpService.getFollowUps({ page: 1, limit }).pipe(
      switchMap((first) => {
        const remainingPages = Array.from(
          { length: Math.max(0, first.pagination.totalPages - 1) },
          (_, index) => this.followUpService.getFollowUps({ page: index + 2, limit })
        );
        return remainingPages.length
          ? forkJoin(remainingPages).pipe(map((pages) => [...first.data, ...pages.flatMap((page) => page.data)]))
          : of(first.data);
      })
    );
  }

  private buildTrend(leads: Lead[], start: Date, now: Date): ChartBucket[] {
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const from = new Date(start.getTime() + ((now.getTime() - start.getTime()) * index) / 7);
      const to = new Date(start.getTime() + ((now.getTime() - start.getTime()) * (index + 1)) / 7);
      return {
        label: this.period() === 7
          ? from.toLocaleDateString(undefined, { weekday: 'short' })
          : from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        count: leads.filter((lead) => {
          const createdAt = new Date(lead.createdAt).getTime();
          return createdAt >= from.getTime() && (index === 6 ? createdAt <= now.getTime() : createdAt < to.getTime());
        }).length,
      };
    });
    return buckets;
  }

  private csvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
