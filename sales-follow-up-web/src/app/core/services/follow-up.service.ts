import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type FollowUpType = 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'OTHER';

export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface FollowUpLeadSummary {
  _id: string;
  customerName: string;
  companyName?: string;
  email?: string;
  phone?: string;
}

export interface FollowUpUserSummary {
  _id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON';
}

export interface FollowUp {
  _id: string;
  businessId: string;
  leadId: FollowUpLeadSummary | string;
  assignedTo: FollowUpUserSummary | string | null;
  createdBy: FollowUpUserSummary | string;
  type: FollowUpType;
  scheduledAt: string;
  status: FollowUpStatus;
  notes?: string;
  outcome?: string;
  completedAt?: string | null;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFollowUpPayload {
  leadId: string;
  assignedTo?: string | null;
  type: FollowUpType;
  scheduledAt: string;
  notes?: string;
}

export interface UpdateFollowUpPayload {
  type?: FollowUpType;
  scheduledAt?: string;
  notes?: string;
  status?: FollowUpStatus;
  outcome?: string;
}

export interface FollowUpFilters {
  status?: FollowUpStatus | 'ALL';
  type?: FollowUpType | 'ALL';
  leadId?: string;
  search?: string;
  page?: number;
  limit?: number;
  archived?: boolean;
}

export interface FollowUpPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FollowUpSummaryCounts {
  today: number;
  overdue: number;
  upcoming: number;
  completed: number;
}

export interface FollowUpListResponse {
  success: boolean;
  data: FollowUp[];
  pagination: FollowUpPagination;
  summary?: FollowUpSummaryCounts;
  message?: string;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

@Injectable({
  providedIn: 'root',
})
export class FollowUpService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/follow-ups`;

  // Get paginated follow-ups with optional status, type, lead, search, and archive filters
  getFollowUps(filters: FollowUpFilters = {}): Observable<{
    data: FollowUp[];
    pagination: FollowUpPagination;
    summary?: FollowUpSummaryCounts;
  }> {
    let params = new HttpParams();

    if (filters.status && filters.status !== 'ALL') {
      params = params.set('status', filters.status);
    }
    if (filters.type && filters.type !== 'ALL') {
      params = params.set('type', filters.type);
    }
    if (filters.leadId && filters.leadId !== 'ALL') {
      params = params.set('leadId', filters.leadId.trim());
    }
    if (filters.search && filters.search.trim()) {
      params = params.set('search', filters.search.trim());
    }
    if (filters.page) {
      params = params.set('page', filters.page.toString());
    }
    if (filters.limit) {
      params = params.set('limit', filters.limit.toString());
    }
    if (filters.archived !== undefined) {
      params = params.set('archived', String(filters.archived));
    }

    return this.http.get<FollowUpListResponse>(this.apiUrl, { params }).pipe(
      map((res) => ({
        data: res.data || [],
        pagination: res.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 },
        summary: res.summary,
      }))
    );
  }

  // Create a new follow-up interaction
  createFollowUp(payload: CreateFollowUpPayload): Observable<FollowUp> {
    return this.http
      .post<ApiResponse<FollowUp>>(this.apiUrl, payload)
      .pipe(map((res) => res.data));
  }

  // Update follow-up status, schedule, notes, or outcome
  updateFollowUp(id: string, payload: UpdateFollowUpPayload): Observable<FollowUp> {
    return this.http
      .patch<ApiResponse<FollowUp>>(`${this.apiUrl}/${id}`, payload)
      .pipe(map((res) => res.data));
  }

  // Soft-archive a follow-up
  archiveFollowUp(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.apiUrl}/${id}/archive`,
      {}
    );
  }

  // Permanently delete an archived follow-up (Owner only)
  deleteFollowUp(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiUrl}/${id}`
    );
  }
}
