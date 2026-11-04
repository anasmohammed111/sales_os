import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toast } from 'ngx-sonner';
import { DataScope } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import {
  PermissionCatalog,
  PermissionModule,
  RoleRecord,
  RoleService,
  ScopedModule,
} from '../../core/services/role.service';

/** Prerequisites beyond "<module>.view" (the API applies the same rules) */
const REQUIRES: Record<string, string[]> = {
  'admissions.record_payments': ['admissions.payments'],
  'admissions.override': ['admissions.move'],
  'team.edit': ['team.view'],
  'settings.roles': ['team.view'],
};

const SCOPED: ScopedModule[] = ['leads', 'followups', 'quotations', 'admissions'];

interface Draft {
  name: string;
  description: string;
  permissions: Set<string>;
  scopes: Record<ScopedModule, DataScope>;
}

const NEW_ROLE = 'new';

@Component({
  selector: 'app-roles-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './roles-settings.html',
  styleUrl: './roles-settings.scss',
})
export class RolesSettings implements OnInit {
  private readonly roleService = inject(RoleService);
  readonly permissions = inject(PermissionService);

  readonly catalog = signal<PermissionCatalog | null>(null);
  readonly roles = signal<RoleRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly draft = signal<Draft | null>(null);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  /** Asks where the members of a role go before it is deleted */
  readonly reassigning = signal<RoleRecord | null>(null);
  reassignTo = '';

  readonly selected = computed(() => this.roles().find((r) => r._id === this.selectedId()) ?? null);
  readonly isNew = computed(() => this.selectedId() === NEW_ROLE);
  /** The Owner role, and roles with more access than mine, are read-only */
  readonly readOnly = computed(() => {
    const role = this.selected();
    if (this.isNew()) return false;
    if (!role) return true;
    if (role.key === 'OWNER') return true;
    if (!this.permissions.isOwner() && role._id === this.permissions.access()?.roleId) return true;
    return role.grantable === false;
  });
  readonly readOnlyReason = computed(() => {
    const role = this.selected();
    if (!role || this.isNew()) return '';
    if (role.key === 'OWNER') return 'The Owner role always has full access. It cannot be changed.';
    if (!this.permissions.isOwner() && role._id === this.permissions.access()?.roleId) {
      return 'This is your own role. Ask your workspace owner to change it.';
    }
    if (role.grantable === false) return 'This role has more access than you, so you cannot change it.';
    return '';
  });

  readonly dirty = computed(() => {
    const draft = this.draft();
    if (!draft) return false;
    if (this.isNew()) return true;
    const role = this.selected();
    if (!role) return false;
    return (
      draft.name.trim() !== role.name ||
      draft.description.trim() !== (role.description || '') ||
      !sameSet(draft.permissions, new Set(role.permissions)) ||
      SCOPED.some((m) => draft.scopes[m] !== role.scopes[m])
    );
  });

  readonly permissionCount = computed(() => this.draft()?.permissions.size ?? 0);
  readonly totalPermissions = computed(() =>
    (this.catalog()?.modules ?? []).reduce((sum, m) => sum + m.actions.length, 0)
  );
  /** Roles the members of a deleted role can move to */
  readonly reassignOptions = computed(() =>
    this.roles().filter((r) => r.key !== 'OWNER' && r._id !== this.reassigning()?._id && r.grantable !== false)
  );

  ngOnInit(): void {
    this.load();
  }

  load(selectId?: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.roleService.catalog().subscribe({
      next: (catalog) => this.catalog.set(catalog),
      error: () => this.error.set('The permission list could not load.'),
    });
    this.roleService.list().subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.loading.set(false);
        const keep = selectId ?? this.selectedId();
        const target = roles.find((r) => r._id === keep) ?? roles.find((r) => r.key !== 'OWNER') ?? roles[0];
        if (target) this.select(target);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Roles could not load. Check your connection and try again.');
      },
    });
  }

  select(role: RoleRecord): void {
    if (this.dirty() && !confirm('Discard the changes you have not saved?')) return;
    this.selectedId.set(role._id);
    this.draft.set({
      name: role.name,
      description: role.description || '',
      permissions: new Set(role.permissions),
      scopes: { ...role.scopes },
    });
  }

  newRole(from?: RoleRecord): void {
    if (this.dirty() && !confirm('Discard the changes you have not saved?')) return;
    this.selectedId.set(NEW_ROLE);
    this.draft.set({
      name: from ? `${from.name} (copy)` : '',
      description: from?.description ?? '',
      permissions: new Set(from?.permissions ?? ['dashboard.view']),
      scopes: from ? { ...from.scopes } : { leads: 'own', followups: 'own', quotations: 'own', admissions: 'own' },
    });
  }

  has(permission: string): boolean {
    return this.draft()?.permissions.has(permission) ?? false;
  }

  moduleState(module: PermissionModule): 'all' | 'some' | 'none' {
    const granted = module.actions.filter((a) => this.has(`${module.key}.${a.key}`)).length;
    return granted === 0 ? 'none' : granted === module.actions.length ? 'all' : 'some';
  }

  toggle(permission: string, on: boolean): void {
    this.updateDraft((draft) => {
      if (on) addWithNeeds(draft.permissions, permission, this.catalog());
      else removeWithDependents(draft.permissions, permission);
    });
  }

  toggleModule(module: PermissionModule, on: boolean): void {
    this.updateDraft((draft) => {
      for (const action of module.actions) {
        const key = `${module.key}.${action.key}`;
        if (on) addWithNeeds(draft.permissions, key, this.catalog());
        else removeWithDependents(draft.permissions, key);
      }
    });
  }

  setScope(module: string, scope: DataScope): void {
    this.updateDraft((draft) => {
      draft.scopes[module as ScopedModule] = scope;
    });
  }

  scopeOf(module: string): DataScope {
    return this.draft()?.scopes[module as ScopedModule] ?? 'own';
  }

  setName(value: string): void {
    this.updateDraft((draft) => (draft.name = value));
  }

  setDescription(value: string): void {
    this.updateDraft((draft) => (draft.description = value));
  }

  save(): void {
    const draft = this.draft();
    if (!draft || this.saving()) return;
    const name = draft.name.trim();
    if (name.length < 2) {
      toast.error('Give the role a name of at least 2 characters.');
      return;
    }
    const input = {
      name,
      description: draft.description.trim(),
      permissions: [...draft.permissions],
      scopes: draft.scopes,
    };
    this.saving.set(true);
    const request = this.isNew() ? this.roleService.create(input) : this.roleService.update(this.selectedId()!, input);
    request.subscribe({
      next: (role) => {
        this.saving.set(false);
        toast.success(this.isNew() ? `Role "${role.name}" created` : `Role "${role.name}" saved. Everyone with it gets the change now.`);
        this.draft.set(null);
        this.selectedId.set(role._id);
        this.load(role._id);
        // My own permissions may depend on roles too
        this.permissions.refresh(true);
      },
      error: (err) => {
        this.saving.set(false);
        toast.error(err?.error?.message || 'The role could not be saved.');
      },
    });
  }

  discard(): void {
    const role = this.selected();
    if (this.isNew()) {
      this.draft.set(null);
      const first = this.roles().find((r) => r.key !== 'OWNER') ?? this.roles()[0];
      this.selectedId.set(null);
      if (first) this.select(first);
      return;
    }
    if (role) {
      this.draft.set(null);
      this.select(role);
    }
  }

  askDelete(): void {
    const role = this.selected();
    if (!role || role.isBuiltIn) return;
    if (role.memberCount > 0) {
      this.reassignTo = '';
      this.reassigning.set(role);
      return;
    }
    if (!confirm(`Delete the role "${role.name}"?`)) return;
    this.remove(role);
  }

  remove(role: RoleRecord, reassignTo?: string): void {
    this.deleting.set(true);
    this.roleService.remove(role._id, reassignTo).subscribe({
      next: () => {
        this.deleting.set(false);
        this.reassigning.set(null);
        toast.success(`Role "${role.name}" deleted`);
        this.draft.set(null);
        this.selectedId.set(null);
        this.load();
      },
      error: (err) => {
        this.deleting.set(false);
        toast.error(err?.error?.message || 'The role could not be deleted.');
      },
    });
  }

  private updateDraft(change: (draft: Draft) => void): void {
    const draft = this.draft();
    if (!draft || this.readOnly()) return;
    const next: Draft = { ...draft, permissions: new Set(draft.permissions), scopes: { ...draft.scopes } };
    change(next);
    this.draft.set(next);
  }
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Adds a permission and what it needs: its module's "view" and any extra prerequisite */
function addWithNeeds(set: Set<string>, permission: string, catalog: PermissionCatalog | null): void {
  if (set.has(permission)) return;
  set.add(permission);
  const [module, action] = permission.split('.');
  const hasView = catalog?.modules.some((m) => m.key === module && m.actions.some((a) => a.key === 'view'));
  if (action !== 'view' && hasView) addWithNeeds(set, `${module}.view`, catalog);
  for (const needed of REQUIRES[permission] ?? []) addWithNeeds(set, needed, catalog);
}

/** Removes a permission and everything that needs it */
function removeWithDependents(set: Set<string>, permission: string): void {
  if (!set.has(permission)) return;
  set.delete(permission);
  const [module, action] = permission.split('.');
  for (const other of [...set]) {
    const [otherModule] = other.split('.');
    const needsView = action === 'view' && otherModule === module;
    const needsExtra = (REQUIRES[other] ?? []).includes(permission);
    if (needsView || needsExtra) removeWithDependents(set, other);
  }
}
