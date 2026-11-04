import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { SettingsService } from '../core/services/settings.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import {
  CreateLeadPayload,
  Lead,
  LeadFilters,
  LeadPriority,
  LeadService,
  LeadSource,
  LeadStatus,
  LEAD_STATUS_LABELS,
  UpdateLeadPayload,
} from '../core/services/lead.service';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { TeamService, TeamMember } from '../core/services/team.service';
import { AdmissionsService } from '../core/services/admissions.service';
import { Router, RouterLink } from '@angular/router';
import { Pager } from '../shared/pager/pager';
import { avatarTone, dueInfo, leadSourceLabel, personInitials, relativeTime } from '../core/utils/table-format';

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterLink, DatePipe, CurrencyPipe, Pager],
  templateUrl: './leads.html',
  styleUrl: './leads.scss',
})
export class Leads implements OnInit {
  /** Business currency from Settings */
  readonly currency = inject(SettingsService).currency;

  private readonly fb = inject(FormBuilder);
  private readonly leadService = inject(LeadService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);
  private readonly admissionsService = inject(AdmissionsService);
  private readonly router = inject(Router);

  // Status and Priority CSS Class Lookup Maps
  readonly statusClasses: Record<LeadStatus, string> = {
    NEW: 'badge-status-new',
    CONTACTED: 'badge-status-contacted',
    QUALIFIED: 'badge-status-qualified',
    QUOTATION_SENT: 'badge-status-quotation',
    NEGOTIATION: 'badge-status-negotiation',
    WON: 'badge-status-won',
    ADMISSIONS: 'badge-status-admissions',
    ON_HOLD: 'badge-status-on-hold',
    CLOSED: 'badge-status-closed',
    NO_LONGER_REQUIRED: 'badge-status-no-required',
    UNRESPONSIVE: 'badge-status-unresponsive',
    LOST: 'badge-status-lost',
  };

  readonly allStatuses: { value: LeadStatus; label: string }[] = [
    { value: 'NEW', label: 'New' },
    { value: 'CONTACTED', label: 'Contacted' },
    { value: 'QUALIFIED', label: 'Qualified' },
    { value: 'QUOTATION_SENT', label: 'Quotation Sent' },
    { value: 'NEGOTIATION', label: 'Negotiation' },
    { value: 'WON', label: 'Won' },
    { value: 'ADMISSIONS', label: 'Moved to Admissions' },
    { value: 'ON_HOLD', label: 'On Hold' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'NO_LONGER_REQUIRED', label: 'No Longer Required' },
    { value: 'UNRESPONSIVE', label: 'Unresponsive' },
    { value: 'LOST', label: 'Lost' },
  ];

  private readonly priorityClasses: Record<LeadPriority, string> = {
    LOW: 'badge-priority-low',
    MEDIUM: 'badge-priority-medium',
    HIGH: 'badge-priority-high',
  };

  // --- Leads Data & Pagination State ---
  leads = signal<Lead[]>([]);
  teamMembers = signal<TeamMember[]>([]);
  pagination = signal({ total: 0, page: 1, limit: 10, totalPages: 1 });
  currentPage = signal(1);
  pageSize = signal(10);
  sortBy = signal('createdAt');
  sortOrder = signal<'asc' | 'desc'>('desc');

  // --- Table cell formatting (shared with the other tables) ---
  readonly initials = personInitials;
  readonly avatarTone = avatarTone;
  readonly dueInfo = dueInfo;
  readonly relativeTime = relativeTime;
  readonly sourceLabel = leadSourceLabel;
  /** Placeholder rows while a page of leads loads */
  readonly skeletonRows = [1, 2, 3, 4, 5, 6];

  // --- UI & Modal States ---
  isLoading = signal(false);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);
  currentUser = signal<AuthUser | null>(null);
  selectedLead = signal<Lead | null>(null);

  // Modal Visibility Signals
  isFormModalOpen = signal(false);
  isDetailsOpen = signal(false);
  isArchiveModalOpen = signal(false);
  isConvertModalOpen = signal(false);
  leadToConvert = signal<Lead | null>(null);
  convertStudyLevel = signal<'BACHELOR' | 'MASTER'>('BACHELOR');
  convertIntakeMonth = signal<number>(9);
  convertIntakeYear = signal<number>(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
  convertCounsellorId = signal<string>('');

  readonly convertMonths = [
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
  readonly convertYears = [new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2];

  isEditMode = computed(() => !!this.selectedLead());

  // --- Filter State ---
  isFilterDropdownOpen = signal(false);
  searchQuery = signal('');
  statusFilter = signal<LeadStatus | 'ALL'>('ALL');
  priorityFilter = signal<LeadPriority | 'ALL'>('ALL');
  dueOnlyFilter = signal(false);
  assignedFilter = signal<string>('ALL');

  // --- Computed Properties ---
  canManageTeam = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'OWNER' || role === 'SALES_MANAGER';
  });

  activeFilterCount = computed(() => {
    let count = 0;
    if (this.statusFilter() !== 'ALL') count++;
    if (this.priorityFilter() !== 'ALL') count++;
    if (this.dueOnlyFilter()) count++;
    if (this.assignedFilter() !== 'ALL') count++;
    return count;
  });

  hasActiveFilters = computed(() => this.activeFilterCount() > 0);

  // --- Reactive Form ---
  leadForm = this.fb.group({
    customerName: ['', [Validators.required]],
    companyName: [''],
    email: [''],
    phone: [''],
    source: ['WEBSITE'],
    interestedIn: [''],
    estimatedValue: [null as number | null],
    status: ['NEW'],
    priority: ['MEDIUM'],
    assignedTo: [''],
    nextFollowUpAt: [''],
    notes: [''],
    lostReason: [''],
  });

  ngOnInit(): void {
    this.currentUser.set(this.authService.getUser());
    this.loadLeads();
    this.loadTeamMembers();
  }

  // --- Backend Data Fetching ---
  loadLeads(): void {
    this.isLoading.set(true);

    const filters: LeadFilters = {
      search: this.searchQuery().trim() || undefined,
      status: this.statusFilter() !== 'ALL' ? this.statusFilter() : undefined,
      priority: this.priorityFilter() !== 'ALL' ? this.priorityFilter() : undefined,
      assignedTo:
        this.canManageTeam() && this.assignedFilter() !== 'ALL' && this.assignedFilter() !== ''
          ? this.assignedFilter()
          : undefined,
      dueOnly: this.dueOnlyFilter() ? true : undefined,
      page: this.currentPage(),
      limit: this.pageSize(),
      sortBy: this.sortBy(),
      sortOrder: this.sortOrder(),
    };

    this.leadService.getLeads(filters)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (result) => {
          this.leads.set(result.leads || []);
          this.pagination.set(result.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 });
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to load leads from server.');
        },
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

  // --- Filter Actions & Handlers ---
  private applyFilterChange(): void {
    this.currentPage.set(1);
    this.loadLeads();
  }

  toggleFilterDropdown(event?: Event): void {
    event?.stopPropagation();
    this.isFilterDropdownOpen.update((open) => !open);
  }

  closeFilterDropdown(): void {
    this.isFilterDropdownOpen.set(false);
  }

  onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.applyFilterChange();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.applyFilterChange();
  }

  onStatusChange(event: Event): void {
    this.statusFilter.set(((event.target as HTMLSelectElement).value as LeadStatus) || 'ALL');
    this.applyFilterChange();
  }

  onPriorityChange(event: Event): void {
    this.priorityFilter.set(((event.target as HTMLSelectElement).value as LeadPriority) || 'ALL');
    this.applyFilterChange();
  }

  onDueChange(event: Event): void {
    this.dueOnlyFilter.set((event.target as HTMLSelectElement).value === 'DUE');
    this.applyFilterChange();
  }

  onAssignedChange(event: Event): void {
    this.assignedFilter.set((event.target as HTMLSelectElement).value || 'ALL');
    this.applyFilterChange();
  }

  clearStatusFilter(): void {
    this.statusFilter.set('ALL');
    this.applyFilterChange();
  }

  clearPriorityFilter(): void {
    this.priorityFilter.set('ALL');
    this.applyFilterChange();
  }

  clearDueFilter(): void {
    this.dueOnlyFilter.set(false);
    this.applyFilterChange();
  }

  clearAssignedFilter(): void {
    this.assignedFilter.set('ALL');
    this.applyFilterChange();
  }

  clearFilters(): void {
    this.statusFilter.set('ALL');
    this.priorityFilter.set('ALL');
    this.dueOnlyFilter.set(false);
    this.assignedFilter.set('ALL');
    this.applyFilterChange();
  }

  getAssigneeFilterLabel(): string {
    const id = this.assignedFilter();
    const member = this.teamMembers().find((m) => m._id === id);
    return member ? member.name : id;
  }

  // --- Sorting & Pagination ---
  sortByField(field: string): void {
    if (this.sortBy() === field) {
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(field);
      this.sortOrder.set('asc');
    }
    this.applyFilterChange();
  }

  changePage(newPage: number): void {
    if (newPage < 1 || newPage > this.pagination().totalPages) return;
    this.currentPage.set(newPage);
    this.loadLeads();
  }

  onPageSizeChange(event: Event): void {
    this.pageSize.set(Number((event.target as HTMLSelectElement).value));
    this.applyFilterChange();
  }

  // --- Modal Navigation ---
  openAddModal(): void {
    this.loadTeamMembers();
    this.errorMessage.set(null);
    this.selectedLead.set(null);
    this.leadForm.reset({
      customerName: '',
      companyName: '',
      email: '',
      phone: '',
      source: 'WEBSITE',
      interestedIn: '',
      estimatedValue: null,
      status: 'NEW',
      priority: 'MEDIUM',
      assignedTo: '',
      nextFollowUpAt: '',
      notes: '',
      lostReason: '',
    });
    this.isFormModalOpen.set(true);
  }

  openEditModal(lead: Lead): void {
    this.loadTeamMembers();
    this.errorMessage.set(null);
    this.selectedLead.set(lead);
    const currentAssigneeId = lead.assignedTo?._id || '';

    this.leadForm.patchValue({
      customerName: lead.customerName,
      companyName: lead.companyName || '',
      email: lead.email || '',
      phone: lead.phone || '',
      source: lead.source || 'WEBSITE',
      interestedIn: lead.interestedIn || '',
      estimatedValue: lead.estimatedValue ?? null,
      status: lead.status,
      priority: lead.priority,
      assignedTo: currentAssigneeId,
      nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 16) : '',
      notes: lead.notes || '',
      lostReason: lead.lostReason || '',
    });
    this.isFormModalOpen.set(true);
  }

  openDetails(lead: Lead): void {
    this.selectedLead.set(lead);
    this.isDetailsOpen.set(true);
  }

  openArchiveModal(lead: Lead): void {
    this.selectedLead.set(lead);
    this.isArchiveModalOpen.set(true);
  }

  closeModal(): void {
    this.errorMessage.set(null);
    this.isFormModalOpen.set(false);
    this.isDetailsOpen.set(false);
    this.isArchiveModalOpen.set(false);
  }

  saveLead(): void {
    if (this.leadForm.invalid || this.isSubmitting()) {
      this.leadForm.markAllAsTouched();
      toast.error('Customer name is required.');
      return;
    }

    this.isSubmitting.set(true);
    const value = this.leadForm.value;
    const lead = this.selectedLead();

    if (lead) {
      const payload: UpdateLeadPayload = {
        customerName: value.customerName!.trim(),
        companyName: value.companyName?.trim() || undefined,
        email: value.email?.trim() || undefined,
        phone: value.phone?.trim() || undefined,
        source: value.source as LeadSource,
        interestedIn: value.interestedIn?.trim() || undefined,
        estimatedValue: value.estimatedValue ? Number(value.estimatedValue) : undefined,
        status: value.status as LeadStatus,
        priority: value.priority as LeadPriority,
        assignedTo: value.assignedTo?.trim() || null,
        nextFollowUpAt: value.nextFollowUpAt ? new Date(value.nextFollowUpAt).toISOString() : null,
        notes: value.notes?.trim() || undefined,
        lostReason: value.status === 'LOST' ? value.lostReason?.trim() || undefined : undefined,
      };

      this.leadService.updateLead(lead._id, payload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: () => {
            toast.success('Lead updated successfully.');
            this.closeModal();
            this.loadLeads();
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to update lead.');
          },
        });
    } else {
      const payload: CreateLeadPayload = {
        customerName: value.customerName!.trim(),
        companyName: value.companyName?.trim() || undefined,
        email: value.email?.trim() || undefined,
        phone: value.phone?.trim() || undefined,
        source: value.source as LeadSource,
        interestedIn: value.interestedIn?.trim() || undefined,
        estimatedValue: value.estimatedValue ? Number(value.estimatedValue) : undefined,
        priority: value.priority as LeadPriority,
        assignedTo: value.assignedTo?.trim() || undefined,
        nextFollowUpAt: value.nextFollowUpAt ? new Date(value.nextFollowUpAt).toISOString() : null,
        notes: value.notes?.trim() || undefined,
      };

      this.leadService.createLead(payload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: () => {
            toast.success('Lead created successfully.');
            this.closeModal();
            this.loadLeads();
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to create lead.');
          },
        });
    }
  }

  archiveLead(): void {
    const lead = this.selectedLead();
    if (!lead) return;

    this.isSubmitting.set(true);
    this.leadService.archiveLead(lead._id)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success('Lead archived successfully.');
          this.closeModal();
          this.loadLeads();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to archive lead.');
        },
      });
  }

  
  getStatusLabel(status: LeadStatus | 'ALL' | string): string {
    if (status === 'ALL') return 'All';
    return (LEAD_STATUS_LABELS as Record<string, string>)[status] || status;
  }

  quickChangeStatus(lead: Lead, newStatus: LeadStatus): void {
    if (!lead || lead.status === newStatus || this.isSubmitting()) return;
    this.isSubmitting.set(true);

    this.leadService.updateLead(lead._id, { status: newStatus })
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success(`Lead status changed to "${this.getStatusLabel(newStatus)}".`);
          if (this.selectedLead()?._id === lead._id) {
            this.selectedLead.update((l) => (l ? { ...l, status: newStatus } : null));
          }
          this.loadLeads();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to update lead status.');
        },
      });
  }

  moveToAdmissions(lead: Lead): void {
    if (!lead || this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const now = new Date();
    const intakeMonth = ((now.getMonth() + 1) % 12) + 1;
    const intakeYear = now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0);

    this.leadService.updateLead(lead._id, { status: 'ADMISSIONS' })
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.admissionsService.createApplication({
            studentId: lead._id,
            studyLevel: 'BACHELOR',
            intakeMonth,
            intakeYear,
            counsellorId: lead.assignedTo?._id || undefined,
            leadSource: lead.source ? lead.source.toLowerCase() : 'other',
          }).subscribe({
            next: (app) => {
              toast.success(`Enrolled ${lead.customerName} into Admissions Student Journey!`, {
                action: {
                  label: 'View Student',
                  onClick: () => this.router.navigate(['/admissions/students', app.id]),
                },
              });
              if (this.selectedLead()?._id === lead._id) {
                this.selectedLead.update((l) => (l ? { ...l, status: 'ADMISSIONS' } : null));
              }
              this.loadLeads();
            },
            error: () => {
              toast.success(`Lead ${lead.customerName} moved to Admissions.`);
              if (this.selectedLead()?._id === lead._id) {
                this.selectedLead.update((l) => (l ? { ...l, status: 'ADMISSIONS' } : null));
              }
              this.loadLeads();
            },
          });
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to move lead to admissions.');
        },
      });
  }

  
  openConvertToAdmissionsModal(lead: Lead): void {
    this.leadToConvert.set(lead);
    const isMaster = (lead.interestedIn || '').toLowerCase().includes('master');
    this.convertStudyLevel.set(isMaster ? 'MASTER' : 'BACHELOR');
    this.convertIntakeMonth.set(9);
    this.convertIntakeYear.set(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
    this.convertCounsellorId.set(lead.assignedTo?._id || this.currentUser()?.id || '');
    this.isConvertModalOpen.set(true);
  }

  closeConvertModal(): void {
    this.isConvertModalOpen.set(false);
    this.leadToConvert.set(null);
  }

  confirmConvertToAdmissions(): void {
    const lead = this.leadToConvert();
    if (!lead || this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const payload = {
      studentId: lead._id,
      studyLevel: this.convertStudyLevel(),
      intakeMonth: Number(this.convertIntakeMonth()),
      intakeYear: Number(this.convertIntakeYear()),
      counsellorId: this.convertCounsellorId() || undefined,
      leadSource: lead.source ? lead.source.toLowerCase() : 'other',
    };

    this.admissionsService.createApplication(payload).subscribe({
      next: (app) => {
        this.leadService.updateLead(lead._id, { status: 'ADMISSIONS' }).subscribe({
          next: () => {
            this.isSubmitting.set(false);
            this.closeConvertModal();
            toast.success(`Converted ${lead.customerName} into Admissions Student Journey!`);
            this.loadLeads();
            this.router.navigate(['/admissions/students', app.id]);
          },
          error: () => {
            this.isSubmitting.set(false);
            this.closeConvertModal();
            toast.success(`Converted ${lead.customerName} into Admissions Student Journey!`);
            this.loadLeads();
            this.router.navigate(['/admissions/students', app.id]);
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (err.error?.message?.includes('already exists') || err.status === 409) {
          this.leadService.updateLead(lead._id, { status: 'ADMISSIONS' }).subscribe(() => {
            toast.success(`Lead ${lead.customerName} moved to Admissions status.`);
            this.closeConvertModal();
            this.loadLeads();
            this.router.navigate(['/admissions/overview']);
          });
        } else {
          toast.error(err.error?.message || 'Failed to convert lead to admissions.');
        }
      }
    });
  }

  getStatusClass(status: LeadStatus): string {
    return this.statusClasses[status] || 'badge-status-new';
  }

  getPriorityClass(priority: LeadPriority): string {
    return this.priorityClasses[priority] || 'badge-priority-medium';
  }
}
