import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Available statuses, priorities, and lead acquisition channels
export type LeadStatus =
    | 'NEW'
    | 'CONTACTED'
    | 'QUALIFIED'
    | 'QUOTATION_SENT'
    | 'NEGOTIATION'
    | 'WON'
    | 'ADMISSIONS'
    | 'ON_HOLD'
    | 'CLOSED'
    | 'NO_LONGER_REQUIRED'
    | 'UNRESPONSIVE'
    | 'LOST';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
    NEW: 'New',
    CONTACTED: 'Contacted',
    QUALIFIED: 'Qualified',
    QUOTATION_SENT: 'Quotation Sent',
    NEGOTIATION: 'Negotiation',
    WON: 'Won',
    ADMISSIONS: 'Moved to Admissions',
    ON_HOLD: 'On Hold',
    CLOSED: 'Closed',
    NO_LONGER_REQUIRED: 'No Longer Required',
    UNRESPONSIVE: 'Unresponsive',
    LOST: 'Lost',
};

export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type LeadSource =
    | 'WHATSAPP'
    | 'PHONE'
    | 'EMAIL'
    | 'WEBSITE'
    | 'WALK_IN'
    | 'REFERRAL'
    | 'OTHER';

// Assignee or creator user representation
export interface LeadUser {
    _id: string;
    name: string;
    email: string;
    role?: string;
}

// Complete Lead model returned by the API
export interface Lead {
    _id: string;
    businessId: string;
    customerName: string;
    companyName: string;
    email: string;
    phone: string;
    source: LeadSource;
    interestedIn: string;
    estimatedValue: number;
    status: LeadStatus;
    priority: LeadPriority;
    assignedTo: LeadUser | null;
    createdBy: string | LeadUser;
    nextFollowUpAt: string | null;
    notes: string;
    lostReason: string;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
}

// Data sent when creating a new lead
export interface CreateLeadPayload {
    customerName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    interestedIn?: string;
    estimatedValue?: number;
    priority?: LeadPriority;
    assignedTo?: string;
    nextFollowUpAt?: string | null;
    notes?: string;
}

// Data sent when updating an existing lead
export interface UpdateLeadPayload {
    customerName?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    source?: LeadSource;
    interestedIn?: string;
    estimatedValue?: number;
    status?: LeadStatus;
    priority?: LeadPriority;
    assignedTo?: string | null;
    nextFollowUpAt?: string | null;
    notes?: string;
    lostReason?: string;
}

// Filter parameters for listing leads
export interface LeadFilters {
    status?: LeadStatus | 'ALL';
    priority?: LeadPriority | 'ALL';
    assignedTo?: string;
    search?: string;
    dueOnly?: boolean;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// Paginated leads list result
export interface LeadListResult {
    leads: Lead[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

// Generic API response envelope
interface ApiResponse<T> {
    success: boolean;
    message?: string;
    data: T;
}

@Injectable({
    providedIn: 'root',
})
export class LeadService {
    private readonly http = inject(HttpClient);
    private readonly apiUrl = `${environment.apiUrl}/leads`;

    // Get all leads with optional search, status, and pagination filters
    getLeads(filters: LeadFilters = {}): Observable<LeadListResult> {
        let params = new HttpParams();

        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '' && value !== 'ALL') {
                params = params.set(key, String(value).trim());
            }
        });

        return this.http
            .get<ApiResponse<LeadListResult>>(this.apiUrl, { params })
            .pipe(map((res) => res.data));
    }

    // Get a single lead by ID
    getLead(id: string): Observable<Lead> {
        return this.http
            .get<ApiResponse<Lead>>(`${this.apiUrl}/${id}`)
            .pipe(map((res) => res.data));
    }

    // Create a new lead record
    createLead(payload: CreateLeadPayload): Observable<Lead> {
        return this.http
            .post<ApiResponse<Lead>>(this.apiUrl, payload)
            .pipe(map((res) => res.data));
    }

    // Update an existing lead record
    updateLead(id: string, payload: UpdateLeadPayload): Observable<Lead> {
        return this.http
            .patch<ApiResponse<Lead>>(`${this.apiUrl}/${id}`, payload)
            .pipe(map((res) => res.data));
    }

    // Archive a lead (soft delete)
    archiveLead(id: string): Observable<{ success: boolean; message: string }> {
        return this.http.delete<{ success: boolean; message: string }>(
            `${this.apiUrl}/${id}`
        );
    }
}
