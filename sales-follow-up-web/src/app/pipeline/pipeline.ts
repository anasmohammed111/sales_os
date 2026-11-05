import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { SettingsService } from '../core/services/settings.service';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import { Lead, LeadPriority, LeadStatus, LeadService, LEAD_STATUS_LABELS } from '../core/services/lead.service';
import { AdmissionsService } from '../core/services/admissions.service';
import { menuOpensUp } from '../core/utils/menu-placement';
import { PermissionService } from '../core/services/permission.service';
import { RoleService } from '../core/services/role.service';
import { CanDirective } from '../shared/can/can.directive';
import { ColumnSearch } from '../shared/column-search/column-search';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { TeamMember, TeamService } from '../core/services/team.service';
import {
  PipelineFilters,
  PipelineService,
  PipelineSummary,
} from '../core/services/pipeline.service';

export interface StageColumn {
  id: LeadStatus;
  name: string;
  color: string;
  totalLeads: number;
  totalEstimatedValue: number;
  leads: Lead[];
}

const DEFAULT_STAGES: StageColumn[] = [
  { id: 'NEW', name: 'New', color: 'var(--kelto-stage-new-lead)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'CONTACTED', name: 'Contacted', color: 'var(--kelto-stage-contacted)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'QUALIFIED', name: 'Qualified', color: 'var(--kelto-stage-qualified)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'QUOTATION_SENT', name: 'Quotation Sent', color: 'var(--kelto-stage-proposal)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'NEGOTIATION', name: 'Negotiation', color: 'var(--kelto-stage-negotiation)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'WON', name: 'Won', color: 'var(--kelto-stage-won)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'ADMISSIONS', name: 'Admissions', color: 'var(--kelto-info-600)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'ON_HOLD', name: 'On Hold', color: 'var(--kelto-warning-600)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'CLOSED', name: 'Closed', color: 'var(--kelto-neutral-600)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'NO_LONGER_REQUIRED', name: 'Not Required', color: 'var(--kelto-neutral-500)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  // The API returns this stage too; without a column these leads were not shown anywhere
  { id: 'UNRESPONSIVE', name: 'Unresponsive', color: 'var(--kelto-neutral-400)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'LOST', name: 'Lost', color: 'var(--kelto-stage-lost)', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
];

const ALLOWED_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'ADMISSIONS', 'ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE', 'LOST'],
  CONTACTED: ['NEW', 'QUALIFIED', 'QUOTATION_SENT', 'ADMISSIONS', 'ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE', 'LOST'],
  QUALIFIED: ['CONTACTED', 'QUOTATION_SENT', 'NEGOTIATION', 'ADMISSIONS', 'ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE', 'LOST'],
  QUOTATION_SENT: ['QUALIFIED', 'NEGOTIATION', 'WON', 'ADMISSIONS', 'ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE', 'LOST'],
  NEGOTIATION: ['QUOTATION_SENT', 'WON', 'ADMISSIONS', 'ON_HOLD', 'CLOSED', 'NO_LONGER_REQUIRED', 'UNRESPONSIVE', 'LOST'],
  WON: ['ADMISSIONS', 'CLOSED', 'NEW'],
  ADMISSIONS: ['WON', 'CLOSED', 'NEW'],
  ON_HOLD: ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED', 'NO_LONGER_REQUIRED', 'LOST'],
  CLOSED: ['NEW', 'CONTACTED', 'QUALIFIED', 'ADMISSIONS'],
  NO_LONGER_REQUIRED: ['NEW', 'CONTACTED'],
  UNRESPONSIVE: ['NEW', 'CONTACTED', 'CLOSED', 'NO_LONGER_REQUIRED', 'LOST'],
  LOST: ['NEW', 'CONTACTED', 'CLOSED'],
};

@Component({
  selector: 'app-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DatePipe, CurrencyPipe, CanDirective],
  templateUrl: './pipeline.html',
  styleUrl: './pipeline.scss',
})
export class Pipeline implements OnInit {
  /** Business currency from Settings */
  readonly currency = inject(SettingsService).currency;

  private readonly router = inject(Router);
  private readonly pipelineService = inject(PipelineService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);
  private readonly leadService = inject(LeadService);
  private readonly admissionsService = inject(AdmissionsService);

  private searchDebounceTimer?: ReturnType<typeof setTimeout>;

  // Data State
  stages = signal<StageColumn[]>(DEFAULT_STAGES);
  summary = signal<PipelineSummary | null>(null);
  teamMembers = signal<TeamMember[]>([]);
  currentUser = signal<AuthUser | null>(null);
  isLoading = signal(false);

  // Filters State
  searchQuery = signal('');
  assignedFilter = signal<string>('ALL');
  priorityFilter = signal<LeadPriority | 'ALL'>('ALL');
  lostReason = signal('Price / Budget Constraint');
  lostNotes = signal('');

  // Modal, Drawer & Interaction State
  selectedLead = signal<Lead | null>(null);
  activeMenuLeadId = signal<string | null>(null);
  /** The open card menu flips up near the bottom of a column */
  cardMenuUp = signal(false);
  isDetailsDrawerOpen = signal(false);
  isWonConfirmOpen = signal(false);
  isLostConfirmOpen = signal(false);
  pendingStageChange = signal<{ lead: Lead; targetStatus: LeadStatus } | null>(null);

  // Stage Move Dialog State
  isMoveModalOpen = signal(false);
  leadToMove = signal<Lead | null>(null);
  moveTargetStatus = signal<LeadStatus>('CONTACTED');
  moveNotes = signal<string>('');
  moveNextFollowUpAt = signal<string>('');
  moveEstimatedValue = signal<number | null>(null);
  moveLostReason = signal<string>('Price / Budget Constraint');
  moveArchiveLost = signal<boolean>(false);
  moveStudyLevel = signal<'BACHELOR' | 'MASTER'>('BACHELOR');
  moveIntakeMonth = signal<number>(9);
  moveIntakeYear = signal<number>(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
  isSubmittingMove = signal(false);

  // Archive / Remove Dialog State
  isArchiveModalOpen = signal(false);
  leadToArchive = signal<Lead | null>(null);
  isSubmittingArchive = signal(false);

  readonly lostReasonOptions = [
    'Price / Budget Constraint',
    'Chose Competitor / Other Agency',
    'Not Eligible / Academic Rejection',
    'No Longer Interested in Studying Abroad',
    'Unresponsive after Multiple Follow-ups',
    'Financial / Visa Constraint',
    'Personal / Family Reasons',
    'Other',
  ];

  readonly intakeMonthOptions = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  readonly intakeYearOptions = [
    new Date().getFullYear(),
    new Date().getFullYear() + 1,
    new Date().getFullYear() + 2,
  ];

  // Drag and Drop State
  draggedLead: Lead | null = null;
  dragOverStageId = signal<LeadStatus | null>(null);

  // Computed Properties
  readonly permissions = inject(PermissionService);
  private readonly roleService = inject(RoleService);
  /** Filtering by team member makes sense when the person sees more than their own leads */
  canManageTeam = computed(() => this.permissions.scope('leads') !== 'own');
  /** Moving cards (drag, arrow or menu) follows "pipeline.move" */
  readonly canMove = computed(() => this.permissions.can('pipeline.move'));

  /** A search box inside each column, narrowing the cards that column has loaded */
  readonly columnSearch = new ColumnSearch();
  readonly visibleLeads = computed(
    () =>
      new Map(
        this.stages().map((stage) => [
          stage.id,
          this.columnSearch.apply(stage.id, stage.leads, (l) => [l.customerName, l.companyName, l.email, l.phone, l.interestedIn]),
        ])
      )
  );

  hasActiveFilters = computed(() => {
    return (
      this.searchQuery().trim() !== '' ||
      this.assignedFilter() !== 'ALL' ||
      this.priorityFilter() !== 'ALL'
    );
  });

  hasNoLeads = computed(() => {
    return this.stages().every((stage) => stage.leads.length === 0);
  });

  ngOnInit(): void {
    this.currentUser.set(this.authService.getUser());
    this.loadTeamMembers();
    this.loadLeads();
  }

  loadTeamMembers(): void {
    if (!this.canManageTeam()) return;
    this.roleService.assignable('leads').subscribe({
      next: (people) => this.teamMembers.set(people as unknown as TeamMember[]),
      error: () => { },
    });
  }

  loadLeads(): void {
    this.isLoading.set(true);

    const filters: PipelineFilters = {
      search: this.searchQuery().trim() || undefined,
      priority: this.priorityFilter() !== 'ALL' ? this.priorityFilter() : undefined,
      assignedTo:
        this.canManageTeam() && this.assignedFilter() !== 'ALL' && this.assignedFilter().trim() !== ''
          ? this.assignedFilter()
          : undefined,
      limit: 100,
    };

    this.pipelineService
      .getPipeline(filters)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.summary.set(res.summary || null);

          const stageDataMap = new Map((res.data || []).map((s) => [s.status, s]));

          this.stages.update((currentStages) =>
            currentStages.map((stage) => {
              const data = stageDataMap.get(stage.id);
              return {
                ...stage,
                totalLeads: data?.totalLeads ?? 0,
                totalEstimatedValue: data?.totalEstimatedValue ?? 0,
                leads: data?.leads ?? [],
              };
            })
          );
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to load pipeline leads from server.');
        },
      });
  }

  // Filter Actions
  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.loadLeads();
    }, 350);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.loadLeads();
  }

  onAssigneeChange(value: string): void {
    this.assignedFilter.set(value);
    this.loadLeads();
  }

  onPriorityChange(value: LeadPriority | 'ALL'): void {
    this.priorityFilter.set(value);
    this.loadLeads();
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.assignedFilter.set('ALL');
    this.priorityFilter.set('ALL');
    this.loadLeads();
  }

  goToLeadManagement(): void {
    this.router.navigate(['/leads']);
  }

  // Drawer & Card Menus
  openLeadDetails(lead: Lead): void {
    this.selectedLead.set(lead);
    this.isDetailsDrawerOpen.set(true);
    this.activeMenuLeadId.set(null);
  }

  closeLeadDetails(): void {
    this.isDetailsDrawerOpen.set(false);
    this.selectedLead.set(null);
  }

  toggleCardMenu(event: MouseEvent, leadId: string): void {
    event.stopPropagation();
    const opening = this.activeMenuLeadId() !== leadId;
    if (opening) this.cardMenuUp.set(menuOpensUp(event.currentTarget));
    this.activeMenuLeadId.set(opening ? leadId : null);
  }

  closeCardMenu(): void {
    this.activeMenuLeadId.set(null);
  }

  // Utilities
  isFollowUpOverdue(dateStr: string | null | undefined): boolean {
    if (!dateStr) return false;
    return new Date(dateStr).getTime() < Date.now();
  }

  getInitials(name?: string): string {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  // Drag and Drop
  onDragStart(event: DragEvent, lead: Lead): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    this.draggedLead = lead;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', lead._id);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  /** A drag that ends without a drop (Escape, or released outside a column) */
  onDragEnd(): void {
    this.draggedLead = null;
    this.dragOverStageId.set(null);
  }

  onDragOver(event: DragEvent, stageId: LeadStatus): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (this.dragOverStageId() !== stageId) this.dragOverStageId.set(stageId);
  }

  onDragLeave(event: DragEvent, stageId: LeadStatus): void {
    if (this.dragOverStageId() === stageId) this.dragOverStageId.set(null);
  }

  onDrop(event: DragEvent, targetStatus: LeadStatus): void {
    event.preventDefault();
    this.dragOverStageId.set(null);
    if (!this.draggedLead) return;
    const lead = this.draggedLead;
    this.draggedLead = null;
    if (lead.status === targetStatus) return;

    const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[lead.status] || [];
    if (!allowedTransitions.includes(targetStatus)) {
      toast.warning(`Cannot transition lead from ${lead.status} to ${targetStatus}`);
      return;
    }

    if (targetStatus === 'WON') {
      this.pendingStageChange.set({ lead, targetStatus });
      this.isWonConfirmOpen.set(true);
      return;
    }

    if (targetStatus === 'LOST') {
      this.pendingStageChange.set({ lead, targetStatus });
      this.isLostConfirmOpen.set(true);
      return;
    }

    this.pipelineService.updateLeadStatus(lead._id, targetStatus).subscribe({
      next: () => {
        toast.success(`Moved "${lead.customerName}" to ${targetStatus}`);
        this.loadLeads();
      },
      error: (err) => {
        toast.error(err.error?.message || 'Failed to update lead status.');
      },
    });
  }

  
  getStatusLabel(status: LeadStatus): string {
    return LEAD_STATUS_LABELS[status] || status;
  }

  getAllowedNextStages(status: LeadStatus): { value: LeadStatus; label: string }[] {
    const allowed = ALLOWED_STATUS_TRANSITIONS[status] || [];
    return allowed.map((s) => ({
      value: s,
      label: this.getStatusLabel(s),
    }));
  }

  openMoveStageDialog(event: Event, lead: Lead): void {
    event.stopPropagation();
    this.leadToMove.set(lead);

    const stagesOrder: LeadStatus[] = [
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'QUOTATION_SENT',
      'NEGOTIATION',
      'WON',
      'ADMISSIONS',
    ];
    const currentIdx = stagesOrder.indexOf(lead.status);
    let nextStage: LeadStatus = 'CONTACTED';

    if (currentIdx >= 0 && currentIdx < stagesOrder.length - 1) {
      nextStage = stagesOrder[currentIdx + 1];
    } else {
      const allowed = ALLOWED_STATUS_TRANSITIONS[lead.status] || [];
      nextStage = allowed[0] || 'CONTACTED';
    }

    this.moveTargetStatus.set(nextStage);
    this.moveNotes.set(lead.notes || '');
    this.moveNextFollowUpAt.set(lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 16) : '');
    this.moveEstimatedValue.set(lead.estimatedValue ?? null);
    this.moveLostReason.set('Price / Budget Constraint');
    this.moveArchiveLost.set(false);

    const isMaster = (lead.interestedIn || '').toLowerCase().includes('master');
    this.moveStudyLevel.set(isMaster ? 'MASTER' : 'BACHELOR');
    this.moveIntakeMonth.set(9);
    this.moveIntakeYear.set(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));

    this.isMoveModalOpen.set(true);
    this.activeMenuLeadId.set(null);
  }

  closeMoveModal(): void {
    this.isMoveModalOpen.set(false);
    this.leadToMove.set(null);
  }

  confirmMoveStage(): void {
    const lead = this.leadToMove();
    if (!lead || this.isSubmittingMove()) return;

    const targetStatus = this.moveTargetStatus();
    this.isSubmittingMove.set(true);

    const finalReason =
      targetStatus === 'LOST'
        ? this.moveNotes().trim()
          ? `${this.moveLostReason()} - ${this.moveNotes().trim()}`
          : this.moveLostReason()
        : undefined;

    // Update the lead's pipeline status, notes, follow-up, and estimated value
    this.pipelineService
      .updateLeadStatus(lead._id, targetStatus, {
        lostReason: finalReason,
        notes: this.moveNotes().trim() || undefined,
        nextFollowUpAt: this.moveNextFollowUpAt() ? new Date(this.moveNextFollowUpAt()).toISOString() : null,
        estimatedValue: this.moveEstimatedValue(),
        isArchived: targetStatus === 'LOST' && this.moveArchiveLost() ? true : undefined,
      })
      .subscribe({
        next: () => {
          // If moving to ADMISSIONS, also create/sync Admissions Student Journey
          if (targetStatus === 'ADMISSIONS') {
            this.admissionsService
              .createApplication({
                studentId: lead._id,
                studyLevel: this.moveStudyLevel(),
                intakeMonth: Number(this.moveIntakeMonth()),
                intakeYear: Number(this.moveIntakeYear()),
                counsellorId: lead.assignedTo?._id || this.currentUser()?.id || undefined,
                leadSource: lead.source ? lead.source.toLowerCase() : 'other',
              })
              .subscribe({
                next: () => {
                  this.isSubmittingMove.set(false);
                  toast.success(`"${lead.customerName}" moved to Admissions & enrolled!`);
                  this.closeMoveModal();
                  this.loadLeads();
                },
                error: () => {
                  this.isSubmittingMove.set(false);
                  // Status update succeeded even if an application was already present
                  toast.success(`"${lead.customerName}" moved to Admissions.`);
                  this.closeMoveModal();
                  this.loadLeads();
                },
              });
          } else {
            this.isSubmittingMove.set(false);
            const actionText =
              targetStatus === 'LOST' && this.moveArchiveLost()
                ? 'Marked as Lost & Archived'
                : `Moved to ${this.getStatusLabel(targetStatus)}`;
            toast.success(`"${lead.customerName}" ${actionText}`);
            this.closeMoveModal();
            this.loadLeads();
          }
        },
        error: (err) => {
          this.isSubmittingMove.set(false);
          toast.error(err.error?.message || 'Failed to advance lead stage.');
        },
      });
  }

  openArchiveModal(lead: Lead, event?: Event): void {
    event?.stopPropagation();
    this.leadToArchive.set(lead);
    this.isArchiveModalOpen.set(true);
    this.activeMenuLeadId.set(null);
  }

  closeArchiveModal(): void {
    this.isArchiveModalOpen.set(false);
    this.leadToArchive.set(null);
  }

  confirmArchiveLead(): void {
    const lead = this.leadToArchive();
    if (!lead || this.isSubmittingArchive()) return;

    this.isSubmittingArchive.set(true);
    this.leadService
      .archiveLead(lead._id)
      .pipe(finalize(() => this.isSubmittingArchive.set(false)))
      .subscribe({
        next: () => {
          toast.success(`Lead "${lead.customerName}" archived and removed from active pipeline.`);
          this.closeArchiveModal();
          this.loadLeads();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to archive lead.');
        },
      });
  }

  confirmWonMove(): void {
    const pending = this.pendingStageChange();
    if (!pending) return;

    this.isWonConfirmOpen.set(false);

    this.pipelineService.updateLeadStatus(pending.lead._id, 'WON').subscribe({
      next: () => {
        toast.success(`Deal marked as Won for ${pending.lead.customerName}`);
        this.loadLeads();
      },
      error: (err) => {
        toast.error(err.error?.message || 'Failed to update deal status.');
      },
    });
    this.pendingStageChange.set(null);
  }

  cancelWonMove(): void {
    this.isWonConfirmOpen.set(false);
    this.pendingStageChange.set(null);
  }

  confirmLostMove(): void {
    const pending = this.pendingStageChange();
    if (!pending) return;

    const reason = this.lostReason();
    const finalReason = this.lostNotes().trim()
      ? `${reason} - ${this.lostNotes().trim()}`
      : reason;

    this.isLostConfirmOpen.set(false);

    this.pipelineService.updateLeadStatus(pending.lead._id, 'LOST', finalReason).subscribe({
      next: () => {
        toast.error(`Deal marked as Lost: ${reason}`);
        this.loadLeads();
      },
      error: (err) => {
        toast.error(err.error?.message || 'Failed to update deal status.');
      },
    });
    this.pendingStageChange.set(null);
  }

  cancelLostMove(): void {
    this.isLostConfirmOpen.set(false);
    this.pendingStageChange.set(null);
  }
}
