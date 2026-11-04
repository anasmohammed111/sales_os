import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdmissionsService } from '../../core/services/admissions.service';
import { AssessmentEvent, AssessmentResult, AssessmentType } from '../admissions.models';
import { dayKey, errorMessage, formatDate, formatTime, relativeDay } from '../admissions.utils';

const TYPE_LABELS: Record<AssessmentType, string> = { INTERVIEW: 'Interview', EXAM: 'Entrance exam' };
const RESULT_LABELS: Record<AssessmentResult, string> = { PENDING: 'Result pending', PASSED: 'Passed', FAILED: 'Failed' };
const RESULT_TONE: Record<AssessmentResult, 'warn' | 'ok' | 'bad'> = { PENDING: 'warn', PASSED: 'ok', FAILED: 'bad' };

interface Section {
  key: string;
  label: string;
  warn: boolean;
  items: AssessmentEvent[];
}

@Component({
  selector: 'adm-assessments',
  imports: [RouterLink],
  template: `
    <div class="adm-page">
      <header class="adm-head">
        <div>
          <h1 class="adm-title">Interviews &amp; exams</h1>
          <p class="adm-sub">Scheduled interviews and entrance exams for your students. Times are shown in {{ tz() }}.</p>
        </div>
      </header>

      @if (error(); as message) {
        <div class="adm-panel adm-state"><strong>{{ message }}</strong><button type="button" class="adm-btn" (click)="load()">Try again</button></div>
      } @else if (loading()) {
        <div class="adm-skeleton" style="height: 280px"></div>
      } @else if (!sections().length) {
        <div class="adm-panel adm-state">
          <strong>Nothing scheduled</strong>
          <span>Set an interview or entrance exam date in a student's University Application stage and it will show here.</span>
        </div>
      } @else {
        @for (section of sections(); track section.key) {
          <section class="group">
            <h2 [class.is-warn]="section.warn">
              {{ section.label }} <span class="adm-num">{{ section.items.length }}</span>
            </h2>
            <div class="adm-panel list">
              @for (e of section.items; track e.applicationId + e.type) {
                <div class="row">
                  <div class="when">
                    <strong>{{ clock(e.at) }}</strong>
                    <span>{{ typeLabels[e.type] }}</span>
                  </div>

                  <div class="main">
                    <a class="name" [routerLink]="['/admissions/students', e.applicationId]">{{ e.student.name }}</a>
                    <span class="meta">
                      @if (e.student.phone) {
                        <span>{{ e.student.phone }}</span>
                      }
                      @if (e.counsellor) {
                        <span>{{ e.counsellor }}</span>
                      } @else {
                        <span class="adm-chip adm-chip--muted">No counsellor</span>
                      }
                      <span>{{ e.currentStage.name }}</span>
                    </span>
                  </div>

                  <span [class]="'adm-chip adm-chip--' + resultTone[e.result]">{{ resultLabels[e.result] }}</span>
                </div>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .group { display: grid; gap: 8px; }
    h2 { margin: 0; color: var(--adm-ink); font-size: 15px; font-weight: 800; }
    h2 span { margin-left: 6px; color: var(--adm-muted); font-weight: 700; }
    h2.is-warn { color: var(--adm-warn); }
    .list { overflow: hidden; }
    .row { display: grid; grid-template-columns: 150px 1fr auto; gap: 14px; align-items: center; padding: 12px 16px; }
    .row + .row { border-top: 1px solid #f1f5f9; }
    .when { display: grid; gap: 2px; font-size: 13px; }
    .when span { color: var(--adm-muted); font-size: 12px; }
    .main { display: grid; gap: 4px; min-width: 0; }
    .name { color: var(--adm-ink); font-weight: 700; text-decoration: none; }
    .name:hover { text-decoration: underline; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--adm-muted); font-size: 13px; }
  `,
})
export class Assessments implements OnInit {
  private readonly admissions = inject(AdmissionsService);

  readonly typeLabels = TYPE_LABELS;
  readonly resultLabels = RESULT_LABELS;
  readonly resultTone = RESULT_TONE;

  readonly tz = signal('Asia/Kolkata');
  readonly upcoming = signal<AssessmentEvent[]>([]);
  readonly awaitingResult = signal<AssessmentEvent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** "Awaiting result" first, then one section per upcoming day. */
  readonly sections = computed<Section[]>(() => {
    const tz = this.tz();
    const result: Section[] = [];

    if (this.awaitingResult().length) {
      result.push({
        key: 'awaiting',
        label: 'Awaiting result',
        warn: true,
        items: this.awaitingResult(),
      });
    }

    const byDay = new Map<string, Section>();
    for (const e of this.upcoming()) {
      const key = dayKey(e.at, tz);
      let section = byDay.get(key);
      if (!section) {
        section = { key, label: `${formatDate(e.at, tz)} · ${relativeDay(e.at, tz)}`, warn: false, items: [] };
        byDay.set(key, section);
      }
      section.items.push(e);
    }

    return [...result, ...byDay.values()];
  });

  ngOnInit(): void {
    this.load();
  }

  clock(value: string): string {
    return formatTime(value, this.tz());
  }

  load(): void {
    this.error.set(null);
    this.admissions.listAssessments().subscribe({
      next: (data) => {
        this.tz.set(data.timezone || 'Asia/Kolkata');
        this.upcoming.set(data.upcoming);
        this.awaitingResult.set(data.awaitingResult);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'Interviews and exams could not load.'));
      },
    });
  }
}
