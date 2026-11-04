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
