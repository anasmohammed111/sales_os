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
  UpdateLeadPayload,
} from '../core/services/lead.service';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { TeamService, TeamMember } from '../core/services/team.service';

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, DatePipe, CurrencyPipe],
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

  // Status and Priority CSS Class Lookup Maps
  private readonly statusClasses: Record<LeadStatus, string> = {
    NEW: 'badge-status-new',
    CONTACTED: 'badge-status-contacted',
    QUALIFIED: 'badge-status-qualified',
    QUOTATION_SENT: 'badge-status-quotation',
    NEGOTIATION: 'badge-status-negotiation',
    WON: 'badge-status-won',
    LOST: 'badge-status-lost',
  };

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

  getStatusClass(status: LeadStatus): string {
    return this.statusClasses[status] || 'badge-status-new';
  }

  getPriorityClass(priority: LeadPriority): string {
    return this.priorityClasses[priority] || 'badge-priority-medium';
  }
}
