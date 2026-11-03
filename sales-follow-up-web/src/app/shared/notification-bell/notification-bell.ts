import { Component, ElementRef, HostListener, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { AppNotification } from '../../admissions/admissions.models';

@Component({
  selector: 'app-notification-bell',
  templateUrl: './notification-bell.html',
  styleUrl: './notification-bell.scss',
})
export class NotificationBell implements OnInit, OnDestroy {
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly unread = this.notifications.unread;
  readonly open = signal(false);
  readonly items = signal<AppNotification[]>([]);
  readonly loading = signal(false);
  /** Fixed position so the panel escapes containers that clip overflow (the sidebar). */
  readonly position = signal({ top: 0, left: 0 });
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

  ngOnInit(): void {
    this.notifications.start();
  }

  ngOnDestroy(): void {
    this.notifications.stop();
  }

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const rect = this.button().nativeElement.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    this.position.set({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) });
    this.open.set(true);
    this.loading.set(true);
    this.notifications.list().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  select(item: AppNotification): void {
    this.open.set(false);
    if (!item.isRead) {
      this.notifications.markRead(item.id).subscribe(() => this.notifications.refreshCount());
    }
    if (item.link) this.router.navigateByUrl(item.link);
  }

  markAll(): void {
    this.notifications.markAllRead().subscribe(() => {
      this.items.set(this.items().map((i) => ({ ...i, isRead: true })));
      this.notifications.unread.set(0);
    });
  }

  timeAgo(value: string): string {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
