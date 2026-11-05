import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { HomeInsights } from './home-insights';
import { AuthService } from '../../core/services/auth.service';
import { HomeSummary } from '../../core/services/home-dashboard.service';

const summary = {
  currency: 'USD',
  attention: {
    overdueFollowUps: { count: 4, oldestAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    neglectedLeads: {
      count: 2,
      idleDays: 7,
      items: [
        { id: 'l1', name: 'Hannah Lee', company: 'Globex', value: 18000, status: 'NEGOTIATION', statusLabel: 'Negotiation', assignedTo: 'Anu', lastActivityAt: '', idleDays: 12 },
      ],
    },
    unassignedLeads: 1,
  },
  quotations: {
    awaiting: { count: 3, totals: [{ currency: 'USD', amount: 36900 }] },
    expiringSoon: { count: 1, withinDays: 7, items: [{ id: 'q1', number: 'QT-001', customer: 'Initech', amount: 12500, currency: 'USD', validUntil: '', daysLeft: 2 }] },
    acceptedThisMonth: { count: 1, totals: [{ currency: 'USD', amount: 3200 }] },
  },
} as unknown as HomeSummary;

describe('HomeInsights', () => {
  let fixture: ComponentFixture<HomeInsights>;
  let http: HttpTestingController;

  const render = async (permissions: string[], data: HomeSummary = summary) => {
    TestBed.inject(AuthService).access.set({ roleId: 'r', roleKey: 'R', roleName: 'R', isOwner: false, permissions, scopes: {} });
    fixture.componentRef.setInput('summary', data);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement.textContent.replace(/\s+/g, ' ') as string;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeInsights],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HomeInsights);
    http = TestBed.inject(HttpTestingController);
  });

  // Admissions is off in these tests, so its figures are never requested
  afterEach(() => http.verify());

  it('shows what has slipped and the quotations waiting on customers', async () => {
    const text = await render(['leads.view', 'leads.assign', 'followups.view', 'quotations.view']);

    expect(text).toContain('Overdue follow-ups');
    expect(text).toContain('3 days late');
    expect(text).toContain('Hannah Lee');
    expect(text).toContain('idle 12 days');
    expect(text).toContain('Unassigned leads');
    expect(text).toContain('$36,900');
    expect(text).toContain('Expires in 2 days');
    expect(text).toContain('Accepted this month: 1');
    expect(text).not.toContain('Admissions');
  });

  it('hides what the person may not see or act on', async () => {
    const text = await render(['leads.view', 'followups.view'], { ...summary, quotations: null });

    expect(text).toContain('Neglected leads');
    expect(text).not.toContain('Unassigned leads');
    expect(text).not.toContain('Quotations');
  });

  it('the overdue row asks the dashboard to filter its queue', async () => {
    let asked = false;
    fixture.componentInstance.showOverdue.subscribe(() => (asked = true));
    await render(['followups.view']);

    const row = [...fixture.nativeElement.querySelectorAll('.row')].find((r: HTMLElement) => r.textContent!.includes('Overdue'));
    (row as HTMLButtonElement).click();

    expect(asked).toBe(true);
  });
});
