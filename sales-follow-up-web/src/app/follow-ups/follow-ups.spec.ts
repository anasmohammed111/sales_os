import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FollowUps } from './follow-ups';

describe('FollowUps', () => {
  let component: FollowUps;
  let fixture: ComponentFixture<FollowUps>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FollowUps],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(FollowUps);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should invalidate scheduleForm when required fields are empty', () => {
    component.scheduleForm.reset({
      leadId: '',
      type: 'CALL',
      scheduledDate: '',
      scheduledTime: '',
    });
    expect(component.scheduleForm.valid).toBe(false);
    expect(component.scheduleForm.get('leadId')?.valid).toBe(false);
    expect(component.scheduleForm.get('scheduledDate')?.valid).toBe(false);
  });

  it('should validate scheduleForm when required fields are populated', () => {
    component.scheduleForm.patchValue({
      leadId: 'lead-123',
      type: 'CALL',
      scheduledDate: '2026-11-02',
      scheduledTime: '10:00',
    });
    expect(component.scheduleForm.get('leadId')?.valid).toBe(true);
    expect(component.scheduleForm.get('scheduledDate')?.valid).toBe(true);
  });
});

