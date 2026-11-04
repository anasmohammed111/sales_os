import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

export const passwordMatchValidator: ValidatorFn = (
  control: AbstractControl
): ValidationErrors | null => {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');

  if (
    password &&
    confirmPassword &&
    password.value !== confirmPassword.value &&
    confirmPassword.touched
  ) {
    return { passwordMismatch: true };
  }
  return null;
};

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  /** From the link in the reset email: /auth/reset-password?token=… */
  private token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') || '';

  showPassword = signal(false);
  showConfirmPassword = signal(false);
  isLoading = signal(false);
  isSuccess = signal(false);
  errorMessage = signal<string | null>(null);

  resetForm = this.fb.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: [passwordMatchValidator] }
  );

  submit(): void {
    if (!this.token) {
      this.errorMessage.set('This reset link is incomplete. Open the link from your email again, or ask for a new one.');
      return;
    }
    if (this.resetForm.invalid) {
      this.errorMessage.set('Use at least 8 characters, and type the same password twice.');
      return;
    }
    this.errorMessage.set(null);
    this.isLoading.set(true);
    this.authService.resetPassword(this.token, this.resetForm.controls.password.value || '').subscribe({
      next: () => {
        this.isLoading.set(false);
        this.isSuccess.set(true);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(err?.error?.message || 'The password could not be reset. Try again.');
      },
    });
  }
}
