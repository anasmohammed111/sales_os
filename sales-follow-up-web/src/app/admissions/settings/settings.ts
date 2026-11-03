import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { AdmissionsConfig, ConfigItem, ConfigStage, Course, University } from '../admissions.models';
import { errorMessage } from '../admissions.utils';

type Section = 'stages' | 'lists' | 'universities' | 'reminders';

const RULE_NOTES: Record<string, string> = {
  FINAL_CHOICE_SET: 'Needs the final university recorded',
  ASSESSMENT_REQUIREMENTS_SET: 'Needs interview and exam requirements recorded',
  INTERVIEW_DATE_SET: 'Needs the interview date',
  INTERVIEW_RESULT_SET: 'Needs the interview result',
  EXAM_DATE_SET: 'Needs the exam date',
  EXAM_RESULT_SET: 'Needs the exam result',
  VISA_APPOINTMENT_SET: 'Needs the visa appointment date',
  VISA_OUTCOME_SET: 'Completed by recording the visa result',
};

@Component({
  selector: 'adm-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly admissions = inject(AdmissionsService);

  readonly section = signal<Section>('stages');
  readonly config = signal<AdmissionsConfig | null>(null);
  readonly universities = signal<University[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly dirty = signal(false);

  readonly ruleNotes = RULE_NOTES;
  readonly timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Kolkata', 'Europe/Prague', 'UTC'];

  newUniversity: Partial<University> = { name: '', city: '', website: '', courses: [] };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.admissions.getSettings().subscribe({
      next: (config) => {
        this.config.set(structuredClone(config));
        this.dirty.set(false);
      },
      error: (err) => this.error.set(errorMessage(err, 'Settings could not load.')),
    });
    this.admissions.loadContext(true).subscribe((ctx) => this.universities.set(structuredClone(ctx?.universities ?? [])));
  }

  touch(): void {
    this.dirty.set(true);
  }

  isSaved(entry: { key?: string }): boolean {
    return !!entry.key;
  }

  // Stages
  moveStage(index: number, delta: number): void {
    const stages = this.config()!.stages;
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    [stages[index], stages[target]] = [stages[target], stages[index]];
    this.touch();
  }

  addStage(): void {
    this.config()!.stages.push({ key: '', name: 'New stage', order: 0, stuckThresholdDays: 7, gate: null, isArchived: false, items: [] });
    this.touch();
  }

  addItem(stage: ConfigStage): void {
    stage.items.push({ key: '', label: '', required: true, condition: null, rule: null, paymentCategory: null, isArchived: false });
    this.touch();
  }

  removeUnsaved<T extends { key?: string }>(list: T[], index: number): void {
    if (!list[index].key) {
      list.splice(index, 1);
      this.touch();
    }
  }

  setCondition(item: ConfigItem, value: string): void {
    item.condition = (value || null) as ConfigItem['condition'];
    this.touch();
  }

  // Document types and lead sources
  addDocumentType(): void {
    this.config()!.documentTypes.push({ key: '', name: '', hasExpiry: false, isArchived: false });
    this.touch();
  }

  addLeadSource(): void {
    this.config()!.leadSources.push({ key: '', name: '', isArchived: false });
    this.touch();
  }

  save(): void {
    const config = this.config();
    if (!config) return;
    this.saving.set(true);
    this.admissions.saveSettings(config).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.config.set(structuredClone(saved));
        this.dirty.set(false);
        this.admissions.loadContext(true).subscribe();
        toast.success('Settings saved');
      },
      error: (err) => {
        this.saving.set(false);
        toast.error(errorMessage(err, 'Settings could not be saved.'));
      },
    });
  }

  // Universities (saved one at a time)
  addCourse(university: Partial<University>): void {
    (university.courses ||= []).push({ name: '', level: 'MASTER', language: 'English', isArchived: false } as Course);
  }

  removeUnsavedCourse(university: Partial<University>, index: number): void {
    if (!university.courses?.[index]._id) university.courses?.splice(index, 1);
  }

  saveUniversity(university: University): void {
    this.admissions.updateUniversity(university._id, university).subscribe({
      next: (saved) => {
        this.universities.set(this.universities().map((u) => (u._id === saved._id ? structuredClone(saved) : u)));
        this.admissions.loadContext(true).subscribe();
        toast.success(`${saved.name} saved`);
      },
      error: (err) => toast.error(errorMessage(err, 'The university could not be saved.')),
    });
  }

  createUniversity(): void {
    this.admissions.createUniversity(this.newUniversity).subscribe({
      next: (saved) => {
        this.universities.set([...this.universities(), structuredClone(saved)].sort((a, b) => a.name.localeCompare(b.name)));
        this.newUniversity = { name: '', city: '', website: '', courses: [] };
        this.admissions.loadContext(true).subscribe();
        toast.success(`${saved.name} added`);
      },
      error: (err) => toast.error(errorMessage(err, 'The university could not be added.')),
    });
  }
}
