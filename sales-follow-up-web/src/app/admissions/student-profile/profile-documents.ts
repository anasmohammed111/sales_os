import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { AdmissionDocument, ApplicationDetail, DocumentType } from '../admissions.models';
import {
  DOC_STATUS_LABELS,
  DOC_STATUS_TONE,
  errorMessage,
  formatDate,
  formatDateTime,
  fromLocalInput,
  relativeDay,
  toDateInput,
} from '../admissions.utils';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

@Component({
  selector: 'adm-profile-documents',
  imports: [FormsModule, CanDirective],
  templateUrl: './profile-documents.html',
  styleUrl: './profile-documents.scss',
})
export class ProfileDocuments {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  readonly ctx = this.admissions.context;
  readonly tz = computed(() => this.ctx()?.config.timezone);

  readonly types = signal<DocumentType[]>([]);
  readonly documents = signal<AdmissionDocument[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly rejecting = signal<AdmissionDocument | null>(null);
  rejectReason = '';

  readonly groups = computed(() =>
    this.types().map((type) => ({ type, docs: this.documents().filter((d) => d.documentTypeKey === type.key) }))
  );

  readonly statusLabels = DOC_STATUS_LABELS;
  readonly statusTone = DOC_STATUS_TONE;
  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly toDateInput = toDateInput;

  constructor() {
    effect(() => {
      this.application().id;
      this.load();
    });
  }

  load(): void {
    this.admissions.listDocuments(this.application().id).subscribe({
      next: ({ types, documents }) => {
        this.types.set(types);
        this.documents.set(documents);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorMessage(err, 'Documents could not load.'));
      },
    });
  }

  private replace(doc: AdmissionDocument): void {
    const exists = this.documents().some((d) => d.id === doc.id);
    this.documents.set(exists ? this.documents().map((d) => (d.id === doc.id ? doc : d)) : [...this.documents(), doc]);
  }

  expiryNote(doc: AdmissionDocument): string {
    if (!doc.expiresAt) return '';
    const soon = new Date(doc.expiresAt).getTime() - Date.now() < 60 * 24 * 60 * 60 * 1000;
    return `${soon ? 'Expires' : 'Valid until'} ${formatDate(doc.expiresAt, this.tz())} (${relativeDay(doc.expiresAt, this.tz())})`;
  }

  isExpiringSoon(doc: AdmissionDocument): boolean {
    return !!doc.expiresAt && new Date(doc.expiresAt).getTime() - Date.now() < 60 * 24 * 60 * 60 * 1000;
  }

  addRecord(type: DocumentType): void {
    this.admissions.createDocument(this.application().id, { documentTypeKey: type.key }).subscribe({
      next: (doc) => this.replace(doc),
      error: (err) => toast.error(errorMessage(err, 'The document could not be added.')),
    });
  }

  /** Upload into an existing record, or create the record first for a missing type. */
  upload(event: Event, type: DocumentType, doc?: AdmissionDocument): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;

    const record$ = doc
      ? this.admissions.uploadDocumentFile(doc.id, file)
      : this.admissions
          .createDocument(this.application().id, { documentTypeKey: type.key })
          .pipe(switchMap((created) => this.admissions.uploadDocumentFile(created.id, file)));

    this.busyId.set(doc?.id ?? type.key);
    record$.subscribe({
      next: (saved) => {
        this.busyId.set(null);
        this.replace(saved);
        toast.success(`${type.name} uploaded. It still needs to be verified.`);
      },
      error: (err) => {
        this.busyId.set(null);
        toast.error(errorMessage(err, 'The file could not be uploaded.'));
        this.load();
      },
    });
  }

  open(doc: AdmissionDocument): void {
    this.admissions.openFile(this.admissions.documentLink(doc.id)).subscribe({
      error: (err) => toast.error(errorMessage(err, 'The file could not be opened.')),
    });
  }

  verify(doc: AdmissionDocument): void {
    this.review(doc, 'VERIFIED');
  }

  confirmReject(): void {
    const doc = this.rejecting();
    if (doc) this.review(doc, 'REJECTED', this.rejectReason);
  }

  private review(doc: AdmissionDocument, status: 'VERIFIED' | 'REJECTED', reason = ''): void {
    this.busyId.set(doc.id);
    this.admissions.reviewDocument(doc.id, status, reason).subscribe({
      next: (saved) => {
        this.busyId.set(null);
        this.rejecting.set(null);
        this.rejectReason = '';
        this.replace(saved);
      },
      error: (err) => {
        this.busyId.set(null);
        toast.error(errorMessage(err, 'The review could not be saved.'));
      },
    });
  }

  setExpiry(doc: AdmissionDocument, value: string): void {
    this.admissions.updateDocument(doc.id, { expiresAt: value ? fromLocalInput(value) : null }).subscribe({
      next: (saved) => this.replace(saved),
      error: (err) => toast.error(errorMessage(err, 'The expiry date could not be saved.')),
    });
  }
}
