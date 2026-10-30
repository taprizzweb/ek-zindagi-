export const ROLES = ['officer', 'supervisor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function homePathFor(role: Role): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'supervisor':
      return '/supervisor';
    case 'officer':
      return '/officer';
  }
}

/** Roles an admin may create through the app. Admins are created only by the seed script. */
export const CREATABLE_ROLES = ['officer', 'supervisor'] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];
