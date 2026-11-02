import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { toast } from 'ngx-sonner';

import { AuthService } from '../core/services/auth.service';
import {
  TeamService,
  TeamMember,
  MemberPayload,
  MemberPagination,
  MemberSummaryCounts,
  MemberFilters,
} from '../core/services/team.service';

@Component({
  selector: 'app-team',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe],
  templateUrl: './team.html',
  styleUrl: './team.scss',
})
export class Team implements OnInit {
  private fb = inject(FormBuilder);
  private teamService = inject(TeamService);
  private authService = inject(AuthService);
  private router = inject(Router);

  currentUser = signal(this.authService.getUser());
  isOwner = computed(() => this.currentUser()?.role === 'OWNER');

  teamMembers = signal<TeamMember[]>([]);
  managers = signal<TeamMember[]>([]);
  isLoading = signal(false);
  isSubmitting = signal(false);

  // Modals & Selected Member
  isAddModalOpen = signal(false);
  isEditModalOpen = signal(false);
  isDeleteModalOpen = signal(false);
  selectedMember = signal<TeamMember | null>(null);

  // Add Form
  addForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['SALESPERSON', Validators.required],
    managerId: ['', Validators.required],
  });

  // Edit Form
  editForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    role: ['SALESPERSON', Validators.required],
    managerId: ['', Validators.required],
  });

  // Filter State
  filters = signal<MemberFilters>({
    search: '',
    role: 'ALL',
    status: 'ALL',
  });

  hasActiveFilters = computed(() => {
    const f = this.filters();
    return !!f.search?.trim() || f.role !== 'ALL' || f.status !== 'ALL';
  });

  pagination = signal<MemberPagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  summary = signal<MemberSummaryCounts>({
    totalMembers: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    salesManagers: 0,
    salespersons: 0,
  });

  ngOnInit(): void {
    if (!this.isOwner()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loadMembers();
    this.loadManagers();
  }

  loadManagers(): void {
    this.teamService.getManagers().subscribe({
      next: (managers) => this.managers.set(managers),
      error: () => { },
    });
  }

  loadMembers(): void {
    this.isLoading.set(true);

    this.teamService.getTeamMembers({
      ...this.filters(),
      page: this.pagination().page,
      limit: this.pagination().limit,
    })
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.teamMembers.set(res.data);
          this.pagination.set(res.pagination);
          if (res.summary) {
            this.summary.set(res.summary);
          }
        },
        error: () => {
          toast.error('Failed to load team members.');
        },
      });
  }

  onSearch(event: Event): void {
    const search = (event.target as HTMLInputElement).value;
    this.filters.update((f) => ({ ...f, search }));
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadMembers();
  }

  clearSearch(): void {
    this.filters.update((f) => ({ ...f, search: '' }));
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadMembers();
  }

  onRoleChange(event: Event): void {
    const role = (event.target as HTMLSelectElement).value as MemberFilters['role'];
    this.filters.update((f) => ({ ...f, role }));
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadMembers();
  }

  onStatusChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as MemberFilters['status'];
    this.filters.update((f) => ({ ...f, status }));
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadMembers();
  }

  resetFilters(): void {
    this.filters.set({ search: '', role: 'ALL', status: 'ALL' });
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadMembers();
  }

  onPageChange(newPage: number): void {
    if (newPage < 1 || newPage > this.pagination().totalPages) return;
    this.pagination.update((p) => ({ ...p, page: newPage }));
    this.loadMembers();
  }

  onLimitChange(event: Event): void {
    const limit = Number((event.target as HTMLSelectElement).value) || 10;
    this.pagination.update((p) => ({ ...p, limit, page: 1 }));
    this.loadMembers();
  }

  updateRoleValidators(type: 'add' | 'edit'): void {
    const roleControl = type === 'add' ? this.addForm.controls.role : this.editForm.controls.role;
    const managerControl = type === 'add' ? this.addForm.controls.managerId : this.editForm.controls.managerId;

    if (roleControl.value === 'SALESPERSON') {
      managerControl.setValidators([Validators.required]);
    } else {
      managerControl.clearValidators();
      managerControl.setValue('');
    }
    managerControl.updateValueAndValidity();
  }

  // --- Add Member ---
  openAddModal(): void {
    this.loadManagers();
    this.addForm.reset({
      name: '',
      email: '',
      password: '',
      role: 'SALESPERSON',
      managerId: '',
    });
    this.updateRoleValidators('add');
    this.isAddModalOpen.set(true);
  }

  submitAdd(): void {
    const roleVal = this.addForm.get('role')?.value;
    const managerVal = this.addForm.get('managerId')?.value;
    if (roleVal === 'SALESPERSON' && (!managerVal || !managerVal.trim())) {
      this.addForm.get('managerId')?.setErrors({ required: true });
      this.addForm.get('managerId')?.markAsTouched();
      toast.error('Please select a sales manager for this sales representative.');
      return;
    }

    if (this.addForm.invalid || this.isSubmitting()) {
      this.addForm.markAllAsTouched();
      return;
    }

    const value = this.addForm.getRawValue();
    const payload: MemberPayload = {
      name: value.name!.trim(),
      email: value.email!.trim(),
      password: value.password!,
      role: value.role as MemberPayload['role'],
      managerId: value.role === 'SALESPERSON' && value.managerId ? value.managerId : null,
    };

    this.isSubmitting.set(true);
    this.teamService.addMember(payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success('Team member created successfully.');
          this.isAddModalOpen.set(false);
          this.loadMembers();
          this.loadManagers();
        },
        error: (err) => {
          toast.error(err?.error?.message || 'Failed to create team member.');
        },
      });
  }

  // --- Edit Member ---
  openEditModal(member: TeamMember): void {
    this.loadManagers();
    this.selectedMember.set(member);
    const currentManagerId = typeof member.managerId === 'object' && member.managerId
      ? member.managerId._id
      : (typeof member.managerId === 'string' ? member.managerId : '');

    this.editForm.setValue({
      name: member.name,
      email: member.email,
      role: member.role,
      managerId: currentManagerId || '',
    });
    this.isEditModalOpen.set(true);
  }

  submitEdit(): void {
    const roleVal = this.editForm.get('role')?.value;
    const managerVal = this.editForm.get('managerId')?.value;
    if (roleVal === 'SALESPERSON' && (!managerVal || !managerVal.trim())) {
      this.editForm.get('managerId')?.setErrors({ required: true });
      this.editForm.get('managerId')?.markAsTouched();
      toast.error('Please select a sales manager for this sales representative.');
      return;
    }

    if (this.editForm.invalid || this.isSubmitting()) {
      this.editForm.markAllAsTouched();
      return;
    }

    const member = this.selectedMember();
    if (!member) return;

    const value = this.editForm.getRawValue();
    const payload: Partial<MemberPayload> = {
      name: value.name!.trim(),
      email: value.email!.trim(),
      role: value.role as MemberPayload['role'],
      managerId: value.role === 'SALESPERSON' && value.managerId ? value.managerId : null,
    };

    this.isSubmitting.set(true);
    this.teamService.updateMember(member._id, payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success('Team member updated successfully.');
          this.isEditModalOpen.set(false);
          this.loadMembers();
          this.loadManagers();
        },
        error: (err) => {
          toast.error(err?.error?.message || 'Failed to update team member.');
        },
      });
  }

  // --- Delete Member ---
  openDeleteModal(member: TeamMember): void {
    this.selectedMember.set(member);
    this.isDeleteModalOpen.set(true);
  }

  confirmDelete(): void {
    const member = this.selectedMember();
    if (!member) return;

    this.isSubmitting.set(true);
    this.teamService.deleteMember(member._id)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          toast.success(`Member ${member.name} deleted successfully.`);
          this.isDeleteModalOpen.set(false);
          this.loadMembers();
          this.loadManagers();
        },
        error: (err) => {
          toast.error(err?.error?.message || 'Failed to delete member.');
          this.isDeleteModalOpen.set(false);
        },
      });
  }

  // --- Toggle Active/Inactive Status ---
  onToggleStatus(member: TeamMember, event?: Event): void {
    if (event) event.stopPropagation();
    const newStatus = !member.isActive;

    // Optimistic UI update
    this.teamMembers.update((members) =>
      members.map((m) => (m._id === member._id ? { ...m, isActive: newStatus } : m))
    );

    this.teamService.toggleMemberStatus(member._id, newStatus).subscribe({
      next: () => {
        toast.success(`Member ${newStatus ? 'activated' : 'deactivated'} successfully.`);
        this.loadMembers();
        this.loadManagers();
      },
      error: (err) => {
        // Rollback on error
        this.teamMembers.update((members) =>
          members.map((m) => (m._id === member._id ? { ...m, isActive: member.isActive } : m))
        );
        toast.error(err?.error?.message || 'Failed to update status.');
      },
    });
  }

  getManagerName(member: TeamMember): string | null {
    if (!member.managerId) return null;
    if (typeof member.managerId === 'object' && member.managerId?.name) {
      return member.managerId.name;
    }
    const found = this.managers().find((m) => m._id === member.managerId);
    return found ? found.name : null;
  }
}
