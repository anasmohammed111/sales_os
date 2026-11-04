import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { ApplicationDetail } from '../admissions.models';
import {
  errorMessage,
  formatDateTime,
  intakeLabel,
  LEVEL_LABELS,
  outstandingLine,
  relativeDay,
  WARNING_LABELS,
  WARNING_TONE,
  whatsappLink,
} from '../admissions.utils';
import { JourneyRail, RailStage } from '../shared/journey-rail';
import { MoveRequest, StageMoveDialog } from '../shared/stage-move-dialog';
import { ProfileOverview } from './profile-overview';
import { ProfileChecklist } from './profile-checklist';
import { ProfileDocuments } from './profile-documents';
import { ProfilePayments } from './profile-payments';
import { ProfileTasks } from './profile-tasks';
import { ProfileActivity } from './profile-activity';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

type Tab = 'overview' | 'checklist' | 'documents' | 'payments' | 'tasks' | 'activity';

@Component({
  selector: 'adm-student-profile',
  imports: [
    FormsModule,
    RouterLink,
    JourneyRail,
    StageMoveDialog,
    ProfileOverview,
    ProfileChecklist,
    ProfileDocuments,
    ProfilePayments,
    ProfileTasks,
    ProfileActivity, CanDirective],
  templateUrl: './student-profile.html',
  styleUrl: './student-profile.scss',
})
export class StudentProfile implements OnInit {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);
  /** Choosing someone else's name follows "admissions.assign" */
  readonly canAssign = computed(() => this.permissions.can('admissions.assign'));

  readonly app = signal<ApplicationDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly tab = signal<Tab>('checklist');
  readonly moveRequest = signal<MoveRequest | null>(null);
  readonly withdrawing = signal(false);
  withdrawReason = '';
  readonly closing = signal(false);
  closeReason = '';

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'checklist', label: 'Checklist' },
    { key: 'overview', label: 'Details' },
    { key: 'documents', label: 'Documents' },
    { key: 'payments', label: 'Payments' },
    { key: 'tasks', label: 'Follow-ups' },
    { key: 'activity', label: 'Notes & history' },
  ];

  /** Tabs this person may open; Payments needs "admissions.payments" */
  readonly visibleTabs = computed(() => this.tabs.filter((t) => t.key !== 'payments' || this.permissions.can('admissions.payments')));

  readonly rail = computed<RailStage[]>(() => this.app()?.stageProgress ?? []);
  readonly outstanding = computed(() => outstandingLine(this.app()?.paymentSummary?.byCurrency));
  readonly isClosed = computed(() => this.app()?.status !== 'ACTIVE');
  /** The current counsellor may be outside the viewer's team list (e.g. reassigned by an admin). */
  readonly counsellorListed = computed(() =>
    (this.ctx()?.counsellors ?? []).some((c) => c._id === this.app()?.counsellorId)
  );

  readonly levelLabels = LEVEL_LABELS;
  readonly warningLabels = WARNING_LABELS;
  readonly warningTone = WARNING_TONE;
  readonly intakeLabel = intakeLabel;
  readonly whatsappLink = whatsappLink;

  private id = '';

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.id = params.get('id') || '';
      this.load();
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const tab = params.get('tab') as Tab | null;
      if (tab && this.visibleTabs().some((t) => t.key === tab)) this.tab.set(tab);
    });
  }

  load(): void {
    this.error.set(null);
    this.admissions.getApplication(this.id).subscribe({
      next: (detail) => {
        this.app.set(detail);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err?.status === 404 ? 'This student does not exist or is not assigned to you.' : errorMessage(err, 'The student could not load.')
        );
      },
    });
  }

  selectTab(tab: Tab): void {
    this.tab.set(tab);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, replaceUrl: true });
  }

  /** From the checklist: go to Details and bring "Final choice" into view. */
  openFinalChoice(): void {
    this.selectTab('overview');
    setTimeout(() => {
      const heading = document.getElementById('final-choice');
      heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      heading?.focus({ preventScroll: true });
    });
  }

  /** Children that change the record hand back the fresh profile, or ask for a reload. */
  onUpdated(detail: ApplicationDetail | null): void {
    if (detail) this.app.set(detail);
    else this.load();
  }

  followUpText(): string {
    const at = this.app()?.nextFollowUpAt;
    return at ? `${formatDateTime(at, this.tz())} (${relativeDay(at, this.tz())})` : 'Not set';
  }

  moveNext(): void {
    const app = this.app();
    if (!app?.nextStage) return;
    this.requestMove(app.nextStage.key, app.nextStage.name);
  }

  requestMove(toStageKey: string, toStageName: string): void {
    const app = this.app();
    if (!app || !toStageKey || toStageKey === app.currentStage.key) return;
    this.moveRequest.set({
      applicationId: app.id,
      studentName: app.student.name,
      fromStageKey: app.currentStage.key,
      toStageKey,
      toStageName,
    });
  }

  onMoved(detail: ApplicationDetail): void {
    this.moveRequest.set(null);
    this.app.set({ ...detail, otherApplications: this.app()?.otherApplications ?? [] });
    toast.success(`Moved to ${detail.currentStage.name}`);
  }

  changeStage(key: string): void {
    const stage = this.ctx()?.config.stages.find((s) => s.key === key);
    if (stage) this.requestMove(stage.key, stage.name);
  }

  assign(counsellorId: string): void {
    const app = this.app();
    if (!app) return;
    this.admissions.assign(app.id, counsellorId || null).subscribe({
      next: (updated) => {
        toast.success(`Assigned to ${updated.counsellor?.name ?? 'nobody'}`);
        this.load();
      },
      error: (err) => toast.error(errorMessage(err, 'The counsellor could not be changed.')),
    });
  }

  withdraw(): void {
    const app = this.app();
    if (!app) return;
    this.admissions.setStatus(app.id, 'WITHDRAWN', this.withdrawReason).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.withdrawReason = '';
        toast.success('Application withdrawn / marked no longer required');
        this.load();
      },
      error: (err) => toast.error(errorMessage(err, 'The application could not be withdrawn.')),
    });
  }

  closeApp(): void {
    const app = this.app();
    if (!app) return;
    this.admissions.setStatus(app.id, 'CLOSED', this.closeReason || 'Closed').subscribe({
      next: () => {
        this.closing.set(false);
        this.closeReason = '';
        toast.success('Application marked as closed');
        this.load();
      },
      error: (err) => toast.error(errorMessage(err, 'The application could not be closed.')),
    });
  }

  reactivate(): void {
    const app = this.app();
    if (!app) return;
    this.admissions.setStatus(app.id, 'ACTIVE').subscribe({
      next: () => {
        toast.success('Application reactivated');
        this.load();
      },
      error: (err) => toast.error(errorMessage(err, 'The application could not be reactivated.')),
    });
  }
}
