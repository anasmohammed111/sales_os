import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AdmissionsService } from '../../core/services/admissions.service';

@Component({
  selector: 'adm-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admissions-layout.html',
  styleUrl: './admissions-layout.scss',
})
export class AdmissionsLayout implements OnInit {
  private readonly admissions = inject(AdmissionsService);

  readonly state = this.admissions.contextState;
  readonly context = this.admissions.context;

  readonly links = computed(() => [
    { path: 'overview', label: 'Overview' },
    { path: 'pipeline', label: 'Pipeline' },
    { path: 'students', label: 'Students' },
    { path: 'tasks', label: 'My tasks' },
    { path: 'payments', label: 'Payments' },
    ...(this.context()?.isAdmin ? [{ path: 'settings', label: 'Settings' }] : []),
  ]);

  ngOnInit(): void {
    this.admissions.loadContext().subscribe();
  }

  retry(): void {
    this.admissions.loadContext(true).subscribe();
  }
}
