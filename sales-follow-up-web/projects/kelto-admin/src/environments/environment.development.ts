// Keep apiUrl the same as the CRM's development environment: support sessions
// started here are opened in the CRM, which must talk to the same API.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5002/api',
  crmUrl: 'http://localhost:4200',
};
