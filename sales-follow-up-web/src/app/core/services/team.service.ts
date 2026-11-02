import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ApiResponse<T> {
    success: boolean;
    message: string;
    data: T;
}

export interface MemberPayload {
    name: string;
    email: string;
    password?: string;
    role: 'SALES_MANAGER' | 'SALESPERSON';
    managerId?: string | null;
}

export interface TeamMember {
    _id: string;
    name: string;
    email: string;
    role: 'SALES_MANAGER' | 'SALESPERSON';
    managerId?: { _id: string; name: string; email: string; role?: string } | string | null;
    isActive: boolean;
    createdAt?: string;
}

export interface MemberPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface MemberSummaryCounts {
    totalMembers: number;
    activeMembers: number;
    inactiveMembers: number;
    salesManagers: number;
    salespersons: number;
}

export interface MemberListResponse {
    success: boolean;
    data: TeamMember[];
    pagination: MemberPagination;
    summary?: MemberSummaryCounts;
    message?: string;
}

export interface MemberFilters {
    search?: string;
    role?: 'SALES_MANAGER' | 'SALESPERSON' | 'ALL';
    status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
    page?: number;
    limit?: number;
}

@Injectable({
    providedIn: 'root',
})
export class TeamService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);
    private readonly apiUrl = `${environment.apiUrl}/team`;

    addMember(payload: MemberPayload): Observable<TeamMember> {
        return this.http
            .post<ApiResponse<TeamMember>>(`${this.apiUrl}`, payload)
            .pipe(map((res) => res.data));
    }

    getTeamMembers(
        filters: MemberFilters = {}): Observable<MemberListResponse> {
        let params = new HttpParams();

        if (filters.search?.trim()) {
            params = params.set('search', filters.search.trim());
        }

        if (filters.role && filters.role !== 'ALL') {
            params = params.set('role', filters.role);
        }

        if (filters.status && filters.status !== 'ALL') {
            params = params.set('status', filters.status);
        }

        params = params.set('page', filters.page ?? 1);
        params = params.set('limit', filters.limit ?? 10);

        return this.http.get<MemberListResponse>(this.apiUrl, { params });
    }

    getManagers(): Observable<TeamMember[]> {
        return this.getTeamMembers({ role: 'SALES_MANAGER', status: 'ACTIVE', limit: 100 })
            .pipe(map((res) => res.data));
    }

    updateMember(id: string, payload: Partial<MemberPayload>): Observable<TeamMember> {
        return this.http
            .patch<ApiResponse<TeamMember>>(`${this.apiUrl}/${id}`, payload)
            .pipe(map((res) => res.data));
    }

    deleteMember(id: string): Observable<void> {
        return this.http
            .delete<ApiResponse<void>>(`${this.apiUrl}/${id}`)
            .pipe(map(() => void 0));
    }

    toggleMemberStatus(id: string, isActive: boolean): Observable<TeamMember> {
        return this.http
            .patch<ApiResponse<TeamMember>>(`${this.apiUrl}/${id}`, { isActive })
            .pipe(map((res) => res.data));
    }
}
