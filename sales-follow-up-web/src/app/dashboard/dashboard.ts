import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService, AuthUser } from '../core/services/auth.service';
import { AdmissionsService } from '../core/services/admissions.service';
import { NotificationBell } from '../shared/notification-bell/notification-bell';
import { toast } from 'ngx-sonner';
import { HomeDashboardService, HomeSummary, QueueItem } from '../core/services/home-dashboard.service';
import { FollowUpService, FollowUpType } from '../core/services/follow-up.service';
import { Lead, LeadService } from '../core/services/lead.service';
import { formatMoney, SettingsService } from '../core/services/settings.service';
import { Settings } from '../settings/settings';
import { Leads } from '../leads/leads';
import { FollowUps } from '../follow-ups/follow-ups';
import { Team } from '../team/team';
import { Pipeline } from '../pipeline/pipeline';
import { Quotations } from '../quotations/quotations';
import { Reports } from '../reports/reports';
import { RolesSettings } from '../settings/roles/roles-settings';
import { PermissionService } from '../core/services/permission.service';
import { CanDirective } from '../shared/can/can.directive';

type DashboardTab =
  | 'dashboard'
  | 'leads'
  | 'follow-ups'
  | 'reports'
  | 'team'
  | 'pipeline'
  | 'quotations'
  | 'admissions'
  | 'settings'
  | 'roles';

/** The permission each page needs; Settings (your profile) is always open */
const TAB_PERMISSION: Partial<Record<DashboardTab, string>> = {
  dashboard: 'dashboard.view',
  leads: 'leads.view',
  'follow-ups': 'followups.view',
  reports: 'reports.view',
  team: 'team.view',
  pipeline: 'pipeline.view',
  quotations: 'quotations.view',
  admissions: 'admissions.view',
  roles: 'settings.roles',
};

/** Which page a URL shows. '/admissions/pipeline' contains 'pipeline', so order matters. */
const tabForUrl = (url: string): DashboardTab =>
  url.startsWith('/admissions')
    ? 'admissions'
    : url.startsWith('/settings/roles')
    ? 'roles'
    : url.startsWith('/settings')
    ? 'settings'
    : url.includes('follow-ups')
    ? 'follow-ups'
    : url.includes('leads')
    ? 'leads'
    : url.includes('reports')
    ? 'reports'
    : url.includes('team')
    ? 'team'
    : url.includes('pipeline')
    ? 'pipeline'
    : url.includes('quotations')
    ? 'quotations'
    : 'dashboard';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, Leads, FollowUps, Team, Pipeline, Quotations, Reports, Settings, RolesSettings, NotificationBell, CanDirective],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  router = inject(Router);
  private authService = inject(AuthService);

  private admissions = inject(AdmissionsService);
  private settingsService = inject(SettingsService);
  /** What the signed-in person may do; the sidebar and pages follow it */
  readonly permissions = inject(PermissionService);
  // Admissions entries only show for businesses with the module switched on
  admissionsEnabled = computed(() => !!this.admissions.context());
  readonly admissionsLinks = [
    { path: 'overview', label: 'Overview' },
    { path: 'pipeline', label: 'Admissions pipeline' },
    { path: 'students', label: 'Students' },
    { path: 'tasks', label: 'My tasks' },
    { path: 'payments', label: 'Payments' },
  ];

  currentTab = signal<DashboardTab>(tabForUrl(this.router.url));
  user = this.authService.currentUser;
  currentPageLabel = computed(() => {
    if (this.currentTab() === 'admissions') {
      const section = this.admissionsLinks.find((link) => this.router.url.startsWith(`/admissions/${link.path}`));
      return section?.label ?? 'Admissions';
    }

    const labels: Record<DashboardTab, string> = {
      dashboard: 'Dashboard',
      leads: 'Leads',
      'follow-ups': 'Follow-ups',
      reports: 'Reports',
      team: 'Team',
      pipeline: 'Sales pipeline',
      quotations: 'Quotations',
      admissions: 'Admissions',
      settings: 'Settings',
      roles: 'Roles & permissions',
    };
    return labels[this.currentTab()];
  });

  constructor() {
    // Permissions may have changed since this person signed in
    this.permissions.refresh(true);
    this.settingsService.loadCurrency();
    this.router.events.subscribe(() => this.currentTab.set(tabForUrl(this.router.url)));
  }

  /** Admissions loads only for people who may see it */
  private readonly loadAdmissions = effect(() => {
    if (this.permissions.can('admissions.view')) untracked(() => this.admissions.loadContext().subscribe());
  });

  /** If a role change removes access to the page that is open, go somewhere allowed */
  private readonly leaveForbiddenPage = effect(() => {
    if (!this.permissions.loaded()) return;
    const needed = TAB_PERMISSION[this.currentTab()];
    if (needed && !this.permissions.can(needed)) {
      untracked(() => this.router.navigateByUrl(this.permissions.homePath()));
    }
  });

  /** Coming back to the tab picks up role changes made meanwhile */
  @HostListener('window:focus')
  onWindowFocus(): void {
    this.permissions.refresh();
  }

  isMobileMoreOpen = signal(false);
  isSidebarCollapsed = signal(this.getInitialSidebarState());
  private mobileMenuTrigger: HTMLElement | null = null;

  /** The signed-in person's role, e.g. "Owner" or a custom role name */
  userRoleLabel(): string {
    return this.permissions.roleName() || 'Team member';
  }

  navigateTo(tab: DashboardTab): void {
    const needed = TAB_PERMISSION[tab];
    if (needed && !this.permissions.can(needed)) return;
    this.currentTab.set(tab);
    this.isMobileMoreOpen.set(false);
    this.router.navigate([tab === 'dashboard' ? '/dashboard' : tab === 'roles' ? '/settings/roles' : `/${tab}`]);
  }

  goAdmissions(path: string): void {
    this.isMobileMoreOpen.set(false);
    this.router.navigate(['/admissions', path]);
  }

  isAdmissionsPath(path: string): boolean {
    return this.currentTab() === 'admissions' && this.router.url.startsWith(`/admissions/${path}`);
  }

  toggleMobileMore(event?: Event): void {
    const willOpen = !this.isMobileMoreOpen();
    if (willOpen && event?.currentTarget instanceof HTMLElement) {
      this.mobileMenuTrigger = event.currentTarget;
    }
    this.isMobileMoreOpen.set(willOpen);
  }

  closeMobileMore(): void {
    if (!this.isMobileMoreOpen()) return;
    this.isMobileMoreOpen.set(false);
    queueMicrotask(() => this.mobileMenuTrigger?.focus());
  }

  trapMobileMenuFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;

    const menu = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      menu.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed.update((collapsed) => {
      const nextState = !collapsed;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('salesos_sidebar_collapsed', String(nextState));
      }
      return nextState;
    });
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.closeMobileMore();
    this.isQuickAddOpen.set(false);
  }

  private getInitialSidebarState(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('salesos_sidebar_collapsed') === 'true';
  }

  searchQuery = signal('');
  activeFilter = signal<'all' | 'urgent' | 'call' | 'overdue' | 'completed'>('all');
  isQuickAddOpen = signal(false);

  // Home dashboard: everything below comes from GET /api/dashboard/summary
  private homeDashboard = inject(HomeDashboardService);
  private followUpService = inject(FollowUpService);
  private leadService = inject(LeadService);

  summary = signal<HomeSummary | null>(null);
  summaryLoading = signal(false);
  summaryError = signal<string | null>(null);
  busyFollowUpId = signal<string | null>(null);
  currency = this.settingsService.currency;
  businessName = this.settingsService.businessName;
  businessLogoUrl = this.settingsService.businessLogoUrl;

  private readonly stageColors: Record<string, string> = {
    NEW: 'var(--kelto-stage-new-lead)',
    CONTACTED: 'var(--kelto-stage-contacted)',
    QUALIFIED: 'var(--kelto-stage-qualified)',
    QUOTATION_SENT: 'var(--kelto-stage-proposal)',
    NEGOTIATION: 'var(--kelto-stage-negotiation)',
  };

  // Quick log: a real follow-up for an existing lead
  leadSearch = '';
  leadOptions = signal<Lead[]>([]);
  selectedLead = signal<Lead | null>(null);
  newType: FollowUpType = 'CALL';
  newWhen = '';
  newNote = '';
  savingQuickLog = signal(false);
  private leadSearchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly loadHomeWhenShown = effect(() => {
    if (this.currentTab() === 'dashboard' && this.permissions.can('dashboard.view')) untracked(() => this.loadSummary());
  });

  totalCount = computed(() => this.summary()?.followUpsToday.total ?? 0);
  urgentCount = computed(() => this.summary()?.followUpsToday.urgent ?? 0);
  completedCount = computed(() => this.summary()?.followUpsToday.completed ?? 0);
  pendingCount = computed(() => this.summary()?.followUpsToday.pending ?? 0);
  overdueCount = computed(() => this.summary()?.followUpsToday.overdue ?? 0);

  pipelineStages = computed(() => {
    const pipeline = this.summary()?.pipeline;
    if (!pipeline) return [];
    return pipeline.byStatus.map((s) => ({
      ...s,
      percent: pipeline.openValue ? Math.round((s.value / pipeline.openValue) * 100) : 0,
      color: this.stageColors[s.status] || 'var(--kelto-chart-8)',
    }));
  });

  conversionPercent = computed(() => {
    const rate = this.summary()?.conversion.rate;
    return rate === null || rate === undefined ? null : Math.round(rate * 1000) / 10;
  });

  filteredFollowUps = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.activeFilter();

    return (this.summary()?.queue ?? []).filter((item) => {
      const matchesSearch =
        !query ||
        item.leadName.toLowerCase().includes(query) ||
        item.company.toLowerCase().includes(query) ||
        (item.notes || '').toLowerCase().includes(query) ||
        (item.title || '').toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (filter === 'urgent') return item.status === 'PENDING' && (item.isOverdue || item.priority === 'HIGH');
      if (filter === 'call') return item.type === 'CALL';
      if (filter === 'overdue') return item.isOverdue;
      if (filter === 'completed') return item.status === 'COMPLETED';
      return true;
    });
  });

  loadSummary(): void {
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    this.homeDashboard.getSummary().subscribe({
      next: (data) => {
        this.summary.set(data);
        this.currency.set(data.currency);
        this.summaryLoading.set(false);
      },
      error: (err) => {
        this.summaryLoading.set(false);
        this.summaryError.set(err?.error?.message || 'The dashboard could not load. Check your connection and try again.');
      },
    });
  }

  money(value: number | null | undefined): string {
    return formatMoney(value, this.currency());
  }

  channelOf(type: string): 'call' | 'email' | 'whatsapp' | 'meeting' | 'other' {
    const channels: Record<string, 'call' | 'email' | 'whatsapp' | 'meeting'> = {
      CALL: 'call',
      EMAIL: 'email',
      WHATSAPP: 'whatsapp',
      MEETING: 'meeting',
    };
    return channels[type] || 'other';
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      CALL: 'Phone call',
      EMAIL: 'Email',
      WHATSAPP: 'WhatsApp',
      MEETING: 'Meeting',
      TASK: 'To-do',
      DOCUMENT: 'Documents',
      PAYMENT: 'Payment',
      EXAM: 'Entrance exam',
      INTERVIEW: 'Interview',
      VISA: 'Visa',
    };
    return labels[type] || 'Other';
  }

  dueText(item: QueueItem): string {
    const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (item.status === 'COMPLETED' && item.completedAt) return `Completed ${time(item.completedAt)}`;
    if (item.isOverdue) {
      const due = new Date(item.scheduledAt);
      const day = due.toDateString() === new Date().toDateString() ? '' : `${due.toLocaleDateString([], { day: 'numeric', month: 'short' })}, `;
      return `Overdue (${day}${time(item.scheduledAt)})`;
    }
    return `Today, ${time(item.scheduledAt)}`;
  }

  timeAgo(value: string | null): string {
    if (!value) return '';
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  /** Marks a follow-up done, or back to pending, in the database. */
  toggleStatus(item: QueueItem): void {
    this.busyFollowUpId.set(item.id);
    const status = item.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    this.followUpService.updateFollowUp(item.id, { status }).subscribe({
      next: () => {
        this.busyFollowUpId.set(null);
        toast.success(status === 'COMPLETED' ? `Follow-up with ${item.leadName} done` : 'Marked as pending again');
        this.loadSummary();
      },
      error: (err) => {
        this.busyFollowUpId.set(null);
        toast.error(err?.error?.message || 'The follow-up could not be updated.');
      },
    });
  }

  openQuickLog(): void {
    const open = !this.isQuickAddOpen();
    this.isQuickAddOpen.set(open);
    if (!open) return;
    const later = new Date(Date.now() + 60 * 60 * 1000);
    later.setMinutes(0, 0, 0);
    this.newWhen = new Date(later.getTime() - later.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    this.selectedLead.set(null);
    this.leadSearch = '';
    this.leadOptions.set([]);
    this.newNote = '';
  }

  onLeadSearch(value: string): void {
    this.leadSearch = value;
    this.selectedLead.set(null);
    if (this.leadSearchTimer) clearTimeout(this.leadSearchTimer);
    if (value.trim().length < 2) {
      this.leadOptions.set([]);
      return;
    }
    this.leadSearchTimer = setTimeout(() => {
      this.leadService.getLeads({ search: value.trim(), limit: 8 }).subscribe({
        next: (result) => this.leadOptions.set(result.leads ?? []),
        error: () => this.leadOptions.set([]),
      });
    }, 250);
  }

  pickLead(lead: Lead): void {
    this.selectedLead.set(lead);
    this.leadSearch = lead.customerName + (lead.companyName ? ` (${lead.companyName})` : '');
    this.leadOptions.set([]);
  }

  saveQuickFollowUp(): void {
    const lead = this.selectedLead();
    if (!lead || !this.newWhen) return;
    this.savingQuickLog.set(true);
    this.followUpService
      .createFollowUp({
        leadId: lead._id,
        type: this.newType,
        scheduledAt: new Date(this.newWhen).toISOString(),
        notes: this.newNote.trim(),
      })
      .subscribe({
        next: () => {
          this.savingQuickLog.set(false);
          this.isQuickAddOpen.set(false);
          toast.success(`Follow-up with ${lead.customerName} added`);
          this.loadSummary();
        },
        error: (err) => {
          this.savingQuickLog.set(false);
          toast.error(err?.error?.message || 'The follow-up could not be added.');
        },
      });
  }

  logout(): void {
    this.admissions.resetContext();
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
