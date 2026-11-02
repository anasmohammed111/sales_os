import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);

  showPassword = signal(false);
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);

  registerForm = this.fb.nonNullable.group({
    fullName: [''],
    companyName: [''],
    email: [''],
    phone: [''],
    password: [''],
  });

  submit(): void {
    this.errorMessage.set(null);
    this.isLoading.set(true);

    const form = this.registerForm.getRawValue();

    this.authService
      .register({
        name: form.fullName,
        businessName: form.companyName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        confirmPassword: form.password,
      })
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigate(['/auth/login']);
        },
        error: (err) => {
          this.isLoading.set(false);
          this.errorMessage.set(err.error?.message);
        },
      });
  }
}
