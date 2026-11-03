import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AdmissionsService } from '../../core/services/admissions.service';
import { Application, DuplicateMatch, StudyLevel } from '../admissions.models';
import { errorMessage, intakeLabel, MONTH_OPTIONS } from '../admissions.utils';

/** Add a student (or a new application for a returning one), warning about duplicates first. */
@Component({
  selector: 'adm-add-student',
  imports: [FormsModule],
  templateUrl: './add-student.html',
  styles: `
    .intake { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .match { display: grid; gap: 2px; margin-top: 6px; }
    .adm-segmented { width: fit-content; }
  `,
})
export class AddStudent {
  private readonly admissions = inject(AdmissionsService);

  readonly created = output<Application>();
  readonly closed = output<void>();

  readonly ctx = this.admissions.context;
  readonly months = MONTH_OPTIONS;
  readonly years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() + i);
  readonly intakeLabel = intakeLabel;

  readonly sources = computed(() => (this.ctx()?.config.leadSources || []).filter((s) => !s.isArchived));
  readonly counsellors = computed(() => this.ctx()?.counsellors || []);
  readonly canAssign = computed(() => this.ctx()?.role !== 'SALESPERSON');

  name = '';
  phone = '';
  email = '';
  whatsapp = '';
  sameAsPhone = true;
  city = '';
  studyLevel: StudyLevel = 'MASTER';
  intakeMonth = 9;
  intakeYear = new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0);
  leadSource = 'instagram';
  counsellorId = this.ctx()?.userId ?? '';

  readonly matches = signal<DuplicateMatch[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Set when the user picks an existing student to start a new application for. */
  readonly existingStudentId = signal<string | null>(null);

  checkDuplicates(): void {
    if (!this.email.trim() && this.phone.replace(/\D/g, '').length < 7) {
      this.matches.set([]);
      return;
    }
    this.admissions.checkDuplicates({ email: this.email, phone: this.phone }).subscribe({
      next: (matches) => this.matches.set(matches),
      error: () => this.matches.set([]),
    });
  }

  useExisting(match: DuplicateMatch): void {
    this.existingStudentId.set(match.studentId ?? null);
  }

  submit(confirmDuplicate = false): void {
    this.error.set(null);
    this.busy.set(true);

    const admission = {
      studyLevel: this.studyLevel,
      intakeMonth: Number(this.intakeMonth),
      intakeYear: Number(this.intakeYear),
      leadSource: this.leadSource,
      ...(this.canAssign() && this.counsellorId ? { counsellorId: this.counsellorId } : {}),
    };

    const body = this.existingStudentId()
      ? { ...admission, studentId: this.existingStudentId() }
      : {
          ...admission,
          confirmDuplicate,
          student: {
            name: this.name,
            phone: this.phone,
            email: this.email,
            whatsapp: this.sameAsPhone ? this.phone : this.whatsapp,
            city: this.city,
          },
        };

    this.admissions.createApplication(body).subscribe({
      next: (application) => {
        this.busy.set(false);
        this.created.emit(application);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        if (err.error?.code === 'POSSIBLE_DUPLICATE') {
          this.matches.set(err.error.data?.matches ?? []);
          this.error.set('A student with the same phone or email already exists. Check below before adding.');
        } else {
          this.error.set(errorMessage(err, 'The student could not be added.'));
        }
      },
    });
  }
}
