/**
 * Multi-tenant authentication and workspace test fixtures
 */

export const tenantAUser = {
  email: 'alice.tenantA@enterprise-alpha.com',
  password: 'Password123!SecureAuthAlpha',
  fullName: 'Alice Alpha',
  full_name: 'Alice Alpha'
};

export const tenantBUser = {
  email: 'bob.tenantB@beta-corp.io',
  password: 'Password999!SecureAuthBeta',
  fullName: 'Bob Beta',
  full_name: 'Bob Beta'
};

export const tenantCMember = {
  email: 'charlie.member@enterprise-alpha.com',
  password: 'PasswordMember456!Secure',
  fullName: 'Charlie Member',
  full_name: 'Charlie Member'
};

export const invalidUserCredentials = {
  email: 'nonexistent.user@unknown-domain.com',
  password: 'WrongPassword999!'
};

export const weakPasswordUser = {
  email: 'weak.user@test.com',
  password: '123',
  full_name: 'Weak Pass'
};

export const invalidEmailUser = {
  email: 'not-an-email-address',
  password: 'ValidPassword123!',
  full_name: 'Bad Email'
};

export const malformedTokens = [
  'not_a_valid_token',
  'Bearer ',
  'Bearer invalid.jwt.signature',
  '',
  'Bearer 00000000-0000-0000-0000-000000000000'
];

export const sqlInjectionStrings = [
  "' OR '1'='1",
  "admin'--",
  "'; DROP TABLE users; --",
  "\" or \"\"=\""
];

export const xssPayloadStrings = [
  "<script>alert('XSS')</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)"
];
