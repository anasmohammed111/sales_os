import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { SettingsService } from '../core/services/settings.service';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import { Lead, LeadPriority, LeadStatus } from '../core/services/lead.service';
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
  { id: 'NEW', name: 'New', color: '#3b82f6', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'CONTACTED', name: 'Contacted', color: '#6366f1', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'QUALIFIED', name: 'Qualified', color: '#8b5cf6', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'QUOTATION_SENT', name: 'Quotation Sent', color: '#f59e0b', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'NEGOTIATION', name: 'Negotiation', color: '#06b6d4', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'WON', name: 'Won', color: '#10b981', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
  { id: 'LOST', name: 'Lost', color: '#f43f5e', totalLeads: 0, totalEstimatedValue: 0, leads: [] },
];

const ALLOWED_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'LOST'],
  CONTACTED: ['NEW', 'QUALIFIED', 'QUOTATION_SENT', 'LOST'],
  QUALIFIED: ['CONTACTED', 'QUOTATION_SENT', 'NEGOTIATION', 'LOST'],
  QUOTATION_SENT: ['QUALIFIED', 'NEGOTIATION', 'WON', 'LOST'],
  NEGOTIATION: ['QUOTATION_SENT', 'WON', 'LOST'],
  WON: [],
  LOST: ['NEW', 'CONTACTED'],
};

@Component({
  selector: 'app-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DatePipe, CurrencyPipe],
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
  isDetailsDrawerOpen = signal(false);
  isWonConfirmOpen = signal(false);
  isLostConfirmOpen = signal(false);
  pendingStageChange = signal<{ lead: Lead; targetStatus: LeadStatus } | null>(null);

  // Drag and Drop State
  draggedLead: Lead | null = null;
  dragOverStageId = signal<LeadStatus | null>(null);

  // Computed Properties
  canManageTeam = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'OWNER' || role === 'SALES_MANAGER';
  });

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
    this.teamService.getTeamMembers({ status: 'ACTIVE', limit: 100 }).subscribe({
      next: (res) => {
        this.teamMembers.set(res.data || []);
      },
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
    this.activeMenuLeadId.update((id) => (id === leadId ? null : leadId));
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
    this.draggedLead = lead;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', lead._id);
      event.dataTransfer.effectAllowed = 'move';
    }
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
