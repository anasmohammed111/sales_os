// Keep apiUrl the same as the CRM's development environment. Port 5001 is the
// normal API backed by MONGO_URI; port 5002 is reserved for the optional
// throwaway in-memory demo server.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5001/api',
  crmUrl: 'http://localhost:4200',
};
