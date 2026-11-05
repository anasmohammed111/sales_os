import { signal } from '@angular/core';

/** Whether `query` appears in any field; digits also match phone numbers written with spaces or a country code. */
export const matchesQuery = (query: string, fields: (string | null | undefined)[]): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return fields.some((field) => {
    if (!field) return false;
    if (field.toLowerCase().includes(q)) return true;
    return digits.length >= 3 && digits.length === q.replace(/[\s()+-]/g, '').length && field.replace(/\D/g, '').includes(digits);
  });
};

/**
 * Search boxes inside pipeline board columns, one per column. A column's key
 * is present while its box is open, even when the box is still empty.
 */
export class ColumnSearch {
  private readonly terms = signal<Record<string, string>>({});

  isOpen(key: string): boolean {
    return key in this.terms();
  }

  value(key: string): string {
    return this.terms()[key] ?? '';
  }

  isFiltering(key: string): boolean {
    return this.value(key).trim().length > 0;
  }

  toggle(key: string): void {
    if (this.isOpen(key)) {
      this.close(key);
      return;
    }
    this.terms.update((t) => ({ ...t, [key]: '' }));
    // The box renders on the next change detection; focus it once it exists
    setTimeout(() => document.getElementById(this.inputId(key))?.focus());
  }

  set(key: string, value: string): void {
    // Escape in a search input clears it after our close: that late input event must not reopen the box
    if (!this.isOpen(key)) return;
    this.terms.update((t) => ({ ...t, [key]: value }));
  }

  close(key: string): void {
    this.terms.update(({ [key]: _closed, ...rest }) => rest);
  }

  inputId(key: string): string {
    return `column-search-${key}`;
  }

  /** The column's items that match its search box */
  apply<T>(key: string, items: T[], fieldsOf: (item: T) => (string | null | undefined)[]): T[] {
    const query = this.value(key);
    return query.trim() ? items.filter((item) => matchesQuery(query, fieldsOf(item))) : items;
  }
}
