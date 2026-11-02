import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  private fb = inject(FormBuilder);

  isLoading = signal(false);
  isSubmitted = signal(false);
  submittedEmail = signal('');
  errorMessage = signal<string | null>(null);
  resendSuccess = signal(false);

  forgotForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    this.errorMessage.set(null);
    this.isLoading.set(true);

    setTimeout(() => {
      this.isLoading.set(false);
      this.submittedEmail.set(this.forgotForm.controls.email.value);
      this.isSubmitted.set(true);
    }, 800);
  }

  resendLink(): void {
    this.resendSuccess.set(false);
    this.isLoading.set(true);

    setTimeout(() => {
      this.isLoading.set(false);
      this.resendSuccess.set(true);
      setTimeout(() => this.resendSuccess.set(false), 4000);
    }, 800);
  }
}
