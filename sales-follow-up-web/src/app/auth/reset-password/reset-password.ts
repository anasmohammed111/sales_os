import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

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
  private router = inject(Router);

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
    this.errorMessage.set(null);
    this.isLoading.set(true);

    setTimeout(() => {
      this.isLoading.set(false);
      this.isSuccess.set(true);
    }, 850);
  }
}
