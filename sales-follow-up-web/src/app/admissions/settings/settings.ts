import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import {
  AdmissionsConfig,
  ConfigItem,
  ConfigStage,
  Course,
  Currency,
  FeeCategory,
  FeeCondition,
  FeeHold,
  FeeScheduleEntry,
  FeeTrigger,
  University,
} from '../admissions.models';
import {
  CURRENCIES,
  errorMessage,
  FEE_CATEGORY_HINTS,
  FEE_CATEGORY_LABELS,
  FEE_CONDITION_LABELS,
  feeHoldText,
  feeTriggerText,
  money,
} from '../admissions.utils';

type Section = 'stages' | 'fees' | 'lists' | 'universities' | 'reminders';

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

  // Fee list
  readonly editingFee = signal<FeeScheduleEntry | null>(null);
  readonly categories = Object.entries(FEE_CATEGORY_LABELS) as [FeeCategory, string][];
  readonly categoryLabels = FEE_CATEGORY_LABELS;
  readonly categoryHints = FEE_CATEGORY_HINTS;
  readonly conditions = Object.entries(FEE_CONDITION_LABELS) as [FeeCondition, string][];
  readonly conditionLabels = FEE_CONDITION_LABELS;
  readonly currencies = CURRENCIES;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.admissions.getSettings().subscribe({
      next: (config) => {
        this.editingFee.set(null);
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

  // Fee list: each fee belongs to a stage and is added at a moment of that stage
  /** Saved stages that can hold fees: active ones, plus archived ones that still have fees */
  feeStages(c: AdmissionsConfig): ConfigStage[] {
    return c.stages.filter((s) => s.key && (!s.isArchived || c.fees.some((f) => f.stageKey === s.key)));
  }

  feesFor(c: AdmissionsConfig, stageKey: string): FeeScheduleEntry[] {
    return c.fees.filter((f) => f.stageKey === stageKey);
  }

  stageOf(c: AdmissionsConfig, key: string): ConfigStage | undefined {
    return c.stages.find((s) => s.key === key);
  }

  /** Saved, active checklist items a fee can point at (plus the one it points at now) */
  itemsFor(c: AdmissionsConfig, stageKey: string, current: string | null = null): ConfigItem[] {
    return (this.stageOf(c, stageKey)?.items ?? []).filter((i) => i.key && (!i.isArchived || i.key === current));
  }

  itemLabel(c: AdmissionsConfig, stageKey: string, itemKey: string | null): string | null {
    return this.stageOf(c, stageKey)?.items.find((i) => i.key === itemKey)?.label ?? null;
  }

  whenText(c: AdmissionsConfig, fee: FeeScheduleEntry): string {
    return feeTriggerText(
      { trigger: fee.trigger, stageName: this.stageOf(c, fee.stageKey)?.name },
      this.itemLabel(c, fee.stageKey, fee.triggerItemKey)
    );
  }

  holdText(c: AdmissionsConfig, fee: FeeScheduleEntry): string | null {
    return feeHoldText(
      { hold: fee.hold, stageName: this.stageOf(c, fee.stageKey)?.name },
      this.itemLabel(c, fee.stageKey, fee.holdItemKey)
    );
  }

  private minorOf(fee: FeeScheduleEntry): number | null {
    const value = Number(String(fee.amount ?? '').trim());
    return fee.amount && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }

  amountText(fee: FeeScheduleEntry): string {
    const minor = this.minorOf(fee);
    return minor === null ? 'Varies per student' : money(minor, fee.currency);
  }

  /** Fixed amounts per currency for the given fees (manual and archived ones left out) */
  totals(fees: FeeScheduleEntry[]): { currency: Currency; text: string }[] {
    const sums = new Map<Currency, number>();
    for (const fee of fees) {
      const minor = this.minorOf(fee);
      if (fee.isArchived || fee.trigger === 'MANUAL' || minor === null) continue;
      sums.set(fee.currency, (sums.get(fee.currency) ?? 0) + minor);
    }
    return [...sums].map(([currency, minor]) => ({ currency, text: money(minor, currency) }));
  }

  hasVarying(fees: FeeScheduleEntry[]): boolean {
    return fees.some((f) => !f.isArchived && f.trigger !== 'MANUAL' && this.minorOf(f) === null);
  }

  addFee(stage: ConfigStage): void {
    const fee: FeeScheduleEntry = {
      key: '',
      name: '',
      category: 'SERVICE_FEE',
      amountMinor: null,
      amount: '',
      currency: 'INR',
      stageKey: stage.key,
      trigger: 'STAGE_ENTERED',
      triggerItemKey: null,
      condition: null,
      dueInDays: 7,
      hold: 'NONE',
      holdItemKey: null,
      autoCompleteItem: false,
      refundable: true,
      isArchived: false,
    };
    this.config()!.fees.push(fee);
    this.editingFee.set(fee);
    this.touch();
  }

  toggleFee(fee: FeeScheduleEntry): void {
    this.editingFee.set(this.editingFee() === fee ? null : fee);
  }

  removeUnsavedFee(fee: FeeScheduleEntry): void {
    const fees = this.config()!.fees;
    const index = fees.indexOf(fee);
    if (index >= 0 && !fee.key) {
      fees.splice(index, 1);
      this.editingFee.set(null);
      this.touch();
    }
  }

  setFeeCategory(fee: FeeScheduleEntry, category: FeeCategory): void {
    // New fees follow the type: service fees count towards refunds by default
    if (!fee.key) fee.refundable = category === 'SERVICE_FEE';
    fee.category = category;
    this.touch();
  }

  /** Moving a fee to another stage keeps item links only if that stage has them */
  setFeeStage(fee: FeeScheduleEntry, stageKey: string): void {
    const items = this.itemsFor(this.config()!, stageKey);
    const has = (key: string | null) => items.some((i) => i.key === key);
    fee.stageKey = stageKey;
    if (fee.trigger === 'ITEM_COMPLETED' && !has(fee.triggerItemKey)) fee.triggerItemKey = items[0]?.key ?? null;
    if (fee.hold === 'ITEM' && !has(fee.holdItemKey)) fee.holdItemKey = items[0]?.key ?? null;
    this.editingFee.set(fee);
    this.touch();
  }

  setFeeTrigger(fee: FeeScheduleEntry, trigger: FeeTrigger): void {
    fee.trigger = trigger;
    if (trigger === 'ITEM_COMPLETED' && !fee.triggerItemKey) {
      fee.triggerItemKey = this.itemsFor(this.config()!, fee.stageKey)[0]?.key ?? null;
    }
    this.touch();
  }

  setFeeHold(fee: FeeScheduleEntry, hold: FeeHold): void {
    fee.hold = hold;
    if (hold === 'ITEM' && !fee.holdItemKey) fee.holdItemKey = this.itemsFor(this.config()!, fee.stageKey)[0]?.key ?? null;
    if (hold !== 'ITEM') fee.autoCompleteItem = false;
    this.touch();
  }

  setFeeCondition(fee: FeeScheduleEntry, value: string): void {
    fee.condition = (value || null) as FeeCondition | null;
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
        this.editingFee.set(null);
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
