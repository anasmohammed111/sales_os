import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import {
  CreateFollowUpPayload,
  FollowUp,
  FollowUpFilters,
  FollowUpPagination,
  FollowUpService,
  FollowUpStatus,
  FollowUpSummaryCounts,
  FollowUpType,
  UpdateFollowUpPayload,
} from '../core/services/follow-up.service';
import { Lead, LeadService } from '../core/services/lead.service';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { TeamService, TeamMember } from '../core/services/team.service';

@Component({
  selector: 'app-follow-ups',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe],
  templateUrl: './follow-ups.html',
  styleUrl: './follow-ups.scss',
})
export class FollowUps implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly followUpService = inject(FollowUpService);
  private readonly leadService = inject(LeadService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);

  // Status and Type Lookup Maps
  private readonly statusClasses: Record<FollowUpStatus, string> = {
    PENDING: 'badge-status-pending',
    COMPLETED: 'badge-status-completed',
    CANCELLED: 'badge-status-cancelled',
  };

  private readonly typeLabels: Record<FollowUpType, string> = {
    CALL: 'Phone Call',
    WHATSAPP: 'WhatsApp',
    EMAIL: 'Email',
    MEETING: 'Meeting',
    OTHER: 'Other',
    TASK: 'To-do',
    DOCUMENT: 'Documents',
    PAYMENT: 'Payment',
    EXAM: 'Entrance exam',
    INTERVIEW: 'Interview',
    VISA: 'Visa',
  };

  // Data State & Pagination
  followUps = signal<FollowUp[]>([]);
  leadsList = signal<Lead[]>([]);
  teamMembers = signal<TeamMember[]>([]);
  pagination = signal<FollowUpPagination>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  currentPage = signal(1);
  pageSize = signal(10);
  summary = signal<FollowUpSummaryCounts>({ today: 0, overdue: 0, upcoming: 0, completed: 0 });

  // UI & Modal States
  isLoading = signal(false);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  currentUser = signal<AuthUser | null>(null);

  isFilterDropdownOpen = signal(false);
  isScheduleModalOpen = signal(false);
  isDetailsDrawerOpen = signal(false);
  isArchiveModalOpen = signal(false);
  isDeleteModalOpen = signal(false);

  selectedFollowUp = signal<FollowUp | null>(null);
  followUpToArchive = signal<FollowUp | null>(null);
  followUpToDelete = signal<FollowUp | null>(null);
  editingFollowUpId = signal<string | null>(null);

  isEditMode = computed(() => !!this.editingFollowUpId());

  // Filter State
  statusFilter = signal<FollowUpStatus | 'ALL'>('ALL');
  typeFilter = signal<FollowUpType | 'ALL'>('ALL');
  leadFilter = signal<string>('ALL');
  searchQuery = signal('');
  showArchived = signal(false);

  // Computed Permissions & Filters
  isOwner = computed(() => this.currentUser()?.role === 'OWNER');
  canManageTeam = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'OWNER' || role === 'SALES_MANAGER';
  });

  activeFilterCount = computed(() => {
    let count = 0;
    if (this.statusFilter() !== 'ALL') count++;
    if (this.typeFilter() !== 'ALL') count++;
    if (this.leadFilter() !== 'ALL') count++;
    if (this.searchQuery().trim()) count++;
    if (this.showArchived()) count++;
    return count;
  });

  hasActiveFilters = computed(() => this.activeFilterCount() > 0);

  // Reactive Form
  scheduleForm = this.fb.group({
    leadId: ['', Validators.required],
    type: ['CALL' as FollowUpType, Validators.required],
    assignedTo: [''],
    scheduledDate: ['', Validators.required],
    scheduledTime: ['10:00', Validators.required],
    status: ['PENDING' as FollowUpStatus],
    notes: [''],
    outcome: [''],
  });

  ngOnInit(): void {
    this.currentUser.set(this.authService.getUser());
    this.loadFollowUps();
    this.loadLeads();
    this.loadTeamMembers();
  }

  loadFollowUps(): void {
    this.isLoading.set(true);

    const filters: FollowUpFilters = {
      status: this.statusFilter() !== 'ALL' ? this.statusFilter() : undefined,
      type: this.typeFilter() !== 'ALL' ? this.typeFilter() : undefined,
      leadId: this.leadFilter() !== 'ALL' ? this.leadFilter() : undefined,
      search: this.searchQuery().trim() || undefined,
      page: this.currentPage(),
      limit: this.pageSize(),
      archived: this.showArchived(),
    };

    this.followUpService
      .getFollowUps(filters)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.followUps.set(res.data);
          this.pagination.set(res.pagination);
          if (res.summary) {
            this.summary.set(res.summary);
          }
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to load follow-ups.');
        },
      });
  }

  loadLeads(): void {
    this.leadService.getLeads({ limit: 100 }).subscribe({
      next: (res) => {
        this.leadsList.set(res.leads || []);
      },
      error: () => { },
    });
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

  // Filter Actions & Handlers
  private applyFilterChange(): void {
    this.currentPage.set(1);
    this.loadFollowUps();
  }

  toggleFilterDropdown(event?: Event): void {
    event?.stopPropagation();
    this.isFilterDropdownOpen.update((open) => !open);
  }

  closeFilterDropdown(): void {
    this.isFilterDropdownOpen.set(false);
  }

  onSearch(event?: Event | string): void {
    const query = typeof event === 'string' ? event : (event?.target as HTMLInputElement)?.value || '';
    this.searchQuery.set(query);
    this.applyFilterChange();
  }

  onStatusFilterChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as FollowUpStatus | 'ALL';
    this.statusFilter.set(status);
    this.applyFilterChange();
  }

  onTypeFilterChange(event: Event): void {
    const type = (event.target as HTMLSelectElement).value as FollowUpType | 'ALL';
    this.typeFilter.set(type);
    this.applyFilterChange();
  }

  onLeadFilterChange(event: Event): void {
    const leadId = (event.target as HTMLSelectElement).value;
    this.leadFilter.set(leadId);
    this.applyFilterChange();
  }

  toggleArchivedView(archived: boolean): void {
    this.showArchived.set(archived);
    this.applyFilterChange();
  }

  clearFilters(): void {
    this.statusFilter.set('ALL');
    this.typeFilter.set('ALL');
    this.leadFilter.set('ALL');
    this.searchQuery.set('');
    this.showArchived.set(false);
    this.applyFilterChange();
  }

  // Pagination
  changePage(newPage: number): void {
    if (newPage < 1 || newPage > this.pagination().totalPages) return;
    this.currentPage.set(newPage);
    this.loadFollowUps();
  }

  onPageSizeChange(event: Event): void {
    const size = parseInt((event.target as HTMLSelectElement).value, 10) || 10;
    this.pageSize.set(size);
    this.applyFilterChange();
  }

  // Modals
  openScheduleModal(): void {
    this.loadTeamMembers();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours() + 1).padStart(2, '0');

    this.editingFollowUpId.set(null);
    this.scheduleForm.reset({
      leadId: '',
      type: 'CALL',
      assignedTo: '',
      scheduledDate: `${year}-${month}-${day}`,
      scheduledTime: `${hours}:00`,
      status: 'PENDING',
      notes: '',
      outcome: '',
    });
    this.isScheduleModalOpen.set(true);
  }

  openEditModal(followUp: FollowUp, event?: Event): void {
    event?.stopPropagation();
    this.loadTeamMembers();

    const d = new Date(followUp.scheduledAt);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    const leadId =
      typeof followUp.leadId === 'object' && followUp.leadId
        ? followUp.leadId._id
        : (followUp.leadId as string) || '';
    const assignedTo =
      typeof followUp.assignedTo === 'object' && followUp.assignedTo
        ? followUp.assignedTo._id
        : (followUp.assignedTo as string) || '';

    this.editingFollowUpId.set(followUp._id);
    this.scheduleForm.reset({
      leadId: leadId,
      type: followUp.type,
      assignedTo: assignedTo,
      scheduledDate: `${year}-${month}-${day}`,
      scheduledTime: `${hours}:${minutes}`,
      status: followUp.status,
      notes: followUp.notes || '',
      outcome: followUp.outcome || '',
    });
    this.isScheduleModalOpen.set(true);
  }

  closeScheduleModal(): void {
    this.isScheduleModalOpen.set(false);
    this.editingFollowUpId.set(null);
    this.scheduleForm.reset();
  }

  openDetailsDrawer(followUp: FollowUp): void {
    this.selectedFollowUp.set(followUp);
    this.isDetailsDrawerOpen.set(true);
  }

  closeDetailsDrawer(): void {
    this.isDetailsDrawerOpen.set(false);
    this.selectedFollowUp.set(null);
  }

  openArchiveConfirmation(followUp: FollowUp, event?: Event): void {
    event?.stopPropagation();
    this.followUpToArchive.set(followUp);
    this.isArchiveModalOpen.set(true);
  }

  closeArchiveModal(): void {
    this.isArchiveModalOpen.set(false);
    this.followUpToArchive.set(null);
  }

  openDeleteConfirmation(followUp: FollowUp, event?: Event): void {
    event?.stopPropagation();
    if (!this.isOwner()) {
      toast.error('Only the business owner can permanently delete follow-ups.');
      return;
    }
    this.followUpToDelete.set(followUp);
    this.isDeleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    this.isDeleteModalOpen.set(false);
    this.followUpToDelete.set(null);
  }

  // Add followup
  submitScheduleFollowUp(): void {
    if (this.scheduleForm.invalid || this.isSubmitting()) {
      this.scheduleForm.markAllAsTouched();
      const val = this.scheduleForm.value;
      if (!this.isEditMode() && !val.leadId) {
        toast.error('Please select a customer or lead.');
        return;
      }
      if (!val.scheduledDate) {
        toast.error('Scheduled date is required.');
        return;
      }
      toast.error('Please fill in all required fields.');
      return;
    }

    this.isSubmitting.set(true);
    const val = this.scheduleForm.value;

    let scheduledAt = '';
    if (val.scheduledDate) {
      const [year, month, day] = (val.scheduledDate || '').split('-').map(Number);
      const [hours, minutes] = (val.scheduledTime || '09:00').split(':').map(Number);
      const localDate = new Date(year, month - 1, day, hours, minutes);
      if (Number.isFinite(localDate.getTime())) {
        scheduledAt = localDate.toISOString();
      }
    }

    if (this.isEditMode()) {
      const payload: UpdateFollowUpPayload = {
        type: (val.type || 'CALL') as FollowUpType,
        scheduledAt: scheduledAt,
        status: (val.status || 'PENDING') as FollowUpStatus,
        notes: (val.notes || '').trim(),
        outcome: (val.outcome || '').trim(),
      };

      this.followUpService
        .updateFollowUp(this.editingFollowUpId()!, payload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: (updated) => {
            toast.success('Follow-up updated successfully.');
            this.closeScheduleModal();
            if (this.selectedFollowUp()?._id === updated._id) {
              this.selectedFollowUp.set(updated);
            }
            this.loadFollowUps();
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to update follow-up.');
          },
        });
    } else {
      const payload: CreateFollowUpPayload = {
        leadId: (val.leadId || '').trim(),
        type: (val.type || 'CALL') as FollowUpType,
        scheduledAt: scheduledAt,
        assignedTo: val.assignedTo?.trim() || null,
        notes: (val.notes || '').trim(),
      };

      this.followUpService
        .createFollowUp(payload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: () => {
            toast.success('Follow-up scheduled successfully.');
            this.closeScheduleModal();
            this.loadFollowUps();
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to schedule follow-up.');
          },
        });
    }
  }

  markAsCompleted(followUp: FollowUp, event?: Event): void {
    event?.stopPropagation();
    this.followUpService
      .updateFollowUp(followUp._id, { status: 'COMPLETED' })
      .subscribe({
        next: (updated) => {
          toast.success('Follow-up marked as completed.');
          if (this.selectedFollowUp()?._id === followUp._id) {
            this.selectedFollowUp.set(updated);
          }
          this.loadFollowUps();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to update follow-up status.');
        },
      });
  }

  markAsCancelled(followUp: FollowUp, event?: Event): void {
    event?.stopPropagation();
    this.followUpService
      .updateFollowUp(followUp._id, { status: 'CANCELLED' })
      .subscribe({
        next: (updated) => {
          toast.success('Follow-up marked as cancelled.');
          if (this.selectedFollowUp()?._id === followUp._id) {
            this.selectedFollowUp.set(updated);
          }
          this.loadFollowUps();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to cancel follow-up.');
        },
      });
  }

  confirmArchive(): void {
    const item = this.followUpToArchive();
    if (!item) return;

    this.isSubmitting.set(true);
    this.followUpService
      .archiveFollowUp(item._id)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success('Follow-up moved to archive.');
          this.closeArchiveModal();
          if (this.selectedFollowUp()?._id === item._id) {
            this.closeDetailsDrawer();
          }
          this.loadFollowUps();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to archive follow-up.');
        },
      });
  }

  confirmDelete(): void {
    const item = this.followUpToDelete();
    if (!item) return;

    this.isSubmitting.set(true);
    this.followUpService
      .deleteFollowUp(item._id)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success('Follow-up permanently deleted.');
          this.closeDeleteModal();
          if (this.selectedFollowUp()?._id === item._id) {
            this.closeDetailsDrawer();
          }
          this.loadFollowUps();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to permanently delete follow-up.');
        },
      });
  }

  // Display & Helper Methods
  getLeadName(followUp: FollowUp): string {
    if (typeof followUp.leadId === 'object' && followUp.leadId) {
      return followUp.leadId.customerName || 'Unnamed Contact';
    }
    return 'Lead #' + (followUp.leadId as string)?.slice(-4);
  }

  getLeadCompany(followUp: FollowUp): string {
    if (typeof followUp.leadId === 'object' && followUp.leadId) {
      return followUp.leadId.companyName || '';
    }
    return '';
  }

  getLeadEmail(followUp: FollowUp): string {
    if (typeof followUp.leadId === 'object' && followUp.leadId) {
      return followUp.leadId.email || '—';
    }
    return '—';
  }

  getLeadPhone(followUp: FollowUp): string {
    if (typeof followUp.leadId === 'object' && followUp.leadId) {
      return followUp.leadId.phone || '—';
    }
    return '—';
  }

  getAssigneeName(followUp: FollowUp): string {
    if (typeof followUp.assignedTo === 'object' && followUp.assignedTo) {
      return followUp.assignedTo.name || 'Unassigned';
    }
    return 'Unassigned';
  }

  isOverdue(followUp: FollowUp): boolean {
    if (followUp.status !== 'PENDING') return false;
    return new Date(followUp.scheduledAt).getTime() < Date.now();
  }

  getStatusBadgeClass(followUp: FollowUp): string {
    if (this.isOverdue(followUp)) return 'badge-status-overdue';
    return this.statusClasses[followUp.status] || 'badge-status-pending';
  }

  getStatusLabel(followUp: FollowUp): string {
    if (followUp.status === 'COMPLETED') return 'Completed';
    if (followUp.status === 'CANCELLED') return 'Cancelled';
    if (this.isOverdue(followUp)) return 'Overdue';
    return 'Pending';
  }

  getTypeLabel(type: FollowUpType): string {
    return this.typeLabels[type] || type;
  }

  dismissAlert(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }
}
