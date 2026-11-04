import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { AccountSettings, SettingsService } from '../core/services/settings.service';
import { AuthService } from '../core/services/auth.service';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner (admin)',
  SALES_MANAGER: 'Manager',
  SALESPERSON: 'Counsellor / salesperson',
};

@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);

  readonly settings = signal<AccountSettings | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal<'profile' | 'password' | 'business' | null>(null);
  readonly isOwner = computed(() => this.settings()?.profile.role === 'OWNER');
  readonly roleLabels = ROLE_LABELS;

  profile = { name: '', phone: '' };
  password = { current: '', next: '', confirm: '' };
  business = { businessName: '', email: '', phone: '', address: '', gstin: '', currency: 'USD' };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.settingsService.get().subscribe({
      next: (settings) => this.apply(settings),
      error: (err) => this.error.set(err?.error?.message || 'Settings could not load. Check your connection and try again.'),
    });
  }

  private apply(settings: AccountSettings): void {
    this.settings.set(settings);
    this.profile = { name: settings.profile.name, phone: settings.profile.phone };
    const { businessName, email, phone, address, gstin, currency } = settings.business;
    this.business = { businessName, email, phone, address, gstin, currency };
  }

  passwordProblem(): string | null {
    const { current, next, confirm } = this.password;
    if (this.settings()?.profile.hasPassword && !current) return 'Enter your current password';
    if (next.length < 8) return 'Use at least 8 characters';
    if (next !== confirm) return "The two new passwords don't match";
    return null;
  }

  saveProfile(): void {
    this.saving.set('profile');
    this.settingsService.updateProfile(this.profile).subscribe({
      next: (settings) => {
        this.saving.set(null);
        this.apply(settings);
        this.authService.updateStoredUser({ name: settings.profile.name });
        toast.success('Profile saved');
      },
      error: (err) => {
        this.saving.set(null);
        toast.error(err?.error?.message || 'Your profile could not be saved.');
      },
    });
  }

  savePassword(): void {
    if (this.passwordProblem()) return;
    this.saving.set('password');
    this.settingsService
      .changePassword({
        ...(this.settings()?.profile.hasPassword ? { currentPassword: this.password.current } : {}),
        newPassword: this.password.next,
      })
      .subscribe({
        next: (settings) => {
          this.saving.set(null);
          this.apply(settings);
          this.password = { current: '', next: '', confirm: '' };
          toast.success('Password changed');
        },
        error: (err) => {
          this.saving.set(null);
          toast.error(err?.error?.message || 'Your password could not be changed.');
        },
      });
  }

  saveBusiness(): void {
    this.saving.set('business');
    this.settingsService.updateBusiness(this.business).subscribe({
      next: (settings) => {
        this.saving.set(null);
        this.apply(settings);
        toast.success('Business details saved');
      },
      error: (err) => {
        this.saving.set(null);
        toast.error(err?.error?.message || 'Business details could not be saved.');
      },
    });
  }
}
