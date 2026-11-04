import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { ApplicationDetail, Currency, Fee, FeeCategory, MoneyRow, Transaction } from '../admissions.models';
import {
  CURRENCIES,
  errorMessage,
  FEE_CATEGORY_LABELS,
  FEE_STATUS_LABELS,
  FEE_STATUS_TONE,
  formatDate,
  fromLocalInput,
  money,
  toDateInput,
} from '../admissions.utils';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

@Component({
  selector: 'adm-profile-payments',
  imports: [FormsModule, CanDirective],
  templateUrl: './profile-payments.html',
  styleUrl: './profile-payments.scss',
})
export class ProfilePayments {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  /** Payment changes alter the profile summary; the parent reloads it. */
  readonly updated = output<void>();

  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);

  readonly fees = signal<Fee[]>([]);
  readonly summary = signal<MoneyRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly addingFee = signal(false);
  feeCategory: FeeCategory = 'AGENCY_FEE';
  feeLabel = '';
  feeAmount = '';
  feeCurrency: Currency = 'INR';
  feeDue = '';

  readonly payingFee = signal<Fee | null>(null);
  payAmount = '';
  payDate = toDateInput(new Date());
  payReference = '';
  payMethod = '';
  payReceipt: File | null = null;

  readonly voiding = signal<{ fee: Fee; tx: Transaction } | null>(null);
  voidReason = '';

  readonly categories = Object.entries(FEE_CATEGORY_LABELS) as [FeeCategory, string][];
  readonly currencies = CURRENCIES;
  readonly categoryLabels = FEE_CATEGORY_LABELS;
  readonly statusLabels = FEE_STATUS_LABELS;
  readonly statusTone = FEE_STATUS_TONE;
  readonly money = money;
  readonly formatDate = formatDate;

  constructor() {
    effect(() => {
      this.application().id;
      this.load();
    });
  }

  load(): void {
    this.admissions.listFees(this.application().id).subscribe({
      next: ({ fees, summary }) => {
        this.fees.set(fees);
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'Payments could not load.'));
      },
    });
  }

  paidPercent(fee: Fee): number {
    return Math.min(100, Math.round((fee.paidMinor / fee.amountDueMinor) * 100));
  }

  private done(message: string): void {
    this.saving.set(false);
    toast.success(message);
    this.load();
    this.updated.emit();
  }

  private failed(err: unknown, fallback: string): void {
    this.saving.set(false);
    toast.error(errorMessage(err, fallback));
  }

  addFee(): void {
    this.saving.set(true);
    this.admissions
      .createFee(this.application().id, {
        category: this.feeCategory,
        label: this.feeLabel,
        amountDue: this.feeAmount.trim(),
        currency: this.feeCurrency,
        dueDate: fromLocalInput(this.feeDue),
      })
      .subscribe({
        next: () => {
          this.addingFee.set(false);
          this.feeLabel = '';
          this.feeAmount = '';
          this.feeDue = '';
          this.done('Fee added');
        },
        error: (err) => this.failed(err, 'The fee could not be added.'),
      });
  }

  startPayment(fee: Fee): void {
    this.payingFee.set(fee);
    this.payAmount = fee.outstanding;
    this.payDate = toDateInput(new Date());
    this.payReference = '';
    this.payMethod = '';
    this.payReceipt = null;
  }

  onReceipt(event: Event): void {
    this.payReceipt = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  recordPayment(): void {
    const fee = this.payingFee();
    if (!fee) return;
    this.saving.set(true);
    this.admissions
      .recordPayment(
        fee.id,
        {
          amount: this.payAmount.trim(),
          paidAt: fromLocalInput(this.payDate) ?? '',
          reference: this.payReference,
          method: this.payMethod,
        },
        this.payReceipt
      )
      .subscribe({
        next: () => {
          this.payingFee.set(null);
          this.done('Payment recorded');
        },
        error: (err) => this.failed(err, 'The payment could not be recorded.'),
      });
  }

  confirmVoid(): void {
    const target = this.voiding();
    if (!target) return;
    this.saving.set(true);
    this.admissions.voidPayment(target.fee.id, target.tx.id, this.voidReason).subscribe({
      next: () => {
        this.voiding.set(null);
        this.voidReason = '';
        this.done('Payment voided');
      },
      error: (err) => this.failed(err, 'The payment could not be voided.'),
    });
  }

  openReceipt(fee: Fee, tx: Transaction): void {
    this.admissions.openFile(this.admissions.receiptLink(fee.id, tx.id)).subscribe({
      error: (err) => toast.error(errorMessage(err, 'The receipt could not be opened.')),
    });
  }
}
