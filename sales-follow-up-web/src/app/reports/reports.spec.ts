import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { FollowUp, FollowUpService } from '../core/services/follow-up.service';
import { Lead, LeadService } from '../core/services/lead.service';
import { SettingsService } from '../core/services/settings.service';
import { Reports } from './reports';

describe('Reports', () => {
  let component: Reports;
  let fixture: ComponentFixture<Reports>;

  const now = new Date().toISOString();
  const leads: Lead[] = [
    {
      _id: 'lead-won',
      businessId: 'business',
      customerName: 'Won lead',
      companyName: '',
      email: '',
      phone: '',
      source: 'WEBSITE',
      interestedIn: '',
      estimatedValue: 1200,
      status: 'WON',
      priority: 'HIGH',
      assignedTo: null,
      createdBy: 'user',
      nextFollowUpAt: null,
      notes: '',
      lostReason: '',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 'lead-open',
      businessId: 'business',
      customerName: 'Open lead',
      companyName: '',
      email: '',
      phone: '',
      source: 'REFERRAL',
      interestedIn: '',
      estimatedValue: 800,
      status: 'QUALIFIED',
      priority: 'MEDIUM',
      assignedTo: null,
      createdBy: 'user',
      nextFollowUpAt: null,
      notes: '',
      lostReason: '',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const followUps: FollowUp[] = [
    {
      _id: 'follow-up',
      businessId: 'business',
      leadId: { _id: 'lead-won', customerName: 'Won lead' },
      assignedTo: null,
      createdBy: 'user',
      type: 'CALL',
      scheduledAt: now,
      status: 'COMPLETED',
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [
        {
          provide: LeadService,
          useValue: {
            getLeads: () => of({ leads, pagination: { total: leads.length, page: 1, limit: 100, totalPages: 1 } }),
          },
        },
        {
          provide: FollowUpService,
          useValue: {
            getFollowUps: () =>
              of({
                data: followUps,
                pagination: { total: followUps.length, page: 1, limit: 100, totalPages: 1 },
              }),
          },
        },
        { provide: SettingsService, useValue: { currency: signal('USD') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Reports);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('summarizes leads, pipeline, and follow-up activity', () => {
    const report = component.summary();

    expect(report.newLeads.length).toBe(2);
    expect(report.openLeads.length).toBe(1);
    expect(report.pipelineValue).toBe(800);
    expect(report.winRate).toBe(100);
    expect(report.completedFollowUps).toBe(1);
    expect(report.sources.map((source) => source.label)).toEqual(['Website', 'Referral']);
  });
});
