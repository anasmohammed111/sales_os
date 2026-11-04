/**
 * Small formatters shared by the data tables (leads, follow-ups, team, quotations).
 * They keep avatars, due dates and sources looking the same on every page.
 */

/** Up to two initials: "Counsellor One" -> "CO", "anas" -> "A" */
export function personInitials(name?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** A stable avatar colour (1-6) per name, so a person looks the same everywhere */
export function avatarTone(name?: string | null): number {
  const text = (name ?? '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 6) + 1;
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DueInfo {
  tone: DueTone;
  label: string;
  /** Full date and time, for a tooltip */
  title: string;
}

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * How a due date reads in a table: "Overdue · 2 days", "Today · 3:00 PM",
 * "Tomorrow · 10:00 AM", "Fri · 9:30 AM" or "Nov 12 · 9:30 AM".
 */
export function dueInfo(value: string | Date | null | undefined, now = new Date()): DueInfo | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000);
  const title = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  if (date.getTime() < now.getTime()) {
    const late = -days;
    const label = late <= 0 ? `Overdue · ${time(date)}` : late === 1 ? 'Overdue · yesterday' : `Overdue · ${late} days`;
    return { tone: 'overdue', label, title };
  }
  if (days === 0) return { tone: 'today', label: `Today · ${time(date)}`, title };
  if (days === 1) return { tone: 'soon', label: `Tomorrow · ${time(date)}`, title };
  if (days < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    return { tone: days <= 2 ? 'soon' : 'later', label: `${weekday} · ${time(date)}`, title };
  }
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { tone: 'later', label: `${day} · ${time(date)}`, title };
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date */
export function relativeTime(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `${Math.round(minutes / 60)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Where a lead came from, in words */
export const LEAD_SOURCE_LABELS: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone',
  EMAIL: 'Email',
  WEBSITE: 'Website',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  OTHER: 'Other',
};

export const leadSourceLabel = (source?: string | null) =>
  source ? (LEAD_SOURCE_LABELS[source] ?? source) : '—';
