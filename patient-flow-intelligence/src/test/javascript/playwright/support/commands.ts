// ***********************************************
// Begin Specific Selector Attributes
// ***********************************************

// Navbar
export const navbarSelector = '[data-cy="navbar"]';
export const adminMenuSelector = '[data-cy="adminMenu"]';
export const accountMenuSelector = '[data-cy="accountMenu"]';
export const registerItemSelector = '[data-cy="register"]';
export const settingsItemSelector = '[data-cy="settings"]';
export const passwordItemSelector = '[data-cy="passwordItem"]';
export const loginItemSelector = '[data-cy="login"]';
export const logoutItemSelector = '[data-cy="logout"]';
export const entityItemSelector = '[data-cy="entity"]';

// Administration
export const swaggerFrameSelector = 'iframe[data-cy="swagger-frame"]';
export const swaggerPageSelector = '[id="swagger-ui"]';

// ***********************************************
// End Specific Selector Attributes
// ***********************************************

export const classInvalid = 'is-invalid';

export const classValid = 'is-valid';

export interface Credentials {
  adminUsername: string;
  adminPassword: string;
  username: string;
  password: string;
}

/** Mirrors the Cypress `credentials` command: environment overrides win over the generated defaults. */
export const credentials = (): Credentials => ({
  adminUsername: process.env.E2E_USERNAME ?? 'admin',
  adminPassword: process.env.E2E_PASSWORD ?? 'admin',
  username: process.env.E2E_USERNAME ?? 'user',
  password: process.env.E2E_PASSWORD ?? 'user',
});
