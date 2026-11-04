import { Component, computed, input, output } from '@angular/core';

/** A page number, or a gap ("…") between page numbers */
export type PagerItem = number | 'gap-start' | 'gap-end';

/**
 * Page numbers for the data tables: first, previous, 1 … 4 5 6 … 20, next, last.
 * Usage: <kt-pager [page]="page()" [totalPages]="pages()" (pageChange)="goTo($event)" />
 */
@Component({
  selector: 'kt-pager',
  templateUrl: './pager.html',
  styleUrl: './pager.scss',
})
export class Pager {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageChange = output<number>();

  readonly pages = computed(() => pagerItems(this.page(), Math.max(1, this.totalPages())));

  go(target: number): void {
    const last = Math.max(1, this.totalPages());
    if (target < 1 || target > last || target === this.page()) return;
    this.pageChange.emit(target);
  }
}

/** Up to seven slots: always the first and last page, the current one and its neighbours */
export function pagerItems(page: number, totalPages: number): PagerItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const current = Math.min(Math.max(1, page), totalPages);
  if (current <= 4) return [1, 2, 3, 4, 5, 'gap-end', totalPages];
  if (current >= totalPages - 3) return [1, 'gap-start', ...Array.from({ length: 5 }, (_, i) => totalPages - 4 + i)];
  return [1, 'gap-start', current - 1, current, current + 1, 'gap-end', totalPages];
}
