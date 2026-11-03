import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, GOOGLE_SIGNUP_REQUIRED } from '../../core/services/auth.service';
import { GoogleAuthService } from '../../core/services/google-auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register implements AfterViewInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);
  private googleAuthService = inject(GoogleAuthService);

  showPassword = signal(false);
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);

  readonly googleEnabled = this.googleAuthService.isConfigured;
  readonly googleSignup = this.authService.pendingGoogleSignup;
  private googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');

  registerForm = this.fb.nonNullable.group({
    fullName: [''],
    companyName: [''],
    email: [''],
    phone: [''],
    password: [''],
  });

  ngAfterViewInit(): void {
    const container = this.googleButton()?.nativeElement;
    if (!container) return;

    this.googleAuthService
      .renderButton(container, 'signup_with', (credential) => this.signUpWithGoogle(credential))
      .catch(() => this.errorMessage.set('Google sign-in could not be loaded. Please try again later.'));
  }

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

  completeGoogleSignup(): void {
    const pending = this.googleSignup();
    if (!pending) return;

    const { companyName, phone } = this.registerForm.getRawValue();

    if (!companyName.trim()) {
      this.errorMessage.set('Company name is required');
      return;
    }

    this.errorMessage.set(null);
    this.isLoading.set(true);

    this.authService
      .googleAuth({ credential: pending.credential, businessName: companyName, phone })
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigate(['/dashboard']);
        },
        error: (err) => {
          this.isLoading.set(false);

          // The Google token has expired or was rejected: start over
          if (err.status === 401) {
            this.googleSignup.set(null);
          }

          this.errorMessage.set(err.error?.message ?? 'Google sign-up failed. Please try again.');
        },
      });
  }

  cancelGoogleSignup(): void {
    this.googleSignup.set(null);
    this.errorMessage.set(null);
  }

  private signUpWithGoogle(credential: string): void {
    this.errorMessage.set(null);
    this.isLoading.set(true);

    // Logs straight in if this Google account already has a CRM account
    this.authService.googleAuth({ credential }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.isLoading.set(false);

        if (err.error?.code === GOOGLE_SIGNUP_REQUIRED) {
          this.googleSignup.set({
            credential,
            email: err.error.data?.email ?? '',
            name: err.error.data?.name ?? '',
          });
          return;
        }

        this.errorMessage.set(err.error?.message ?? 'Google sign-up failed. Please try again.');
      },
    });
  }
}
