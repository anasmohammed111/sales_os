import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, retry, shareReplay, tap, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import {
  Activity,
  AdmissionDocument,
  AdmissionsConfig,
  AdmissionsContext,
  ApiResponse,
  Application,
  ApplicationDetail,
  AssessmentsData,
  DashboardData,
  DocumentType,
  DuplicateMatch,
  Fee,
  FeePlanEntry,
  ListResult,
  MoneyRow,
  PaymentRow,
  Query,
  Task,
  University,
} from '../../admissions/admissions.models';

/** Waits before each new try of a context load that failed for a passing reason */
const CONTEXT_RETRIES = [2000, 4000, 6000];

/** No connection, or the server failed: worth trying again. 4xx answers are final. */
const isTransient = (err: unknown) => {
  const status = (err as { status?: number })?.status ?? 0;
  return status === 0 || status >= 500;
};

const toParams = (query: Query = {}) =>
  Object.entries(query).reduce(
    (params, [key, value]) => (value === '' || value === undefined || value === null ? params : params.set(key, value)),
    new HttpParams()
  );

@Injectable({ providedIn: 'root' })
export class AdmissionsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = `${environment.apiUrl}/admissions`;

  /** Loaded once per session; null when the module is off for this business. */
  readonly context = signal<AdmissionsContext | null>(null);
  readonly contextState = signal<'idle' | 'loading' | 'ready' | 'disabled' | 'error'>('idle');
  private context$: Observable<AdmissionsContext | null> | null = null;
  /** Who the cached context belongs to; a different sign-in must never see it. */
  private contextUserId: string | null = null;
  /**
   * Whether admissions was switched on the last time it loaded for this person,
   * so the menu can show it while it loads (or retries) instead of flickering.
   */
  readonly wasEnabled = signal(false);

  private rememberKey(userId: string | null): string {
    return `kelto_admissions_on_${userId ?? ''}`;
  }

  private remember(userId: string | null, on: boolean): void {
    this.wasEnabled.set(on);
    if (typeof localStorage !== 'undefined') localStorage.setItem(this.rememberKey(userId), on ? '1' : '0');
  }

  loadContext(force = false): Observable<AdmissionsContext | null> {
    const userId = this.auth.getUser()?.id ?? null;
    if (userId !== this.contextUserId) {
      this.resetContext();
      this.contextUserId = userId;
      this.wasEnabled.set(typeof localStorage !== 'undefined' && localStorage.getItem(this.rememberKey(userId)) === '1');
    }
    if (force || !this.context$) {
      // Refreshing a context that is already loaded happens in the background.
      // The admissions layout only shows its pages while the state is 'ready', so
      // switching to 'loading' would destroy the page that asked for the refresh;
      // Settings refreshes on open, so that looped forever.
      const refreshing = this.contextState() === 'ready' && this.context() !== null;
      if (!refreshing) this.contextState.set('loading');
      this.context$ = this.http.get<ApiResponse<AdmissionsContext>>(`${this.base}/context`).pipe(
        // The server or its database can be briefly unreachable (e.g. reconnecting
        // after the computer slept). Try again a few times before giving up, so
        // Admissions does not vanish from the menu until a reload.
        retry({
          count: CONTEXT_RETRIES.length,
          delay: (err, attempt) => (isTransient(err) ? timer(CONTEXT_RETRIES[attempt - 1]) : throwError(() => err)),
        }),
        map((res) => res.data),
        tap((ctx) => {
          this.context.set(ctx);
          this.contextState.set('ready');
          this.remember(userId, true);
        }),
        catchError((err) => {
          this.context$ = null;
          // A failed refresh keeps what is already on screen
          if (refreshing) return of(this.context());
          this.context.set(null);
          this.contextState.set(err?.status === 404 ? 'disabled' : 'error');
          if (err?.status === 404) this.remember(userId, false);
          return of(null);
        }),
        shareReplay(1)
      );
    }
    return this.context$;
  }

  /** Clears cached context (on logout or after settings change). */
  resetContext(): void {
    this.context$ = null;
    this.context.set(null);
    this.contextState.set('idle');
  }

  // Applications
  listApplications(query: Query): Observable<ListResult<Application>> {
    return this.http
      .get<ApiResponse<ListResult<Application>>>(`${this.base}/applications`, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  getApplication(id: string): Observable<ApplicationDetail> {
    return this.http.get<ApiResponse<ApplicationDetail>>(`${this.base}/applications/${id}`).pipe(map((r) => r.data));
  }

  checkDuplicates(body: { email?: string; phone?: string; excludeStudentId?: string }): Observable<DuplicateMatch[]> {
    return this.http
      .post<ApiResponse<{ matches: DuplicateMatch[] }>>(`${this.base}/applications/check-duplicates`, body)
      .pipe(map((r) => r.data.matches));
  }

  createApplication(body: unknown): Observable<Application> {
    return this.http.post<ApiResponse<Application>>(`${this.base}/applications`, body).pipe(map((r) => r.data));
  }

  updateApplication(id: string, body: unknown): Observable<ApplicationDetail> {
    return this.http.patch<ApiResponse<ApplicationDetail>>(`${this.base}/applications/${id}`, body).pipe(map((r) => r.data));
  }

  assign(id: string, counsellorId: string | null): Observable<Application> {
    return this.http
      .patch<ApiResponse<Application>>(`${this.base}/applications/${id}/assign`, { counsellorId })
      .pipe(map((r) => r.data));
  }

  setStatus(id: string, status: 'WITHDRAWN' | 'ACTIVE' | 'CLOSED', reason = ''): Observable<Application> {
    return this.http
      .patch<ApiResponse<Application>>(`${this.base}/applications/${id}/status`, { status, reason })
      .pipe(map((r) => r.data));
  }

  setChecklistItem(id: string, itemKey: string, status: string, reason = ''): Observable<ApplicationDetail> {
    return this.http
      .patch<ApiResponse<ApplicationDetail>>(`${this.base}/applications/${id}/checklist/${itemKey}`, { status, reason })
      .pipe(map((r) => r.data));
  }

  moveStage(
    id: string,
    body: { fromStageKey: string; toStageKey: string; reason?: string; override?: boolean }
  ): Observable<ApplicationDetail> {
    return this.http.post<ApiResponse<ApplicationDetail>>(`${this.base}/applications/${id}/stage`, body).pipe(map((r) => r.data));
  }

  recordVisaOutcome(id: string, outcome: 'APPROVED' | 'REJECTED', reason = ''): Observable<ApplicationDetail> {
    return this.http
      .post<ApiResponse<ApplicationDetail>>(`${this.base}/applications/${id}/visa-outcome`, { outcome, reason })
      .pipe(map((r) => r.data));
  }

  // Activity
  listActivity(id: string): Observable<Activity[]> {
    return this.http.get<ApiResponse<Activity[]>>(`${this.base}/applications/${id}/activity`).pipe(map((r) => r.data));
  }

  addNote(id: string, body: string): Observable<unknown> {
    return this.http.post(`${this.base}/applications/${id}/notes`, { body });
  }

  // Interviews and entrance exams
  listAssessments(): Observable<AssessmentsData> {
    return this.http.get<ApiResponse<AssessmentsData>>(`${this.base}/assessments`).pipe(map((r) => r.data));
  }

  // Tasks
  listTasks(query: Query = {}): Observable<Task[]> {
    return this.http.get<ApiResponse<Task[]>>(`${this.base}/tasks`, { params: toParams(query) }).pipe(map((r) => r.data));
  }

  listApplicationTasks(id: string): Observable<Task[]> {
    return this.http.get<ApiResponse<Task[]>>(`${this.base}/applications/${id}/tasks`).pipe(map((r) => r.data));
  }

  createTask(id: string, body: unknown): Observable<Task> {
    return this.http.post<ApiResponse<Task>>(`${this.base}/applications/${id}/tasks`, body).pipe(map((r) => r.data));
  }

  updateTask(taskId: string, body: unknown): Observable<Task> {
    return this.http.patch<ApiResponse<Task>>(`${this.base}/tasks/${taskId}`, body).pipe(map((r) => r.data));
  }

  // Documents
  listDocuments(id: string): Observable<{ types: DocumentType[]; documents: AdmissionDocument[] }> {
    return this.http
      .get<ApiResponse<{ types: DocumentType[]; documents: AdmissionDocument[] }>>(`${this.base}/applications/${id}/documents`)
      .pipe(map((r) => r.data));
  }

  createDocument(id: string, body: { documentTypeKey: string; title?: string; expiresAt?: string | null }): Observable<AdmissionDocument> {
    return this.http
      .post<ApiResponse<AdmissionDocument>>(`${this.base}/applications/${id}/documents`, body)
      .pipe(map((r) => r.data));
  }

  updateDocument(docId: string, body: unknown): Observable<AdmissionDocument> {
    return this.http.patch<ApiResponse<AdmissionDocument>>(`${this.base}/documents/${docId}`, body).pipe(map((r) => r.data));
  }

  uploadDocumentFile(docId: string, file: File): Observable<AdmissionDocument> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ApiResponse<AdmissionDocument>>(`${this.base}/documents/${docId}/file`, form).pipe(map((r) => r.data));
  }

  reviewDocument(docId: string, status: 'VERIFIED' | 'REJECTED', reason = ''): Observable<AdmissionDocument> {
    return this.http
      .patch<ApiResponse<AdmissionDocument>>(`${this.base}/documents/${docId}/review`, { status, reason })
      .pipe(map((r) => r.data));
  }

  documentLink(docId: string): Observable<{ url: string; expiresInSeconds: number }> {
    return this.http
      .get<ApiResponse<{ url: string; expiresInSeconds: number }>>(`${this.base}/documents/${docId}/download-url`)
      .pipe(map((r) => r.data));
  }

  // Payments
  listFees(id: string): Observable<{ fees: Fee[]; summary: MoneyRow[]; plan: FeePlanEntry[] }> {
    return this.http
      .get<ApiResponse<{ fees: Fee[]; summary: MoneyRow[]; plan: FeePlanEntry[] }>>(`${this.base}/applications/${id}/fees`)
      .pipe(map((r) => r.data));
  }

  createFee(id: string, body: unknown): Observable<Fee> {
    return this.http.post<ApiResponse<Fee>>(`${this.base}/applications/${id}/fees`, body).pipe(map((r) => r.data));
  }

  updateFee(feeId: string, body: unknown): Observable<Fee> {
    return this.http.patch<ApiResponse<Fee>>(`${this.base}/fees/${feeId}`, body).pipe(map((r) => r.data));
  }

  recordPayment(
    feeId: string,
    body: { amount: string; paidAt: string; reference: string; method: string },
    receipt?: File | null
  ): Observable<Fee> {
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => form.append(k, v));
    if (receipt) form.append('file', receipt);
    return this.http.post<ApiResponse<Fee>>(`${this.base}/fees/${feeId}/transactions`, form).pipe(map((r) => r.data));
  }

  voidPayment(feeId: string, txId: string, reason: string): Observable<Fee> {
    return this.http
      .patch<ApiResponse<Fee>>(`${this.base}/fees/${feeId}/transactions/${txId}/void`, { reason })
      .pipe(map((r) => r.data));
  }

  receiptLink(feeId: string, txId: string): Observable<{ url: string; expiresInSeconds: number }> {
    return this.http
      .get<ApiResponse<{ url: string; expiresInSeconds: number }>>(`${this.base}/fees/${feeId}/transactions/${txId}/receipt-url`)
      .pipe(map((r) => r.data));
  }

  listPayments(query: Query): Observable<{ items: PaymentRow[]; totals: MoneyRow[] }> {
    return this.http
      .get<ApiResponse<{ items: PaymentRow[]; totals: MoneyRow[] }>>(`${this.base}/payments`, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  // Dashboard, settings
  getDashboard(query: Query): Observable<DashboardData> {
    return this.http.get<ApiResponse<DashboardData>>(`${this.base}/dashboard`, { params: toParams(query) }).pipe(map((r) => r.data));
  }

  getSettings(): Observable<AdmissionsConfig> {
    return this.http.get<ApiResponse<AdmissionsConfig>>(`${this.base}/settings`).pipe(map((r) => r.data));
  }

  saveSettings(config: AdmissionsConfig): Observable<AdmissionsConfig> {
    return this.http.put<ApiResponse<AdmissionsConfig>>(`${this.base}/settings`, config).pipe(map((r) => r.data));
  }

  createUniversity(body: Partial<University>): Observable<University> {
    return this.http.post<ApiResponse<University>>(`${this.base}/universities`, body).pipe(map((r) => r.data));
  }

  updateUniversity(id: string, body: Partial<University>): Observable<University> {
    return this.http.patch<ApiResponse<University>>(`${this.base}/universities/${id}`, body).pipe(map((r) => r.data));
  }

  /** Downloads an export with the user's token and saves it under the server's filename. */
  download(path: 'applications/export' | 'payments/export', query: Query): Observable<void> {
    return this.http
      .get(`${this.base}/${path}`, { params: toParams(query), responseType: 'blob', observe: 'response' })
      .pipe(
        map((res) => {
          const disposition = res.headers.get('content-disposition') || '';
          const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'export';
          const url = URL.createObjectURL(res.body as Blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        })
      );
  }

  /**
   * Opens a private file in a new tab. The tab is opened during the click (so
   * pop-up blockers allow it) and pointed at the short-lived link once issued.
   */
  openFile(link$: Observable<{ url: string }>): Observable<void> {
    const tab = window.open('about:blank', '_blank');
    return link$.pipe(
      map(({ url }) => {
        const absolute = url.startsWith('/') ? `${new URL(environment.apiUrl).origin}${url}` : url;
        if (tab) {
          tab.opener = null;
          tab.location.href = absolute;
        } else {
          window.location.href = absolute;
        }
      }),
      catchError((err) => {
        tab?.close();
        throw err;
      })
    );
  }
}
