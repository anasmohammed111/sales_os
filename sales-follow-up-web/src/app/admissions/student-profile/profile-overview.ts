import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { toast } from 'ngx-sonner';
import { AdmissionsService } from '../../core/services/admissions.service';
import { ApplicationDetail, StudyLevel, UniversityChoice } from '../admissions.models';
import { errorMessage, MONTH_OPTIONS } from '../admissions.utils';
import { PermissionService } from '../../core/services/permission.service';
import { CanDirective } from '../../shared/can/can.directive';

interface ChoiceDraft {
  universityId: string;
  courseId: string;
  universityName: string;
  courseName: string;
}

const draftOf = (c: Partial<UniversityChoice> | null | undefined): ChoiceDraft => ({
  universityId: c?.universityId || '',
  courseId: c?.courseId || '',
  universityName: c?.universityName || '',
  courseName: c?.courseName || '',
});

@Component({
  selector: 'adm-profile-overview',
  imports: [FormsModule, NgTemplateOutlet, CanDirective],
  templateUrl: './profile-overview.html',
  styleUrl: './profile-overview.scss',
})
export class ProfileOverview {
  /** What the signed-in person may do (see *ktCan in the template) */
  readonly permissions = inject(PermissionService);
  private readonly admissions = inject(AdmissionsService);

  readonly application = input.required<ApplicationDetail>();
  readonly updated = output<ApplicationDetail>();

  readonly ctx = this.admissions.context;
  readonly universities = computed(() => (this.ctx()?.universities || []).filter((u) => !u.isArchived));
  readonly sources = computed(() => this.ctx()?.config.leadSources || []);
  readonly months = MONTH_OPTIONS;
  readonly years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

  readonly saving = signal(false);
  readonly duplicateWarning = signal<string | null>(null);

  name = '';
  phone = '';
  email = '';
  whatsapp = '';
  city = '';
  studyLevel: StudyLevel = 'MASTER';
  intakeMonth = 1;
  intakeYear = new Date().getFullYear();
  leadSource = '';
  shortlist: ChoiceDraft[] = [];
  finalChoice: ChoiceDraft = draftOf(null);

  constructor() {
    effect(() => {
      const a = this.application();
      this.name = a.student.name;
      this.phone = a.student.phone;
      this.email = a.student.email;
      this.whatsapp = a.student.whatsapp;
      this.city = a.student.city;
      this.studyLevel = a.studyLevel;
      this.intakeMonth = a.intakeMonth;
      this.intakeYear = a.intakeYear;
      this.leadSource = a.leadSource;
      this.shortlist = (a.shortlist || []).map(draftOf);
      this.finalChoice = draftOf(a.finalChoice);
    });
  }

  coursesOf(universityId: string) {
    return (this.universities().find((u) => u._id === universityId)?.courses || []).filter(
      (c) => !c.isArchived && (!this.studyLevel || c.level === this.studyLevel)
    );
  }

  addChoice(): void {
    this.shortlist = [...this.shortlist, draftOf(null)];
  }

  removeChoice(index: number): void {
    this.shortlist = this.shortlist.filter((_, i) => i !== index);
  }

  useAsFinal(choice: ChoiceDraft): void {
    this.finalChoice = { ...choice };
  }

  private toPayload(choice: ChoiceDraft) {
    return choice.universityId
      ? { universityId: choice.universityId, courseId: choice.courseId || null, courseName: choice.courseName }
      : { universityName: choice.universityName, courseName: choice.courseName };
  }

  save(confirmDuplicate = false): void {
    this.saving.set(true);
    this.duplicateWarning.set(null);
    const body = {
      confirmDuplicate,
      student: { name: this.name, phone: this.phone, email: this.email, whatsapp: this.whatsapp, city: this.city },
      studyLevel: this.studyLevel,
      intakeMonth: Number(this.intakeMonth),
      intakeYear: Number(this.intakeYear),
      leadSource: this.leadSource,
      shortlist: this.shortlist.filter((c) => c.universityId || c.universityName.trim()).map((c) => this.toPayload(c)),
      finalChoice: this.toPayload(this.finalChoice),
    };

    this.admissions.updateApplication(this.application().id, body).subscribe({
      next: (detail) => {
        this.saving.set(false);
        toast.success('Details saved');
        this.updated.emit(detail);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.error?.code === 'POSSIBLE_DUPLICATE') {
          this.duplicateWarning.set('Another student already has this phone or email.');
        } else {
          toast.error(errorMessage(err, 'The details could not be saved.'));
        }
      },
    });
  }
}
