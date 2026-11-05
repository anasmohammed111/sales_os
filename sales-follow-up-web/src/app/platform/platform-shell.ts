import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PlatformService } from '../core/services/platform.service';

/** Frame of the super admin console: brand, sections and sign-out. */
@Component({
  selector: 'kt-platform-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="bar">
      <div class="bar-inner">
        <a class="brand" routerLink="/platform">
          <img src="kelto-mark.svg" alt="" width="34" height="34" />
          <strong>Kelto platform</strong>
          <span class="tag">Super admin</span>
        </a>
        <nav aria-label="Platform sections">
          <a routerLink="/platform" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active">Workspaces</a>
          <a routerLink="/platform/users" routerLinkActive="active">People</a>
          <a routerLink="/platform/audit" routerLinkActive="active">Audit log</a>
        </nav>
        <div class="who">
          <span>{{ platform.admin()?.name }}</span>
          <button type="button" (click)="platform.signOut()">Sign out</button>
        </div>
      </div>
    </header>
    <main class="body">
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: #f8fafc; }
    .bar { position: sticky; top: 0; z-index: 20; background: #0b1220; color: #fff; }
    .bar-inner { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; max-width: 1280px; margin: 0 auto; padding: 12px 24px; }
    .brand { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; }
    .brand strong { font-size: 16px; }
    .tag { padding: 3px 9px; border-radius: 999px; background: rgba(229, 96, 62, 0.18); color: #f6a68f; font-size: 12px; font-weight: 700; }
    nav { display: flex; gap: 4px; flex: 1; }
    nav a { padding: 8px 12px; border-radius: 9px; color: #cbd5e1; font-size: 14px; font-weight: 600; text-decoration: none; }
    nav a:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    nav a.active { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .who { display: flex; align-items: center; gap: 12px; color: #cbd5e1; font-size: 13.5px; }
    .who button { padding: 7px 12px; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 9px; background: transparent; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .body { max-width: 1280px; margin: 0 auto; padding: 26px 24px 60px; }
  `,
})
export class PlatformShell {
  readonly platform = inject(PlatformService);
}
