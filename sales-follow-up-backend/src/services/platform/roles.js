// Platform (Kelto staff) roles and permissions. Enforced on the server by
// requirePlatformPermission; the admin app only uses them to hide what an
// administrator cannot do. Later milestones add plans, billing and master
// data permissions here.

const PLATFORM_PERMISSIONS = {
    'companies.view': 'See companies, their people and usage',
    'companies.lifecycle': 'Suspend and reactivate companies',
    'modules.manage': 'Switch modules on or off for a company',
    'support.view': 'Open a company read-only, as its owner or as one of its people',
    'support.edit': "Start support-edit sessions (only with the company owner's permission)",
    'sessions.view': 'See support sessions',
    'sessions.revoke': "End anyone's support session",
    'admins.view': 'See platform administrators and their sign-ins',
    'admins.manage': 'Add administrators, change roles, deactivate, reset access',
    'audit.view': 'Read the platform audit log',
};

const ALL = Object.keys(PLATFORM_PERMISSIONS);

const PLATFORM_ROLES = {
    SUPER_ADMIN: { name: 'Super admin', permissions: ALL },
    PLATFORM_ADMIN: {
        name: 'Platform administrator',
        permissions: [
            'companies.view',
            'companies.lifecycle',
            'modules.manage',
            'support.view',
            'sessions.view',
            'sessions.revoke',
            'admins.view',
            'audit.view',
        ],
    },
    // Billing permissions arrive with plans and invoices (milestones 4-5)
    BILLING_ADMIN: { name: 'Billing administrator', permissions: ['companies.view', 'audit.view'] },
    SUPPORT_ADMIN: { name: 'Support administrator', permissions: ['companies.view', 'support.view', 'sessions.view'] },
    AUDITOR: { name: 'Read-only auditor', permissions: ['companies.view', 'sessions.view', 'admins.view', 'audit.view'] },
};

const ROLE_KEYS = Object.keys(PLATFORM_ROLES);

/** Accounts created before roles existed are the original owner: super admin. */
const roleOf = (admin) => (ROLE_KEYS.includes(admin?.role) ? admin.role : 'SUPER_ADMIN');

const permissionsOf = (admin) => PLATFORM_ROLES[roleOf(admin)].permissions;

module.exports = { PLATFORM_PERMISSIONS, PLATFORM_ROLES, ROLE_KEYS, roleOf, permissionsOf };
