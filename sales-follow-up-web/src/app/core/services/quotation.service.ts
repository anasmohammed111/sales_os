import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export const SUPPORTED_CURRENCIES = [
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'SGD', 'JPY',
  'CNY', 'CHF', 'NZD', 'QAR', 'KWD', 'BHD', 'OMR'
] as const;

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

export interface QuotationItem {
  _id?: string;
  itemName: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
}

export interface QuotationCustomer {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
}

export interface QuotationUserRef {
  _id: string;
  name: string;
  email: string;
  role?: string;
}

export interface QuotationLeadRef {
  _id: string;
  customerName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  status?: string;
}

export interface Quotation {
  _id: string;
  businessId: string;
  leadId: QuotationLeadRef | string;
  quotationNumber: string;
  customer: QuotationCustomer;
  quotationDate: string;
  validUntil: string;
  subject?: string;
  items: QuotationItem[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  grandTotal: number;
  currency: string;
  status: QuotationStatus;
  termsAndConditions?: string;
  customerNotes?: string;
  internalNotes?: string;
  assignedTo: QuotationUserRef | string;
  createdBy: QuotationUserRef | string;
  sentAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  expiredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationItemPayload {
  itemName: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface CreateQuotationPayload {
  leadId: string;
  quotationDate: string;
  validUntil: string;
  subject?: string;
  items: QuotationItemPayload[];
  discount?: number;
  currency?: string;
  termsAndConditions?: string;
  customerNotes?: string;
  internalNotes?: string;
}

export interface UpdateQuotationPayload {
  quotationDate?: string;
  validUntil?: string;
  subject?: string;
  items?: QuotationItemPayload[];
  discount?: number;
  currency?: string;
  termsAndConditions?: string;
  customerNotes?: string;
  internalNotes?: string;
}

export interface QuotationFilters {
  status?: QuotationStatus | 'ALL';
  search?: string;
  assignedTo?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface QuotationPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface QuotationSummary {
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  rejected?: number;
  expired?: number;
  totalQuotations?: number;
  totalQuotationsCount?: number;
  draftCount?: number;
  sentCount?: number;
  acceptedCount?: number;
}

interface ApiListResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  pagination: QuotationPagination;
  summary?: QuotationSummary;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

@Injectable({
  providedIn: 'root',
})
export class QuotationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/quotation`;

  /**
   * Fetch paginated quotations matching filters
   */
  getQuotations(filters: QuotationFilters = {}): Observable<{ quotations: Quotation[]; pagination: QuotationPagination; summary?: QuotationSummary }> {
    let params = new HttpParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '' && value !== 'ALL') {
        params = params.set(key, String(value).trim());
      }
    });

    return this.http
      .get<ApiListResponse<Quotation>>(this.apiUrl, { params })
      .pipe(
        map((res) => ({
          quotations: res.data || [],
          pagination: res.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 },
          summary: res.summary,
        }))
      );
  }

  /**
   * Get single quotation by ID
   */
  getQuotationById(id: string): Observable<Quotation> {
    return this.http
      .get<ApiResponse<Quotation>>(`${this.apiUrl}/${id}`)
      .pipe(map((res) => res.data));
  }

  /**
   * Create a new quotation in DRAFT status
   */
  createQuotation(payload: CreateQuotationPayload): Observable<Quotation> {
    return this.http
      .post<ApiResponse<Quotation>>(this.apiUrl, payload)
      .pipe(map((res) => res.data));
  }

  /**
   * Update an existing DRAFT quotation
   */
  updateQuotation(id: string, payload: UpdateQuotationPayload): Observable<Quotation> {
    return this.http
      .put<ApiResponse<Quotation>>(`${this.apiUrl}/${id}`, payload)
      .pipe(map((res) => res.data));
  }

  /**
   * Transition quotation status (SENT, ACCEPTED, REJECTED)
   */
  updateQuotationStatus(id: string, status: 'SENT' | 'ACCEPTED' | 'REJECTED'): Observable<Quotation> {
    return this.http
      .patch<ApiResponse<Quotation>>(`${this.apiUrl}/${id}/status`, { status })
      .pipe(map((res) => res.data));
  }

  /**
   * Delete a DRAFT quotation
   */
  deleteQuotation(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/${id}`);
  }
}
