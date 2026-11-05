import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface QueueItem {
  id: string;
  leadId: string;
  leadName: string;
  company: string;
  dealValue: number;
  type: string;
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  scheduledAt: string;
  completedAt: string | null;
  notes: string;
  outcome: string;
  isOverdue: boolean;
  applicationId: string | null;
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface NeglectedLead {
  id: string;
  name: string;
  company: string;
  value: number;
  status: string;
  statusLabel: string;
  assignedTo: string | null;
  lastActivityAt: string;
  idleDays: number;
}

export interface ExpiringQuotation {
  id: string;
  number: string;
  customer: string;
  amount: number;
  currency: string;
  validUntil: string;
  daysLeft: number;
}

/** Work that has slipped, within the viewer's lead and follow-up scope. */
export interface HomeAttention {
  overdueFollowUps: { count: number; oldestAt: string | null };
  neglectedLeads: { count: number; idleDays: number; items: NeglectedLead[] };
  unassignedLeads: number;
}

export interface HomeQuotations {
  awaiting: { count: number; totals: CurrencyTotal[] };
  expiringSoon: { count: number; withinDays: number; items: ExpiringQuotation[] };
  acceptedThisMonth: { count: number; totals: CurrencyTotal[] };
}

export interface HomeSummary {
  currency: string;
  timezone: string;
  followUpsToday: { total: number; pending: number; completed: number; overdue: number; urgent: number };
  queue: QueueItem[];
  pipeline: {
    openCount: number;
    openValue: number;
    averageValue: number;
    qualifiedCount: number;
    byStatus: { status: string; label: string; count: number; value: number }[];
  };
  wonLast7Days: { count: number; value: number };
  conversion: { won: number; lost: number; rate: number | null; definition: string };
  recentCompletions: QueueItem[];
  attention: HomeAttention;
  /** null when the viewer may not see quotations */
  quotations: HomeQuotations | null;
}

@Injectable({ providedIn: 'root' })
export class HomeDashboardService {
  private readonly http = inject(HttpClient);

  /** Home screen numbers; "today" follows the browser's timezone. */
  getSummary(): Observable<HomeSummary> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return this.http
      .get<{ data: HomeSummary }>(`${environment.apiUrl}/dashboard/summary`, { params: new HttpParams().set('tz', tz) })
      .pipe(map((res) => res.data));
  }
}
