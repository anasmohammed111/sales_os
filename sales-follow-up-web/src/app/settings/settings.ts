import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { concat, last, Observable } from 'rxjs';
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
export class Settings implements OnInit, OnDestroy {
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);

  readonly settings = signal<AccountSettings | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal<'profile' | 'password' | 'business' | 'branding' | 'logo' | null>(null);
  readonly isOwner = computed(() => this.settings()?.profile.role === 'OWNER');
  readonly selectedLogo = signal<File | null>(null);
  readonly logoPreviewUrl = signal('');
  readonly displayedLogoUrl = computed(() => this.logoPreviewUrl() || this.settings()?.business.logoUrl || '');
  readonly roleLabels = ROLE_LABELS;

  profile = { name: '', phone: '' };
  password = { current: '', next: '', confirm: '' };
  /** The firm name is edited in Workspace branding, so it is not part of this form */
  business = { email: '', phone: '', address: '', gstin: '', currency: 'USD' };
  brandName = '';

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.clearLogoSelection();
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
    const { email, phone, address, gstin, currency } = settings.business;
    this.business = { email, phone, address, gstin, currency };
    this.brandName = settings.business.businessName;
  }

  /** Refreshes from the server without losing a firm name that is still being typed */
  private applyKeepingName(settings: AccountSettings): void {
    const typed = this.brandName;
    this.apply(settings);
    this.brandName = typed;
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

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    // Clear the input so choosing the same file again still counts as a change
    input.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Choose a JPG, PNG or WEBP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('The logo must be 2 MB or smaller.');
      return;
    }

    this.clearLogoSelection();
    this.selectedLogo.set(file);
    this.logoPreviewUrl.set(URL.createObjectURL(file));
  }

  /** Drops a chosen logo that has not been saved yet */
  cancelLogo(): void {
    this.clearLogoSelection();
  }

  /** Whether Workspace branding has anything to save */
  brandingChanged(): boolean {
    return !!this.selectedLogo() || this.brandName.trim() !== (this.settings()?.business.businessName ?? '');
  }

  /** Saves the firm name and a newly chosen logo together */
  saveBranding(): void {
    const name = this.brandName.trim();
    if (!name) {
      toast.error('Enter your firm name.');
      return;
    }
    const file = this.selectedLogo();
    const steps: Observable<AccountSettings>[] = [];
    if (file) steps.push(this.settingsService.uploadBusinessLogo(file));
    if (name !== this.settings()?.business.businessName) steps.push(this.settingsService.updateBusiness({ businessName: name }));
    if (!steps.length) return;

    this.saving.set('branding');
    concat(...steps)
      .pipe(last())
      .subscribe({
        next: (settings) => {
          this.saving.set(null);
          this.clearLogoSelection();
          this.apply(settings);
          toast.success('Branding saved. Everyone in the workspace now sees it.');
        },
        error: (err) => {
          this.saving.set(null);
          toast.error(err?.error?.message || 'Your branding could not be saved.');
          // The logo may have saved before the name failed; show what the server has
          this.settingsService.get().subscribe({ next: (settings) => this.applyKeepingName(settings) });
        },
      });
  }

  removeLogo(): void {
    this.saving.set('logo');
    this.settingsService.removeBusinessLogo().subscribe({
      next: (settings) => {
        this.saving.set(null);
        this.clearLogoSelection();
        this.applyKeepingName(settings);
        toast.success('Workspace logo removed');
      },
      error: (err) => {
        this.saving.set(null);
        toast.error(err?.error?.message || 'The workspace logo could not be removed.');
      },
    });
  }

  private clearLogoSelection(): void {
    const preview = this.logoPreviewUrl();
    if (preview) URL.revokeObjectURL(preview);
    this.logoPreviewUrl.set('');
    this.selectedLogo.set(null);
  }
}
