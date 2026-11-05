import { HttpErrorResponse } from '@angular/common/http';
import {
  ApplicationStatus,
  DocumentStatus,
  FeeCategory,
  FeeCondition,
  FeeHold,
  FeeStatus,
  FeeTrigger,
  MoneyRow,
  StudyLevel,
  TaskPriority,
  TaskType,
  VisaOutcome,
  Warning,
} from './admissions.models';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DEFAULT_TZ = 'Asia/Kolkata';

export const intakeLabel = (month: number, year: number) => `${MONTHS[month - 1] ?? month} ${year}`;
export const monthName = (month: number) => MONTHS[month - 1] ?? String(month);
export const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: i + 1, label }));

export const formatDateTime = (value: string | Date | null | undefined, timeZone = DEFAULT_TZ) =>
  value
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value))
    : '';

export const formatDate = (value: string | Date | null | undefined, timeZone = DEFAULT_TZ) =>
  value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone }).format(new Date(value)) : '';

export const formatTime = (value: string | Date | null | undefined, timeZone = DEFAULT_TZ) =>
  value ? new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone }).format(new Date(value)) : '';

/** Calendar day key (YYYY-MM-DD) of an instant in the given timezone. */
export const dayKey = (value: string | Date, timeZone = DEFAULT_TZ) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

/** "today", "in 3 days", "2 days ago" relative to now, by calendar day in the timezone. */
export const relativeDay = (value: string | Date | null | undefined, timeZone = DEFAULT_TZ) => {
  if (!value) return '';
  const diff = Math.round((Date.parse(dayKey(value, timeZone)) - Date.parse(dayKey(new Date(), timeZone))) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
};

/** Value for <input type="datetime-local"> in the browser's local time. */
export const toLocalInput = (value: string | Date | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export const toDateInput = (value: string | Date | null | undefined) => toLocalInput(value).slice(0, 10);

/** ISO string from a datetime-local or date input (browser local time), or null. */
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

export const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const outstandingLine = (rows: MoneyRow[] | undefined) =>
  (rows || [])
    .filter((r) => r.outstandingMinor > 0)
    .map((r) => money(r.outstandingMinor, r.currency))
    .join(', ');

export const LEVEL_LABELS: Record<StudyLevel, string> = { BACHELOR: "Bachelor's", MASTER: "Master's" };

export const WARNING_LABELS: Record<Warning, string> = {
  NEEDS_REVIEW: 'Needs review',
  STUCK: 'Stuck',
  FOLLOW_UP_OVERDUE: 'Follow-up overdue',
  PAYMENT_OVERDUE: 'Payment overdue',
  NO_FOLLOW_UP: 'No follow-up set',
  UNASSIGNED: 'No counsellor',
};

export const WARNING_TONE: Record<Warning, 'warn' | 'bad' | 'muted'> = {
  NEEDS_REVIEW: 'bad',
  STUCK: 'warn',
  FOLLOW_UP_OVERDUE: 'warn',
  PAYMENT_OVERDUE: 'bad',
  NO_FOLLOW_UP: 'muted',
  UNASSIGNED: 'muted',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  TASK: 'To-do',
  DOCUMENT: 'Documents',
  PAYMENT: 'Payment',
  EXAM: 'Entrance exam',
  INTERVIEW: 'Interview',
  VISA: 'Visa',
  OTHER: 'Other',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

export const DOC_STATUS_LABELS: Record<DocumentStatus, string> = {
  MISSING: 'Missing',
  UPLOADED: 'Waiting for review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

export const DOC_STATUS_TONE: Record<DocumentStatus, 'muted' | 'route' | 'ok' | 'bad'> = {
  MISSING: 'muted',
  UPLOADED: 'route',
  VERIFIED: 'ok',
  REJECTED: 'bad',
};

export const FEE_CATEGORY_LABELS: Record<FeeCategory, string> = {
  SERVICE_FEE: 'Service fee',
  STUDENT_EXPENSE: 'Student expense',
  UNIVERSITY_FEE: 'University fee',
};

export const FEE_CATEGORY_HINTS: Record<FeeCategory, string> = {
  SERVICE_FEE: 'Your own charge (income)',
  STUDENT_EXPENSE: 'Collected and paid on to someone else',
  UNIVERSITY_FEE: 'Tuition or other money owed to the university',
};

export const FEE_CONDITION_LABELS: Record<FeeCondition, string> = {
  INTERVIEW_REQUIRED: 'Only if an interview is required',
  EXAM_REQUIRED: 'Only if an entrance exam is required',
  INTERVIEW_OR_EXAM: 'Only if an interview or exam is required',
  BACHELOR: "Only for Bachelor's students",
  MASTER: "Only for Master's students",
};

/** "When …" sentence for a fee-list entry */
export function feeTriggerText(
  fee: { trigger: FeeTrigger; stageName?: string },
  itemLabel: string | null
): string {
  switch (fee.trigger) {
    case 'STAGE_ENTERED':
      return fee.stageName ? `When the student reaches ${fee.stageName}` : 'When the student reaches this stage';
    case 'ITEM_COMPLETED':
      return `When "${itemLabel ?? 'a checklist item'}" is ticked`;
    case 'VISA_APPROVED':
      return 'When the visa is approved';
    default:
      return 'Added by hand when it applies';
  }
}

/** "Must be paid before …" sentence for a fee-list entry, or null */
export function feeHoldText(fee: { hold: FeeHold; stageName?: string }, itemLabel: string | null): string | null {
  if (fee.hold === 'STAGE') return fee.stageName ? `Must be paid before leaving ${fee.stageName}` : 'Must be paid before leaving the stage';
  if (fee.hold === 'ITEM') return `Must be paid before "${itemLabel ?? 'a checklist item'}" can be ticked`;
  return null;
}

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

export const FEE_STATUS_TONE: Record<FeeStatus, 'bad' | 'warn' | 'ok'> = {
  UNPAID: 'bad',
  PARTIALLY_PAID: 'warn',
  PAID: 'ok',
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

export const VISA_LABELS: Record<VisaOutcome, string> = {
  PENDING: 'Pending',
  APPROVED: 'Visa approved',
  REJECTED: 'Visa rejected',
};

export const CURRENCIES = ['INR', 'EUR', 'CZK', 'USD'] as const;

export const initials = (name: string | undefined) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Digits-only phone for wa.me links; adds India's code to ten-digit numbers. */
export const whatsappLink = (phone: string) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
};

/** Server message for a failed request, with a plain fallback. */
export const errorMessage = (err: unknown, fallback = 'Something went wrong. Try again.') => {
  const http = err as HttpErrorResponse;
  if (http?.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  return http?.error?.message || fallback;
};
