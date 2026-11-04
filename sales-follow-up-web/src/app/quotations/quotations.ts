import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import {
  CreateQuotationPayload,
  Quotation,
  QuotationFilters,
  QuotationItem,
  QuotationItemPayload,
  QuotationLeadRef,
  QuotationPagination,
  QuotationService,
  QuotationStatus,
  QuotationSummary,
  SUPPORTED_CURRENCIES,
  UpdateQuotationPayload,
} from '../core/services/quotation.service';
import { Lead, LeadService } from '../core/services/lead.service';
import { TeamMember, TeamService } from '../core/services/team.service';
import { AuthService, AuthUser } from '../core/services/auth.service';

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DatePipe, CurrencyPipe],
  templateUrl: './quotations.html',
  styleUrl: './quotations.scss',
})
export class Quotations implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly quotationService = inject(QuotationService);
  private readonly leadService = inject(LeadService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);

  readonly supportedCurrencies = SUPPORTED_CURRENCIES;

  // View state: 'list' | 'form' | 'detail'
  activeView = signal<'list' | 'form' | 'detail'>('list');
  isEditMode = signal(false);
  editingQuotationId = signal<string | null>(null);

  // Data Signals
  quotations = signal<Quotation[]>([]);
  leadsList = signal<Lead[]>([]);
  teamMembers = signal<TeamMember[]>([]);
  selectedQuotation = signal<Quotation | null>(null);
  selectedLeadDetails = signal<Lead | null>(null);

  // Pagination & Filters
  pagination = signal<QuotationPagination>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  currentPage = signal(1);
  pageSize = signal(10);
  searchQuery = signal('');
  statusFilter = signal<QuotationStatus | 'ALL'>('ALL');
  assignedFilter = signal<string>('ALL');
  startDateFilter = signal<string>('');
  endDateFilter = signal<string>('');

  // UI State
  isLoading = signal(false);
  isSubmitting = signal(false);
  currentUser = signal<AuthUser | null>(null);

  // Modal Signals
  isStatusModalOpen = signal(false);
  targetStatus = signal<'SENT' | 'ACCEPTED' | 'REJECTED' | null>(null);
  quotationForStatus = signal<Quotation | null>(null);

  isDeleteModalOpen = signal(false);
  quotationToDelete = signal<Quotation | null>(null);

  // Role Permissions
  isOwner = computed(() => this.currentUser()?.role === 'OWNER');
  isManager = computed(() => this.currentUser()?.role === 'SALES_MANAGER');
  canManageTeam = computed(() => this.isOwner() || this.isManager());

  // Metrics summary directly from backend
  summary = signal<QuotationSummary | null>(null);

  // Reactive Form
  quotationForm: FormGroup = this.fb.group({
    leadId: ['', [Validators.required]],
    customerName: [''],
    companyName: [''],
    email: [''],
    phone: [''],
    billingAddress: [''],
    quotationDate: ['', [Validators.required]],
    validUntil: ['', [Validators.required]],
    subject: ['', [Validators.maxLength(200)]],
    currency: ['INR', [Validators.required]],
    discount: [0, [Validators.min(0)]],
    termsAndConditions: ['', [Validators.maxLength(5000)]],
    customerNotes: ['', [Validators.maxLength(2000)]],
    internalNotes: ['', [Validators.maxLength(2000)]],
    items: this.fb.array([]),
  });

  get itemsFormArray(): FormArray {
    return this.quotationForm.get('items') as FormArray;
  }

  ngOnInit(): void {
    this.currentUser.set(this.authService.getUser());
    this.loadQuotations();
    this.loadLeads();
    this.loadTeamMembers();
  }

  // --- Backend Data Loading ---
  loadQuotations(): void {
    this.isLoading.set(true);

    const filters: QuotationFilters = {
      search: this.searchQuery().trim() || undefined,
      status: this.statusFilter() !== 'ALL' ? this.statusFilter() : undefined,
      assignedTo:
        this.canManageTeam() && this.assignedFilter() !== 'ALL' && this.assignedFilter() !== ''
          ? this.assignedFilter()
          : undefined,
      startDate: this.startDateFilter() || undefined,
      endDate: this.endDateFilter() || undefined,
      page: this.currentPage(),
      limit: this.pageSize(),
    };

    this.quotationService
      .getQuotations(filters)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (result) => {
          this.quotations.set(result.quotations || []);
          this.pagination.set(
            result.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 }
          );
          if (result.summary) {
            this.summary.set(result.summary);
          }
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to load quotations from server.');
        },
      });
  }

  loadLeads(): void {
    this.leadService.getLeads({ limit: 100 }).subscribe({
      next: (res) => {
        this.leadsList.set(res.leads || []);
      },
      error: () => {},
    });
  }

  loadTeamMembers(): void {
    if (!this.canManageTeam()) return;
    this.teamService.getTeamMembers({ status: 'ACTIVE', limit: 100 }).subscribe({
      next: (res) => {
        this.teamMembers.set(res.data || []);
      },
      error: () => {},
    });
  }

  // --- Filter and Search Handlers ---
  applyFilters(): void {
    this.currentPage.set(1);
    this.loadQuotations();
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.applyFilters();
  }

  setStatusFilter(status: QuotationStatus | 'ALL'): void {
    this.statusFilter.set(status);
    this.applyFilters();
  }

  onAssignedChange(event: Event): void {
    this.assignedFilter.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  onDateFilterChange(): void {
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set('ALL');
    this.assignedFilter.set('ALL');
    this.startDateFilter.set('');
    this.endDateFilter.set('');
    this.applyFilters();
  }

  // --- Pagination Handlers ---
  goToPage(page: number): void {
    if (page < 1 || page > this.pagination().totalPages) return;
    this.currentPage.set(page);
    this.loadQuotations();
  }

  // --- View Switching ---
  switchView(view: 'list' | 'form' | 'detail'): void {
    this.activeView.set(view);
  }

  openCreateForm(): void {
    this.isEditMode.set(false);
    this.editingQuotationId.set(null);
    this.selectedQuotation.set(null);
    this.selectedLeadDetails.set(null);

    // Default dates: today and +15 days
    const today = new Date();
    const validUntilDate = new Date();
    validUntilDate.setDate(today.getDate() + 15);

    const todayStr = today.toISOString().split('T')[0];
    const validUntilStr = validUntilDate.toISOString().split('T')[0];

    this.itemsFormArray.clear();
    this.addItem(); // Start with 1 empty item

    this.quotationForm.reset({
      leadId: '',
      customerName: '',
      companyName: '',
      email: '',
      phone: '',
      billingAddress: '',
      quotationDate: todayStr,
      validUntil: validUntilStr,
      subject: '',
      currency: 'INR',
      discount: 0,
      termsAndConditions: 'Payment due within 30 days of quotation acceptance. Deliverables subject to our master service agreement.',
      customerNotes: 'Thank you for your business. We look forward to partnering with you.',
      internalNotes: '',
    });

    this.loadLeads();
    this.switchView('form');
  }

  openEditForm(quotation: Quotation): void {
    if (quotation.status !== 'DRAFT') {
      toast.error('Only DRAFT quotations can be edited.');
      return;
    }

    this.isEditMode.set(true);
    this.editingQuotationId.set(quotation._id);
    this.selectedQuotation.set(quotation);

    const leadId = typeof quotation.leadId === 'object' ? quotation.leadId._id : quotation.leadId;
    const qDate = quotation.quotationDate ? quotation.quotationDate.split('T')[0] : '';
    const vDate = quotation.validUntil ? quotation.validUntil.split('T')[0] : '';

    this.itemsFormArray.clear();
    if (quotation.items && quotation.items.length > 0) {
      quotation.items.forEach((item) => this.addItem(item));
    } else {
      this.addItem();
    }

    this.quotationForm.patchValue({
      leadId,
      customerName: quotation.customer?.name || '',
      companyName: quotation.customer?.companyName || '',
      email: quotation.customer?.email || '',
      phone: quotation.customer?.phone || '',
      billingAddress: quotation.customer?.billingAddress || '',
      quotationDate: qDate,
      validUntil: vDate,
      subject: quotation.subject || '',
      currency: quotation.currency || 'INR',
      discount: quotation.discount || 0,
      termsAndConditions: quotation.termsAndConditions || '',
      customerNotes: quotation.customerNotes || '',
      internalNotes: quotation.internalNotes || '',
    });

    this.onLeadSelected(leadId, false);
    this.switchView('form');
  }

  viewQuotationDetails(quotation: Quotation): void {
    this.selectedQuotation.set(quotation);
    this.switchView('detail');

    // Fetch latest details by ID to ensure full population
    this.quotationService.getQuotationById(quotation._id).subscribe({
      next: (fullQuotation) => {
        this.selectedQuotation.set(fullQuotation);
      },
      error: () => {},
    });
  }

  // --- Lead Selection in Form ---
  onLeadChange(event: Event): void {
    const leadId = (event.target as HTMLSelectElement).value;
    this.onLeadSelected(leadId, true);
  }

  private onLeadSelected(leadId: string, populateFields = true): void {
    if (!leadId) {
      this.selectedLeadDetails.set(null);
      if (populateFields) {
        this.quotationForm.patchValue({
          customerName: '',
          companyName: '',
          email: '',
          phone: '',
        });
      }
      return;
    }

    const lead = this.leadsList().find((l) => l._id === leadId);
    if (lead) {
      this.selectedLeadDetails.set(lead);
      if (populateFields) {
        this.quotationForm.patchValue({
          customerName: lead.customerName,
          companyName: lead.companyName || '',
          email: lead.email || '',
          phone: lead.phone || '',
        });
      }
    } else {
      // Fetch lead directly if not in initial 100 list
      this.leadService.getLead(leadId).subscribe({
        next: (fetchedLead) => {
          this.selectedLeadDetails.set(fetchedLead);
          if (populateFields) {
            this.quotationForm.patchValue({
              customerName: fetchedLead.customerName,
              companyName: fetchedLead.companyName || '',
              email: fetchedLead.email || '',
              phone: fetchedLead.phone || '',
            });
          }
        },
        error: () => {},
      });
    }
  }

  // --- Dynamic Items Management ---
  createItemFormGroup(item?: Partial<QuotationItem>): FormGroup {
    return this.fb.group({
      itemName: [item?.itemName || '', [Validators.required, Validators.maxLength(200)]],
      description: [item?.description || '', [Validators.maxLength(1000)]],
      quantity: [item?.quantity ?? 1, [Validators.required, Validators.min(0.001)]],
      unit: [item?.unit || 'PCS', [Validators.maxLength(30)]],
      unitPrice: [item?.unitPrice ?? 0, [Validators.required, Validators.min(0)]],
      discount: [item?.discount ?? 0, [Validators.min(0)]],
      taxRate: [item?.taxRate ?? 0, [Validators.min(0), Validators.max(100)]],
    });
  }

  addItem(item?: Partial<QuotationItem>): void {
    if (this.itemsFormArray.length >= 100) {
      toast.error('Maximum 100 items allowed per quotation.');
      return;
    }
    this.itemsFormArray.push(this.createItemFormGroup(item));
  }

  removeItem(index: number): void {
    if (this.itemsFormArray.length <= 1) {
      toast.error('A quotation must contain at least one item.');
      return;
    }
    this.itemsFormArray.removeAt(index);
  }

  // --- Calculation Helpers for Live Form Preview ---
  getItemCalculations(group: FormGroup): {
    gross: number;
    discount: number;
    taxable: number;
    tax: number;
    amount: number;
  } {
    const qty = Number(group.get('quantity')?.value) || 0;
    const price = Number(group.get('unitPrice')?.value) || 0;
    const discount = Number(group.get('discount')?.value) || 0;
    const taxRate = Number(group.get('taxRate')?.value) || 0;

    const gross = Math.round((qty * price + Number.EPSILON) * 100) / 100;
    const safeDiscount = Math.min(discount, gross);
    const taxable = Math.round((gross - safeDiscount + Number.EPSILON) * 100) / 100;
    const tax = Math.round(((taxable * taxRate) / 100 + Number.EPSILON) * 100) / 100;
    const amount = Math.round((taxable + tax + Number.EPSILON) * 100) / 100;

    return { gross, discount: safeDiscount, taxable, tax, amount };
  }

  get formSubtotal(): number {
    return this.itemsFormArray.controls.reduce((acc, ctrl) => {
      const calc = this.getItemCalculations(ctrl as FormGroup);
      return Math.round((acc + calc.gross + Number.EPSILON) * 100) / 100;
    }, 0);
  }

  get formTotalItemDiscount(): number {
    return this.itemsFormArray.controls.reduce((acc, ctrl) => {
      const calc = this.getItemCalculations(ctrl as FormGroup);
      return Math.round((acc + calc.discount + Number.EPSILON) * 100) / 100;
    }, 0);
  }

  get formOverallDiscount(): number {
    const val = Number(this.quotationForm.get('discount')?.value) || 0;
    return Math.max(0, val);
  }

  get formTotalTax(): number {
    return this.itemsFormArray.controls.reduce((acc, ctrl) => {
      const calc = this.getItemCalculations(ctrl as FormGroup);
      return Math.round((acc + calc.tax + Number.EPSILON) * 100) / 100;
    }, 0);
  }

  get formGrandTotal(): number {
    const discounted = Math.max(0, this.formSubtotal - this.formTotalItemDiscount);
    const afterOverall = Math.max(0, discounted - this.formOverallDiscount);
    return Math.round((afterOverall + this.formTotalTax + Number.EPSILON) * 100) / 100;
  }

  // --- Save / Submit Quotation ---
  saveQuotation(andSend = false): void {
    if (this.quotationForm.invalid || this.isSubmitting()) {
      this.quotationForm.markAllAsTouched();
      this.itemsFormArray.controls.forEach((c) => (c as FormGroup).markAllAsTouched());

      const firstInvalid = this.findFirstInvalidField();
      toast.error(firstInvalid || 'Please complete all required fields correctly.');
      return;
    }

    const formVal = this.quotationForm.value;

    // Validate dates
    const qDate = new Date(formVal.quotationDate);
    const vDate = new Date(formVal.validUntil);
    const now = new Date();

    if (vDate <= qDate) {
      toast.error('Valid Until date must be strictly after the Quotation Date.');
      return;
    }

    if (vDate <= now) {
      toast.error('Quotation expiry date must be in the future.');
      return;
    }

    // Build payload items
    const itemsPayload: QuotationItemPayload[] = this.itemsFormArray.controls.map((ctrl) => {
      const val = ctrl.value;
      return {
        itemName: val.itemName.trim(),
        description: val.description?.trim() || undefined,
        quantity: Number(val.quantity),
        unit: val.unit?.trim() || 'PCS',
        unitPrice: Number(val.unitPrice),
        discount: Number(val.discount) || 0,
        taxRate: Number(val.taxRate) || 0,
      };
    });

    this.isSubmitting.set(true);

    if (this.isEditMode() && this.editingQuotationId()) {
      const updatePayload: UpdateQuotationPayload = {
        quotationDate: formVal.quotationDate,
        validUntil: formVal.validUntil,
        subject: formVal.subject?.trim() || undefined,
        items: itemsPayload,
        discount: Number(formVal.discount) || 0,
        currency: formVal.currency,
        termsAndConditions: formVal.termsAndConditions?.trim() || undefined,
        customerNotes: formVal.customerNotes?.trim() || undefined,
        internalNotes: formVal.internalNotes?.trim() || undefined,
      };

      this.quotationService
        .updateQuotation(this.editingQuotationId()!, updatePayload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: (updated) => {
            toast.success('Quotation updated successfully.');
            if (andSend) {
              this.executeStatusChange(updated._id, 'SENT');
            } else {
              this.loadQuotations();
              this.switchView('list');
            }
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to update quotation.');
          },
        });
    } else {
      const createPayload: CreateQuotationPayload = {
        leadId: formVal.leadId,
        quotationDate: formVal.quotationDate,
        validUntil: formVal.validUntil,
        subject: formVal.subject?.trim() || undefined,
        items: itemsPayload,
        discount: Number(formVal.discount) || 0,
        currency: formVal.currency,
        termsAndConditions: formVal.termsAndConditions?.trim() || undefined,
        customerNotes: formVal.customerNotes?.trim() || undefined,
        internalNotes: formVal.internalNotes?.trim() || undefined,
      };

      this.quotationService
        .createQuotation(createPayload)
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: (created) => {
            toast.success('Quotation draft created successfully.');
            if (andSend) {
              this.executeStatusChange(created._id, 'SENT');
            } else {
              this.loadQuotations();
              this.switchView('list');
            }
          },
          error: (err) => {
            toast.error(err.error?.message || 'Failed to create quotation.');
          },
        });
    }
  }

  private findFirstInvalidField(): string | null {
    if (this.quotationForm.get('leadId')?.invalid) return 'Please select a related customer lead.';
    if (this.quotationForm.get('quotationDate')?.invalid) return 'Please enter a valid quotation date.';
    if (this.quotationForm.get('validUntil')?.invalid) return 'Please enter a valid expiry date.';
    if (this.itemsFormArray.length === 0) return 'At least one item is required.';

    for (let i = 0; i < this.itemsFormArray.length; i++) {
      const itemGroup = this.itemsFormArray.at(i) as FormGroup;
      if (itemGroup.get('itemName')?.invalid) return `Item #${i + 1} name is required.`;
      if (itemGroup.get('quantity')?.invalid) return `Item #${i + 1} requires a positive quantity.`;
      if (itemGroup.get('unitPrice')?.invalid) return `Item #${i + 1} requires a valid unit price.`;
    }

    return null;
  }

  // --- Status Transitions ---
  openStatusModal(quotation: Quotation, status: 'SENT' | 'ACCEPTED' | 'REJECTED'): void {
    this.quotationForStatus.set(quotation);
    this.targetStatus.set(status);
    this.isStatusModalOpen.set(true);
  }

  closeStatusModal(): void {
    this.isStatusModalOpen.set(false);
    this.quotationForStatus.set(null);
    this.targetStatus.set(null);
  }

  confirmStatusChange(): void {
    const q = this.quotationForStatus();
    const status = this.targetStatus();
    if (!q || !status) return;

    this.executeStatusChange(q._id, status);
    this.closeStatusModal();
  }

  private executeStatusChange(id: string, status: 'SENT' | 'ACCEPTED' | 'REJECTED'): void {
    this.isLoading.set(true);
    this.quotationService
      .updateQuotationStatus(id, status)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (updated) => {
          toast.success(`Quotation marked as ${status}.`);
          this.loadQuotations();
          if (this.activeView() === 'detail' && this.selectedQuotation()?._id === id) {
            this.selectedQuotation.set(updated);
          } else if (this.activeView() === 'form') {
            this.switchView('list');
          }
        },
        error: (err) => {
          toast.error(err.error?.message || `Failed to transition quotation to ${status}.`);
        },
      });
  }

  // --- Delete Draft Quotation ---
  openDeleteModal(quotation: Quotation): void {
    if (quotation.status !== 'DRAFT') {
      toast.error('Only DRAFT quotations can be deleted.');
      return;
    }
    this.quotationToDelete.set(quotation);
    this.isDeleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    this.isDeleteModalOpen.set(false);
    this.quotationToDelete.set(null);
  }

  confirmDelete(): void {
    const q = this.quotationToDelete();
    if (!q) return;

    this.isLoading.set(true);
    this.quotationService
      .deleteQuotation(q._id)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: () => {
          toast.success('Quotation deleted successfully.');
          this.closeDeleteModal();
          if (this.activeView() === 'detail') {
            this.switchView('list');
          }
          this.loadQuotations();
        },
        error: (err) => {
          toast.error(err.error?.message || 'Failed to delete quotation.');
          this.closeDeleteModal();
        },
      });
  }

  // --- Display / Utility Helpers ---
  getLeadDisplay(lead: QuotationLeadRef | string | null | undefined): string {
    if (!lead) return '—';
    if (typeof lead === 'object') {
      return lead.companyName
        ? `${lead.customerName} (${lead.companyName})`
        : lead.customerName;
    }
    return lead;
  }

  getUserDisplay(user: any): string {
    if (!user) return '—';
    if (typeof user === 'object' && user.name) return user.name;
    return String(user);
  }

  getStatusClass(status: QuotationStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'badge-draft';
      case 'SENT':
        return 'badge-sent';
      case 'ACCEPTED':
        return 'badge-accepted';
      case 'REJECTED':
        return 'badge-rejected';
      case 'EXPIRED':
        return 'badge-expired';
      default:
        return 'badge-draft';
    }
  }

  canEdit(q: Quotation): boolean {
    return q.status === 'DRAFT';
  }

  canDelete(q: Quotation): boolean {
    return q.status === 'DRAFT';
  }

  canSend(q: Quotation): boolean {
    return q.status === 'DRAFT';
  }

  canAcceptOrReject(q: Quotation): boolean {
    return q.status === 'SENT';
  }
}
