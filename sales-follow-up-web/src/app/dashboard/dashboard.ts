import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { Leads } from '../leads/leads';
import { FollowUps } from '../follow-ups/follow-ups';
import { Team } from '../team/team';
import { Pipeline } from '../pipeline/pipeline';
import { Quotations } from '../quotations/quotations';

export interface FollowUpItem {
  id: string;
  leadName: string;
  company: string;
  dealValue: string;
  channel: 'call' | 'email' | 'whatsapp' | 'meeting';
  status: 'pending' | 'urgent' | 'completed';
  dueTime: string;
  note: string;
  priority: 'Urgent' | 'High' | 'Medium';
}

export interface PipelineStage {
  name: string;
  count: number;
  value: string;
  percent: number;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, Leads, FollowUps, Team, Pipeline, Quotations],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  router = inject(Router);
  private authService = inject(AuthService);

  currentTab = signal<'dashboard' | 'leads' | 'follow-ups' | 'team' | 'pipeline' | 'quotations'>(
    this.router.url.includes('follow-ups')
      ? 'follow-ups'
      : this.router.url.includes('leads')
      ? 'leads'
      : this.router.url.includes('team')
      ? 'team'
      : this.router.url.includes('pipeline')
      ? 'pipeline'
      : this.router.url.includes('quotations')
      ? 'quotations'
      : 'dashboard'
  );
  user = signal<AuthUser | null>(this.authService.getUser());
  isOwner = computed(() => this.user()?.role === 'OWNER');

  constructor() {
    this.router.events.subscribe(() => {
      if (this.router.url.includes('follow-ups')) {
        this.currentTab.set('follow-ups');
      } else if (this.router.url.includes('leads')) {
        this.currentTab.set('leads');
      } else if (this.router.url.includes('team')) {
        if (!this.isOwner()) {
          this.navigateTo('dashboard');
        } else {
          this.currentTab.set('team');
        }
      } else if (this.router.url.includes('pipeline')) {
        this.currentTab.set('pipeline');
      } else if (this.router.url.includes('quotations')) {
        this.currentTab.set('quotations');
      } else {
        this.currentTab.set('dashboard');
      }
    });
  }

  isMobileMoreOpen = signal(false);

  navigateTo(tab: 'dashboard' | 'leads' | 'follow-ups' | 'team' | 'pipeline' | 'quotations'): void {
    if (tab === 'team' && !this.isOwner()) {
      return;
    }
    this.currentTab.set(tab);
    this.isMobileMoreOpen.set(false);
    this.router.navigate([tab === 'dashboard' ? '/dashboard' : `/${tab}`]);
  }

  toggleMobileMore(): void {
    this.isMobileMoreOpen.update((open) => !open);
  }

  closeMobileMore(): void {
    this.isMobileMoreOpen.set(false);
  }

  searchQuery = signal('');
  activeFilter = signal<'all' | 'urgent' | 'call' | 'quotation' | 'completed'>('all');
  isQuickAddOpen = signal(false);

  // New follow-up quick form state
  newLeadName = '';
  newCompany = '';
  newDealValue = '';
  newChannel: 'call' | 'email' | 'whatsapp' | 'meeting' = 'call';
  newDueTime = 'Today, 4:00 PM';
  newNote = '';

  // Pipeline stages
  pipelineStages = signal<PipelineStage[]>([
    { name: 'Lead Qualified', count: 18, value: '$42,500', percent: 28, color: '#3b82f6' },
    { name: 'Follow-up Due', count: 12, value: '$68,200', percent: 45, color: '#f59e0b' },
    { name: 'Quote / Proposal', count: 7, value: '$34,000', percent: 22, color: '#8b5cf6' },
    { name: 'Closing Won', count: 5, value: '$21,500', percent: 14, color: '#10b981' },
  ]);

  // Main follow-up queue
  followUps = signal<FollowUpItem[]>([
    {
      id: 'f1',
      leadName: 'Liam Vance',
      company: 'TechCorp Solutions',
      dealValue: '$18,500',
      channel: 'call',
      status: 'urgent',
      dueTime: 'Overdue (10:30 AM)',
      note: 'Confirm budget approval with Finance VP for enterprise package.',
      priority: 'Urgent',
    },
    {
      id: 'f2',
      leadName: 'Elena Rostova',
      company: 'Nordic Logistics',
      dealValue: '$24,000',
      channel: 'email',
      status: 'urgent',
      dueTime: '11:15 AM',
      note: 'Send revised quotation with tiered payment terms.',
      priority: 'Urgent',
    },
    {
      id: 'f3',
      leadName: 'Marcus Chen',
      company: 'Aura Health Inc.',
      dealValue: '$12,800',
      channel: 'whatsapp',
      status: 'pending',
      dueTime: '1:30 PM',
      note: 'Quick check-in on the software demo feedback from yesterday.',
      priority: 'High',
    },
    {
      id: 'f4',
      leadName: 'Sophia Miller',
      company: 'Apex Retail Group',
      dealValue: '$36,000',
      channel: 'meeting',
      status: 'pending',
      dueTime: '3:00 PM',
      note: 'Strategy alignment call with regional sales team.',
      priority: 'High',
    },
    {
      id: 'f5',
      leadName: 'David Kim',
      company: 'Vanguard Cyber',
      dealValue: '$9,400',
      channel: 'call',
      status: 'pending',
      dueTime: '4:45 PM',
      note: 'Second follow-up regarding integration specifications.',
      priority: 'Medium',
    },
    {
      id: 'f6',
      leadName: 'Amara Okafor',
      company: 'Prime Global Logistics',
      dealValue: '$15,200',
      channel: 'email',
      status: 'completed',
      dueTime: 'Completed 9:20 AM',
      note: 'Sent formal onboarding contract and verified signature.',
      priority: 'Medium',
    },
  ]);

  // Computed metrics
  totalCount = computed(() => this.followUps().length);
  urgentCount = computed(() => this.followUps().filter((f) => f.status === 'urgent').length);
  completedCount = computed(() => this.followUps().filter((f) => f.status === 'completed').length);
  pendingCount = computed(() => this.followUps().filter((f) => f.status !== 'completed').length);

  filteredFollowUps = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.activeFilter();

    return this.followUps().filter((item) => {
      // Search filter
      const matchesSearch =
        !query ||
        item.leadName.toLowerCase().includes(query) ||
        item.company.toLowerCase().includes(query) ||
        item.note.toLowerCase().includes(query);

      if (!matchesSearch) return false;

      // Category filter
      if (filter === 'urgent') return item.status === 'urgent';
      if (filter === 'call') return item.channel === 'call';
      if (filter === 'quotation') return item.dealValue.includes('$') && item.status !== 'completed';
      if (filter === 'completed') return item.status === 'completed';

      return true;
    });
  });

  toggleStatus(id: string): void {
    this.followUps.update((items) =>
      items.map((item) => {
        if (item.id === id) {
          const nextStatus = item.status === 'completed' ? 'pending' : 'completed';
          return {
            ...item,
            status: nextStatus,
            dueTime: nextStatus === 'completed' ? 'Completed just now' : 'Today, 5:00 PM',
          };
        }
        return item;
      })
    );
  }

  saveQuickFollowUp(): void {
    if (!this.newLeadName.trim()) return;

    const newItem: FollowUpItem = {
      id: 'f_' + Date.now(),
      leadName: this.newLeadName.trim(),
      company: this.newCompany.trim() || 'Direct Client',
      dealValue: this.newDealValue.trim() ? (this.newDealValue.startsWith('$') ? this.newDealValue : `$${this.newDealValue}`) : '$5,000',
      channel: this.newChannel,
      status: 'pending',
      dueTime: this.newDueTime || 'Today, 5:00 PM',
      note: this.newNote.trim() || 'Follow up on proposal and next steps.',
      priority: 'High',
    };

    this.followUps.update((items) => [newItem, ...items]);

    // Reset form
    this.newLeadName = '';
    this.newCompany = '';
    this.newDealValue = '';
    this.newNote = '';
    this.isQuickAddOpen.set(false);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
