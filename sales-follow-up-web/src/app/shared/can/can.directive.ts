import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { PermissionService } from '../../core/services/permission.service';

/**
 * Shows an element only when the person has the permission. Pass a list to
 * show it when they have any one of them, or add `all: true` to need them all.
 *
 *   <button *ktCan="'leads.create'">Add lead</button>
 *   <section *ktCan="['team.create', 'team.edit']">…</section>
 *   <button *ktCan="['admissions.create', 'leads.edit']; all: true">Convert</button>
 *   <button *ktCan="'leads.edit'; else readOnly">Edit</button>
 */
@Directive({ selector: '[ktCan]' })
export class CanDirective {
  private readonly permissions = inject(PermissionService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly ktCan = input.required<string | string[]>();
  readonly ktCanElse = input<TemplateRef<unknown> | null>(null);
  readonly ktCanAll = input(false);

  private showing: 'main' | 'else' | 'none' | null = null;

  constructor() {
    effect(() => {
      const needed = this.ktCan();
      const allowed = Array.isArray(needed)
        ? this.ktCanAll()
          ? needed.every((p) => this.permissions.can(p))
          : this.permissions.canAny(...needed)
        : this.permissions.can(needed);
      const elseTemplate = this.ktCanElse();
      const next = allowed ? 'main' : elseTemplate ? 'else' : 'none';
      if (next === this.showing) return;
      this.container.clear();
      if (next === 'main') this.container.createEmbeddedView(this.template);
      else if (next === 'else' && elseTemplate) this.container.createEmbeddedView(elseTemplate);
      this.showing = next;
    });
  }
}
