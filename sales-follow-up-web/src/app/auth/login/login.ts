import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, GOOGLE_SIGNUP_REQUIRED } from '../../core/services/auth.service';
import { GoogleAuthService } from '../../core/services/google-auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private authService = inject(AuthService);
  private googleAuthService = inject(GoogleAuthService);

  showPassword = signal(false);
  isLoading = signal(false);
  // Sent here after the company was suspended (see the auth interceptor)
  errorMessage = signal<string | null>(
    inject(ActivatedRoute).snapshot.queryParamMap.has('suspended') ? 'This workspace is suspended. Contact Kelto support.' : null
  );

  readonly googleEnabled = this.googleAuthService.isConfigured;
  private googleButton = viewChild<ElementRef<HTMLElement>>('googleButton');

  loginForm = this.fb.nonNullable.group({
    email: [''],
    password: ['']
  });

  ngAfterViewInit(): void {
    const container = this.googleButton()?.nativeElement;
    if (!container) return;

    this.googleAuthService
      .renderButton(container, 'signin_with', (credential) => this.signInWithGoogle(credential))
      .catch(() => this.errorMessage.set('Google sign-in could not be loaded. Please try again later.'));
  }

  submit(): void {
    this.errorMessage.set(null);
    this.isLoading.set(true);

    const { email, password } = this.loginForm.getRawValue();

    this.authService.login({ email, password }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(err.error?.message);
      },
    });
  }

  private signInWithGoogle(credential: string): void {
    this.errorMessage.set(null);
    this.isLoading.set(true);

    this.authService.googleAuth({ credential }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.isLoading.set(false);

        // No account yet: finish signup on the register page
        if (err.error?.code === GOOGLE_SIGNUP_REQUIRED) {
          this.authService.pendingGoogleSignup.set({
            credential,
            email: err.error.data?.email ?? '',
            name: err.error.data?.name ?? '',
          });
          this.router.navigate(['/auth/register']);
          return;
        }

        this.errorMessage.set(err.error?.message ?? 'Google sign-in failed. Please try again.');
      },
    });
  }
}
