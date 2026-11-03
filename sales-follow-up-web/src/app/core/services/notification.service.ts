import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse, AppNotification } from '../../admissions/admissions.models';

const POLL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/notifications`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private users = 0;

  readonly unread = signal(0);

  /** Polls the unread count while the tab is visible. Every start() needs a matching stop(). */
  start(): void {
    this.users += 1;
    if (this.timer) return;
    this.refreshCount();
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.refreshCount();
    }, POLL_MS);
  }

  stop(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0 || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  refreshCount(): void {
    this.http.get<ApiResponse<{ count: number }>>(`${this.base}/unread-count`).subscribe({
      next: (res) => this.unread.set(res.data.count),
      error: () => {},
    });
  }

  list(): Observable<AppNotification[]> {
    return this.http.get<ApiResponse<{ items: AppNotification[]; unreadCount: number }>>(this.base).pipe(
      map((res) => {
        this.unread.set(res.data.unreadCount);
        return res.data.items;
      })
    );
  }

  markRead(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/${id}/read`, {});
  }

  markAllRead(): Observable<unknown> {
    return this.http.patch(`${this.base}/read-all`, {});
  }
}
