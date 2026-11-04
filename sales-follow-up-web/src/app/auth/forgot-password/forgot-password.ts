import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);

  isLoading = signal(false);
  isSubmitted = signal(false);
  submittedEmail = signal('');
  errorMessage = signal<string | null>(null);
  resendSuccess = signal(false);

  forgotForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.forgotForm.invalid) {
      this.errorMessage.set('Enter a valid email address');
      return;
    }
    this.errorMessage.set(null);
    this.isLoading.set(true);
    this.send(() => {
      this.submittedEmail.set(this.forgotForm.controls.email.value);
      this.isSubmitted.set(true);
    });
  }

  resendLink(): void {
    this.resendSuccess.set(false);
    this.isLoading.set(true);
    this.send(() => {
      this.resendSuccess.set(true);
      setTimeout(() => this.resendSuccess.set(false), 4000);
    });
  }

  private send(done: () => void): void {
    this.authService.forgotPassword(this.forgotForm.controls.email.value.trim()).subscribe({
      next: () => {
        this.isLoading.set(false);
        done();
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(err?.error?.message || 'The reset email could not be sent. Try again.');
      },
    });
  }
}
