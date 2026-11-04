/**
 * Every permission in the CRM, grouped by module. This is the single source of
 * truth: the API checks these keys, the Roles screen lists them, and the
 * default roles below are built from them.
 *
 * A permission key is "<module>.<action>", e.g. "leads.edit".
 * Modules with `scoped: true` also have a data scope per role:
 *   own  - records assigned to me
 *   team - mine and everyone who reports to me (at any level)
 *   all  - every record in the business
 */

const SCOPES = ['own', 'team', 'all'];

const MODULES = [
    {
        key: 'dashboard',
        label: 'Dashboard',
        actions: [{ key: 'view', label: 'View the dashboard' }],
    },
    {
        key: 'leads',
        label: 'Leads',
        scoped: true,
        actions: [
            { key: 'view', label: 'View leads' },
            { key: 'create', label: 'Add leads' },
            { key: 'edit', label: 'Edit leads and change their status' },
            { key: 'assign', label: 'Assign leads to other people' },
            { key: 'archive', label: 'Archive leads' },
        ],
    },
    {
        key: 'followups',
        label: 'Follow-ups',
        scoped: true,
        actions: [
            { key: 'view', label: 'View follow-ups' },
            { key: 'create', label: 'Schedule follow-ups' },
            { key: 'edit', label: 'Edit, complete and cancel follow-ups' },
            { key: 'assign', label: 'Assign follow-ups to other people' },
            { key: 'archive', label: 'Archive follow-ups' },
            { key: 'delete', label: 'Delete archived follow-ups permanently' },
        ],
    },
    {
        key: 'pipeline',
        label: 'Sales pipeline',
        actions: [
            { key: 'view', label: 'View the sales pipeline' },
            { key: 'move', label: 'Move leads between stages' },
        ],
    },
    {
        key: 'quotations',
        label: 'Quotations',
        scoped: true,
        actions: [
            { key: 'view', label: 'View quotations' },
            { key: 'create', label: 'Create quotations' },
            { key: 'edit', label: 'Edit quotations' },
            { key: 'status', label: 'Send, accept, reject or expire quotations' },
            { key: 'delete', label: 'Delete quotations' },
        ],
    },
    {
        key: 'admissions',
        label: 'Admissions',
        scoped: true,
        actions: [
            { key: 'view', label: 'View students and applications' },
            { key: 'create', label: 'Add students' },
            { key: 'edit', label: 'Edit details, checklists, notes and tasks' },
            { key: 'assign', label: 'Assign students to counsellors' },
            { key: 'move', label: 'Move students between stages' },
            { key: 'override', label: 'Override stage requirements and correct visa results' },
            { key: 'close', label: 'Close, withdraw and reactivate applications' },
            { key: 'documents', label: 'Upload and review documents' },
            { key: 'payments', label: 'View fees and payments' },
            { key: 'record_payments', label: 'Add fees and record or void payments' },
            { key: 'export', label: 'Export students and payments' },
            { key: 'settings', label: 'Change admissions settings' },
        ],
    },
    {
        key: 'reports',
        label: 'Reports',
        actions: [
            { key: 'view', label: 'View reports' },
            { key: 'export', label: 'Export reports' },
        ],
    },
    {
        key: 'team',
        label: 'Team',
        actions: [
            { key: 'view', label: 'View team members' },
            { key: 'create', label: 'Add team members' },
            { key: 'edit', label: 'Edit team members and their roles' },
            { key: 'deactivate', label: 'Deactivate and reactivate members' },
            { key: 'delete', label: 'Delete team members' },
        ],
    },
    {
        key: 'settings',
        label: 'Workspace settings',
        actions: [
            { key: 'business', label: 'Change business details, logo and name' },
            { key: 'roles', label: 'Create and edit roles and permissions' },
        ],
    },
];

const SCOPED_MODULES = MODULES.filter((m) => m.scoped).map((m) => m.key);
const ALL_PERMISSIONS = MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}`));
const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/** Extra prerequisites beyond "<module>.view" */
const REQUIRES = {
    'admissions.record_payments': ['admissions.payments'],
    'admissions.override': ['admissions.move'],
    'team.edit': ['team.view'],
    'settings.roles': ['team.view'],
};

/**
 * Cleans a permission list: drops unknown keys and adds what each permission
 * needs (any action in a module needs that module's "view").
 */
const normalizePermissions = (list) => {
    const out = new Set();
    const add = (key) => {
        if (!PERMISSION_SET.has(key) || out.has(key)) return;
        out.add(key);
        const [module, action] = key.split('.');
        if (action !== 'view' && PERMISSION_SET.has(`${module}.view`)) add(`${module}.view`);
        for (const needed of REQUIRES[key] || []) add(needed);
    };
    for (const key of Array.isArray(list) ? list : []) if (typeof key === 'string') add(key);
    return ALL_PERMISSIONS.filter((key) => out.has(key));
};

const normalizeScopes = (scopes, fallback = 'own') =>
    Object.fromEntries(
        SCOPED_MODULES.map((m) => [m, SCOPES.includes(scopes?.[m]) ? scopes[m] : fallback])
    );

const everything = () => [...ALL_PERMISSIONS];
const except = (excluded) => ALL_PERMISSIONS.filter((key) => !excluded.includes(key));

/**
 * The three built-in roles. They reproduce how the CRM behaved before roles
 * were customisable, so existing users keep exactly the access they had.
 */
const DEFAULT_ROLES = {
    OWNER: {
        key: 'OWNER',
        name: 'Owner',
        description: 'Full access to everything. This role cannot be changed.',
        isSystem: true,
        permissions: everything(),
        scopes: normalizeScopes({}, 'all'),
    },
    SALES_MANAGER: {
        key: 'SALES_MANAGER',
        name: 'Sales manager',
        description: 'Runs a team: sees and assigns work for everyone who reports to them.',
        isSystem: false,
        permissions: except([
            'followups.delete',
            'admissions.override',
            'admissions.settings',
            'team.view',
            'team.create',
            'team.edit',
            'team.deactivate',
            'team.delete',
            'settings.business',
            'settings.roles',
        ]),
        scopes: normalizeScopes({}, 'team'),
    },
    SALESPERSON: {
        key: 'SALESPERSON',
        name: 'Salesperson',
        description: 'Works their own leads, follow-ups and students.',
        isSystem: false,
        permissions: except([
            'leads.assign',
            'followups.assign',
            'followups.delete',
            'admissions.override',
            'admissions.settings',
            'team.view',
            'team.create',
            'team.edit',
            'team.deactivate',
            'team.delete',
            'settings.business',
            'settings.roles',
        ]),
        scopes: normalizeScopes({}, 'own'),
    },
};

/** Legacy role field ('OWNER' | 'SALES_MANAGER' | 'SALESPERSON') for a role */
const legacyRoleFor = (role) =>
    role?.key === 'OWNER' ? 'OWNER' : role?.key === 'SALES_MANAGER' ? 'SALES_MANAGER' : 'SALESPERSON';

module.exports = {
    SCOPES,
    MODULES,
    SCOPED_MODULES,
    ALL_PERMISSIONS,
    DEFAULT_ROLES,
    normalizePermissions,
    normalizeScopes,
    legacyRoleFor,
};
