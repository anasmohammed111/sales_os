import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Lead, LeadPriority, LeadStatus } from './lead.service';

export interface PipelineStageData {
  status: LeadStatus;
  totalLeads: number;
  totalEstimatedValue: number;
  leads: Lead[];
  limit: number;
  hasMore: boolean;
}

export interface PipelineSummary {
  totalLeads?: number;
  pipelineValue?: number;
  wonDeals?: number;
  lostDeals?: number;
  wonDealsCount?: number;
  lostDealsCount?: number;
  activeLeads?: number;
  allLeads?: number;
  totalAllLeads?: number;
  wonValue?: number;
  lostValue?: number;
}

export interface PipelineResponse {
  success: boolean;
  message?: string;
  summary?: PipelineSummary;
  data: PipelineStageData[];
}

export interface PipelineFilters {
  assignedTo?: string;
  priority?: LeadPriority | 'ALL';
  search?: string;
  limit?: number;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

@Injectable({
  providedIn: 'root',
})
export class PipelineService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/pipeline`;

  getPipeline(filters: PipelineFilters = {}): Observable<PipelineResponse> {
    let params = new HttpParams();

    if (filters.assignedTo && filters.assignedTo !== 'ALL') {
      params = params.set('assignedTo', filters.assignedTo.trim());
    }

    if (filters.priority && filters.priority !== 'ALL') {
      params = params.set('priority', filters.priority);
    }

    if (filters.search && filters.search.trim()) {
      params = params.set('search', filters.search.trim());
    }

    if (filters.limit) {
      params = params.set('limit', filters.limit.toString());
    }

    return this.http.get<PipelineResponse>(this.apiUrl, { params });
  }

  updateLeadStatus(
    leadId: string,
    status: LeadStatus,
    lostReason?: string
  ): Observable<Lead> {
    const payload: { status: LeadStatus; lostReason?: string } = { status };
    if (status === 'LOST' && lostReason) {
      payload.lostReason = lostReason.trim();
    }
    return this.http
      .patch<ApiResponse<Lead>>(`${this.apiUrl}/${leadId}/status`, payload)
      .pipe(map((res) => res.data));
  }
}
