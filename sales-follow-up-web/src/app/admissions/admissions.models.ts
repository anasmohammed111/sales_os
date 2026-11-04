// Shapes returned by /api/admissions. Dates arrive as ISO strings.

export type Role = 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON';
export type StudyLevel = 'BACHELOR' | 'MASTER';
export type ItemStatus = 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE';
export type AssessmentResult = 'PENDING' | 'PASSED' | 'FAILED';
export type VisaOutcome = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ApplicationStatus = 'ACTIVE' | 'CLOSED' | 'WITHDRAWN';
export type PaymentStatus = 'NONE' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
export type FeeStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
export type FeeCategory = 'AGENCY_FEE' | 'UNIVERSITY_FEE' | 'NOSTRIFICATION_FEE';
export type Currency = 'INR' | 'EUR' | 'CZK' | 'USD';
export type DocumentStatus = 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED';
export type TaskStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskType =
  | 'CALL'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'MEETING'
  | 'TASK'
  | 'DOCUMENT'
  | 'PAYMENT'
  | 'EXAM'
  | 'INTERVIEW'
  | 'VISA'
  | 'OTHER';
export type Warning =
  | 'NEEDS_REVIEW'
  | 'STUCK'
  | 'FOLLOW_UP_OVERDUE'
  | 'PAYMENT_OVERDUE'
  | 'NO_FOLLOW_UP'
  | 'UNASSIGNED';

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  code?: string;
  data: T;
}

export interface ConfigItem {
  key: string;
  label: string;
  required: boolean;
  condition: 'INTERVIEW_REQUIRED' | 'EXAM_REQUIRED' | null;
  rule: string | null;
  paymentCategory: FeeCategory | null;
  isArchived: boolean;
}

export interface ConfigStage {
  key: string;
  name: string;
  order: number;
  stuckThresholdDays: number;
  gate: string | null;
  isArchived: boolean;
  items: ConfigItem[];
}

export interface NamedEntry {
  key: string;
  name: string;
  isArchived: boolean;
}

export interface DocumentType extends NamedEntry {
  hasExpiry: boolean;
}

export interface ReminderDefaults {
  followUpMinutesBefore: number;
  interviewDaysBefore: number;
  examDaysBefore: number;
  visaDaysBefore: number;
  paymentDaysBefore: number;
  documentExpiryDaysBefore: number;
}

export interface AdmissionsConfig {
  stages: ConfigStage[];
  documentTypes: DocumentType[];
  leadSources: NamedEntry[];
  reminderDefaults: ReminderDefaults;
  timezone: string;
}

export interface Person {
  id?: string;
  _id?: string;
  name: string;
  email?: string;
  role?: Role;
  isActive?: boolean;
}

export interface Course {
  _id?: string;
  name: string;
  level: StudyLevel;
  language: string;
  isArchived: boolean;
}

export interface University {
  _id: string;
  name: string;
  city: string;
  website: string;
  courses: Course[];
  isArchived: boolean;
}

export interface AdmissionsContext {
  enabled: boolean;
  role: Role;
  isAdmin: boolean;
  userId: string;
  businessName: string;
  config: AdmissionsConfig;
  counsellors: (Person & { _id: string })[];
  universities: University[];
}

export interface StudentSnapshot {
  name: string;
  email: string;
  phone: string;
  phoneDigits?: string;
  whatsapp: string;
  city: string;
}

export interface UniversityChoice {
  universityId: string | null;
  courseId: string | null;
  universityName: string;
  courseName: string;
}

export interface MoneyRow {
  currency: Currency;
  dueMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  due?: string;
  paid?: string;
  outstanding?: string;
  overdue?: string;
  overdueMinor?: number;
}

export interface Assessment {
  interviewRequired: boolean | null;
  examRequired: boolean | null;
  interviewAt: string | null;
  examAt: string | null;
  interviewResult: AssessmentResult;
  examResult: AssessmentResult;
  notes: string;
}

export interface Visa {
  appointmentAt: string | null;
  outcome: VisaOutcome;
  outcomeAt: string | null;
  notes: string;
}

export interface StageRef {
  key: string;
  name: string;
  order?: number;
  isArchived?: boolean;
}

export interface Application {
  id: string;
  studentId: string;
  student: StudentSnapshot;
  counsellorId: string | null;
  counsellor: Person | null;
  studyLevel: StudyLevel;
  intakeMonth: number;
  intakeYear: number;
  leadSource: string;
  shortlist: UniversityChoice[];
  finalChoice: UniversityChoice;
  currentStage: StageRef;
  nextStage: StageRef | null;
  stageEnteredAt: string;
  daysInStage: number;
  stuckThresholdDays: number;
  isStuck: boolean;
  status: ApplicationStatus;
  closedAt: string | null;
  withdrawnReason: string;
  needsReview: boolean;
  reviewReason: string;
  assessment: Assessment;
  visa: Visa;
  nextFollowUpAt: string | null;
  isFollowUpOverdue: boolean;
  paymentSummary: { status: PaymentStatus; nextDueAt: string | null; byCurrency: MoneyRow[] };
  isPaymentOverdue: boolean;
  pendingRequirements: number;
  canAdvance: boolean;
  warnings: Warning[];
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistEntry {
  stageKey: string;
  itemKey: string;
  label: string;
  required: boolean;
  condition: string | null;
  rule: string | null;
  paymentCategory: FeeCategory | null;
  isRetired: boolean;
  isApplicable: boolean;
  blockedBy: string | null;
  status: ItemStatus;
  naReason: string;
  completedBy: Person | string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface StageVisit {
  stageKey: string;
  stageName: string;
  enteredAt: string;
  exitedAt: string | null;
  direction: 'INITIAL' | 'FORWARD' | 'BACKWARD';
  override: boolean;
  reason: string;
  overriddenItems: string[];
}

export interface StageProgress {
  key: string;
  name: string;
  order: number;
  isArchived: boolean;
  required: number;
  done: number;
  satisfied: boolean;
}

export interface MissingItem {
  stageKey: string;
  itemKey: string;
  label: string;
  reason: string;
}

export interface ApplicationDetail extends Application {
  checklist: ChecklistEntry[];
  stageHistory: StageVisit[];
  stageProgress: StageProgress[];
  currentRequirements: { missing: MissingItem[]; gateError: string | null };
  otherApplications: Application[];
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DuplicateMatch {
  inScope: boolean;
  matchedOn: ('email' | 'phone')[];
  studentId?: string;
  name?: string;
  email?: string;
  phone?: string;
  applications?: { id: string; intakeMonth: number; intakeYear: number; currentStageKey: string; status: ApplicationStatus }[];
}

export interface Task {
  id: string;
  applicationId: string;
  studentId: string;
  student: { name: string; phone: string } | null;
  currentStageKey: string | null;
  type: TaskType;
  title: string;
  notes: string;
  outcome: string;
  priority: TaskPriority;
  status: TaskStatus;
  scheduledAt: string;
  completedAt: string | null;
  assignedTo: { id: string; name?: string } | null;
  createdAt: string;
}

export interface AdmissionDocument {
  id: string;
  documentTypeKey: string;
  title: string;
  status: DocumentStatus;
  file: { hasFile: boolean; originalName: string; mimeType: string; size: number };
  uploadedBy: Person | null;
  uploadedAt: string | null;
  reviewedBy: Person | null;
  reviewedAt: string | null;
  rejectionReason: string;
  expiresAt: string | null;
  notes: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  amountMinor: number;
  amount: string;
  paidAt: string;
  reference: string;
  method: string;
  hasReceipt: boolean;
  receiptName: string;
  recordedBy: Person | null;
  recordedAt: string;
  isVoided: boolean;
  voidReason: string;
}

export interface Fee {
  id: string;
  applicationId: string;
  category: FeeCategory;
  label: string;
  currency: Currency;
  amountDueMinor: number;
  amountDue: string;
  paidMinor: number;
  paid: string;
  outstandingMinor: number;
  outstanding: string;
  status: FeeStatus;
  dueDate: string | null;
  isOverdue: boolean;
  notes: string;
  transactions: Transaction[];
  createdAt: string;
}

export interface PaymentRow extends Omit<Fee, 'transactions'> {
  paymentCount: number;
  student: { name: string; phone: string } | null;
  counsellor: Person | null;
  intakeMonth: number;
  intakeYear: number;
  studyLevel: StudyLevel;
}

export interface Activity {
  id: string;
  type: string;
  message: string;
  body: string;
  actor: Person | null;
  createdAt: string;
}

export type Query = Record<string, string>;

export interface Metric {
  value: number;
  query: Query;
}

export interface DashboardData {
  period: { from: string; to: string; timezone: string };
  metrics: Record<
    'newLeads' | 'active' | 'overdueFollowUps' | 'stuck' | 'needsReview' | 'visasApproved' | 'visasRejected',
    Metric
  >;
  stages: (StageRef & { count: number; stuck: number; query: Query })[];
  outstandingByCurrency: MoneyRow[];
  conversion: { cohort: number; approved: number; rate: number | null; definition: string; query: Query };
}

export type AssessmentType = 'INTERVIEW' | 'EXAM';

export interface AssessmentEvent {
  applicationId: string;
  studentId: string;
  student: { name: string; phone: string };
  counsellor: string | null;
  currentStage: { key: string; name: string };
  type: AssessmentType;
  at: string;
  result: AssessmentResult;
}

export interface AssessmentsData {
  upcoming: AssessmentEvent[];
  awaitingResult: AssessmentEvent[];
  timezone: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  applicationId: string | null;
  isRead: boolean;
  createdAt: string;
}
