import { User, UserRole } from '../src/types';

export const SSO_USERS: Record<string, User> = {
  admin: {
    user_id: 'usr-admin-01',
    email: 'sarah.chen@enterprise.corp',
    display_name: 'Sarah Chen (Admin)',
    role: 'workspace_admin',
    avatar_initials: 'SC',
  },
  curator: {
    user_id: 'usr-curator-02',
    email: 'marcus.vance@enterprise.corp',
    display_name: 'Marcus Vance (Curator)',
    role: 'release_manager',
    avatar_initials: 'MV',
  },
  contributor: {
    user_id: 'usr-contrib-03',
    email: 'alex.rivera@enterprise.corp',
    display_name: 'Alex Rivera (Contributor)',
    role: 'contributor',
    avatar_initials: 'AR',
  },
  consumer: {
    user_id: 'usr-viewer-04',
    email: 'david.kim@enterprise.corp',
    display_name: 'David Kim (Data Consumer)',
    role: 'typical_user',
    avatar_initials: 'DK',
  },
};

export function authenticateUser(headerValue?: string | string[]): User {
  if (!headerValue) {
    return SSO_USERS.contributor;
  }
  const idOrRole = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  
  // Look up by role or user_id
  for (const user of Object.values(SSO_USERS)) {
    if (user.role === idOrRole || user.user_id === idOrRole || user.email === idOrRole) {
      return user;
    }
  }

  return SSO_USERS.contributor;
}
