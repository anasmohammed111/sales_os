import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { AssessmentResult, ApplicationDetail, ChecklistEntry, ItemStatus, StageProgress } from '../admissions.models';
import { errorMessage, formatDateTime, fromLocalInput, toLocalInput } from '../admissions.utils';

type Tri = 'yes' | 'no' | 'unknown';
const toTri = (v: boolean | null): Tri => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
const fromTri = (v: Tri): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

@Component({
  selector: 'adm-profile-checklist',
  imports: [FormsModule],
  templateUrl: './profile-checklist.html',
  styleUrl: './profile-checklist.scss',
})
export class ProfileChecklist {
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  readonly updated = output<ApplicationDetail>();
  readonly moveNext = output<void>();
  /** Asks the profile to open the Details tab at the final university choice. */
  readonly openFinalChoice = output<void>();

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  readonly isActive = computed(() => this.application().status === 'ACTIVE');

  readonly open = signal<Set<string>>(new Set());
  readonly naFor = signal<string | null>(null);
  readonly busyKey = signal<string | null>(null);
  naReason = '';

  // Interview / exam form
  interview: Tri = 'unknown';
  exam: Tri = 'unknown';
  interviewAt = '';
  examAt = '';
  interviewResult: AssessmentResult = 'PENDING';
  examResult: AssessmentResult = 'PENDING';
  readonly savingAssessment = signal(false);

  // Visa
  visaAt = '';
  readonly savingVisa = signal(false);
  readonly confirmOutcome = signal<'APPROVED' | 'REJECTED' | null>(null);
  correctionReason = '';

  readonly formatDateTime = formatDateTime;

  constructor() {
    // Re-seed the forms whenever a fresh profile arrives; open the current stage
    effect(() => {
      const app = this.application();
      this.interview = toTri(app.assessment.interviewRequired);
      this.exam = toTri(app.assessment.examRequired);
      this.interviewAt = toLocalInput(app.assessment.interviewAt);
      this.examAt = toLocalInput(app.assessment.examAt);
      this.interviewResult = app.assessment.interviewResult;
      this.examResult = app.assessment.examResult;
      this.visaAt = toLocalInput(app.visa.appointmentAt);
      if (!untracked(this.open).size) this.open.set(new Set([app.currentStage.key]));
    });
  }

  entriesFor(stageKey: string): ChecklistEntry[] {
    return this.application().checklist.filter((e) => e.stageKey === stageKey && !(e.isRetired && e.status === 'PENDING'));
  }

  hasRule(stageKey: string, prefix: 'ASSESSMENT' | 'VISA'): boolean {
    return this.entriesFor(stageKey).some((e) =>
      prefix === 'ASSESSMENT' ? e.rule === 'ASSESSMENT_REQUIREMENTS_SET' : e.rule?.startsWith('VISA_')
    );
  }

  stageState(stage: StageProgress): 'passed' | 'current' | 'ahead' {
    const app = this.application();
    if (stage.key === app.currentStage.key) return app.status === 'ACTIVE' ? 'current' : 'passed';
    return stage.order < (app.currentStage.order ?? 0) ? 'passed' : 'ahead';
  }

  toggle(key: string): void {
    const next = new Set(this.open());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.open.set(next);
  }

  notNeededReason(entry: ChecklistEntry): string {
    if (entry.condition === 'INTERVIEW_REQUIRED') return 'Only if an interview is required';
    if (entry.condition === 'EXAM_REQUIRED') return 'Only if an entrance exam is required';
    return '';
  }

  completedByName(entry: ChecklistEntry): string {
    return typeof entry.completedBy === 'object' && entry.completedBy ? entry.completedBy.name : '';
  }

  setStatus(entry: ChecklistEntry, status: ItemStatus, reason = ''): void {
    this.busyKey.set(entry.itemKey);
    this.admissions.setChecklistItem(this.application().id, entry.itemKey, status, reason).subscribe({
      next: (detail) => {
        this.busyKey.set(null);
        this.naFor.set(null);
        this.naReason = '';
        this.updated.emit(detail);
      },
      error: (err) => {
        this.busyKey.set(null);
        toast.error(errorMessage(err, 'The checklist could not be updated.'));
      },
    });
  }

  startNa(entry: ChecklistEntry): void {
    this.naFor.set(entry.itemKey);
    this.naReason = '';
  }

  saveAssessment(): void {
    this.savingAssessment.set(true);
    const assessment = {
      interviewRequired: fromTri(this.interview),
      examRequired: fromTri(this.exam),
      interviewAt: fromLocalInput(this.interviewAt),
      examAt: fromLocalInput(this.examAt),
      interviewResult: this.interviewResult,
      examResult: this.examResult,
    };
    this.admissions.updateApplication(this.application().id, { assessment }).subscribe({
      next: (detail) => {
        this.savingAssessment.set(false);
        toast.success('Interview and exam details saved');
        this.updated.emit(detail);
      },
      error: (err) => {
        this.savingAssessment.set(false);
        toast.error(errorMessage(err, 'The details could not be saved.'));
      },
    });
  }

  saveVisaDate(): void {
    this.savingVisa.set(true);
    this.admissions.updateApplication(this.application().id, { visa: { appointmentAt: fromLocalInput(this.visaAt) } }).subscribe({
      next: (detail) => {
        this.savingVisa.set(false);
        toast.success('Visa appointment saved');
        this.updated.emit(detail);
      },
      error: (err) => {
        this.savingVisa.set(false);
        toast.error(errorMessage(err, 'The appointment could not be saved.'));
      },
    });
  }

  recordOutcome(): void {
    const outcome = this.confirmOutcome();
    if (!outcome) return;
    this.savingVisa.set(true);
    this.admissions.recordVisaOutcome(this.application().id, outcome, this.correctionReason).subscribe({
      next: (detail) => {
        this.savingVisa.set(false);
        this.confirmOutcome.set(null);
        this.correctionReason = '';
        toast.success(outcome === 'APPROVED' ? 'Visa approval recorded' : 'Visa rejection recorded');
        this.updated.emit(detail);
      },
      error: (err) => {
        this.savingVisa.set(false);
        toast.error(errorMessage(err, 'The visa result could not be recorded.'));
      },
    });
  }
}
