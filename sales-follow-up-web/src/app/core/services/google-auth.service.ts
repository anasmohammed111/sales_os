import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

// Minimal typings for the parts of Google Identity Services we use.
// https://developers.google.com/identity/gsi/web/reference/js-reference
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: 'popup' | 'redirect';
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

export type GoogleButtonText = 'signin_with' | 'signup_with' | 'continue_with';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

@Injectable({
  providedIn: 'root',
})
export class GoogleAuthService {
  private readonly document = inject(DOCUMENT);
  private scriptLoad: Promise<void> | null = null;

  readonly isConfigured = !!environment.googleClientId;

  /**
   * Renders the official "Sign in with Google" button into `container`.
   * `onCredential` receives the Google ID token to send to the backend.
   */
  async renderButton(
    container: HTMLElement,
    text: GoogleButtonText,
    onCredential: (credential: string) => void
  ): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('Google sign-in is not configured');
    }

    await this.loadScript();

    const google = this.document.defaultView?.google;
    if (!google) {
      throw new Error('Google sign-in failed to load');
    }

    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (response) => onCredential(response.credential),
      ux_mode: 'popup',
    });

    // Google only accepts widths between 200 and 400px
    const width = Math.max(200, Math.min(400, container.clientWidth || 400));

    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      logo_alignment: 'center',
      text,
      width,
    });
  }

  private loadScript(): Promise<void> {
    if (this.document.defaultView?.google?.accounts?.id) {
      return Promise.resolve();
    }

    this.scriptLoad ??= new Promise<void>((resolve, reject) => {
      const script = this.document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.scriptLoad = null;
        script.remove();
        reject(new Error('Could not load Google sign-in'));
      };
      this.document.head.appendChild(script);
    });

    return this.scriptLoad;
  }
}
