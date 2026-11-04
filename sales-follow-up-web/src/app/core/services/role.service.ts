import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DataScope } from './auth.service';

export type ScopedModule = 'leads' | 'followups' | 'quotations' | 'admissions';

export interface PermissionAction {
  key: string;
  label: string;
}

export interface PermissionModule {
  key: string;
  label: string;
  scoped: boolean;
  actions: PermissionAction[];
}

export interface ScopeOption {
  key: DataScope;
  label: string;
  description: string;
}

export interface PermissionCatalog {
  modules: PermissionModule[];
  scopes: ScopeOption[];
}

export interface RoleRecord {
  _id: string;
  name: string;
  description: string;
  key: 'OWNER' | 'SALES_MANAGER' | 'SALESPERSON' | null;
  isSystem: boolean;
  isBuiltIn: boolean;
  permissions: string[];
  scopes: Record<ScopedModule, DataScope>;
  memberCount: number;
  /** Whether the signed-in person may give this role to someone */
  grantable?: boolean;
}

export interface RoleInput {
  name: string;
  description: string;
  permissions: string[];
  scopes: Record<ScopedModule, DataScope>;
}

export interface AssignablePerson {
  _id: string;
  name: string;
  email: string;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/roles`;

  catalog(): Observable<PermissionCatalog> {
    return this.http.get<ApiResponse<PermissionCatalog>>(`${this.base}/catalog`).pipe(map((res) => res.data));
  }

  list(): Observable<RoleRecord[]> {
    return this.http.get<ApiResponse<RoleRecord[]>>(this.base).pipe(map((res) => res.data));
  }

  create(input: RoleInput): Observable<RoleRecord> {
    return this.http.post<ApiResponse<RoleRecord>>(this.base, input).pipe(map((res) => res.data));
  }

  update(id: string, input: Partial<RoleInput>): Observable<RoleRecord> {
    return this.http.patch<ApiResponse<RoleRecord>>(`${this.base}/${id}`, input).pipe(map((res) => res.data));
  }

  /** Deletes a custom role; people who have it move to `reassignTo` */
  remove(id: string, reassignTo?: string): Observable<void> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.base}/${id}`, { body: reassignTo ? { reassignTo } : {} })
      .pipe(map(() => undefined));
  }

  /** People the signed-in person may assign a module's records to */
  assignable(module: ScopedModule): Observable<AssignablePerson[]> {
    return this.http
      .get<ApiResponse<AssignablePerson[]>>(`${this.base}/assignable/${module}`)
      .pipe(map((res) => res.data));
  }
}
