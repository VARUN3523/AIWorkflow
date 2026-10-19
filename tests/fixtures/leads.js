/**
 * Lead qualification test fixtures for E2E testing
 */

export const enterpriseLeadPayload = {
  first_name: 'Sarah',
  last_name: 'Connor',
  email: 'sconnor@globaldefense.com',
  company: 'Global Defense Systems Inc.',
  title: 'VP of Engineering',
  employee_count: 2500,
  annual_revenue: '$150M+',
  use_case: 'Automate high-volume compliance document processing and audit pipelines.',
  budget: '$50,000 - $100,000/yr',
  timeline: 'Immediate (within 30 days)',
  phone: '+1 (555) 019-2831'
};

export const smbLeadPayload = {
  first_name: 'Bob',
  last_name: 'Miller',
  email: 'bob@bobscoffee.local',
  company: "Bob's Artisan Coffee",
  title: 'Owner',
  employee_count: 5,
  annual_revenue: '$300K',
  use_case: 'Looking to organize receipts and customer survey notes.',
  budget: '< $500/yr',
  timeline: 'Just exploring',
  phone: '+1 (555) 441-9921'
};

export const spamLeadPayload = {
  first_name: 'CryptoBot',
  last_name: 'Promo',
  email: 'no-reply@cryptopump12345.xyz',
  company: 'FREE BITCOIN GENERATOR',
  title: 'Bot',
  employee_count: 1,
  use_case: 'Check out our crypto signals link!',
  budget: '$0',
  timeline: 'Now'
};

export const emptyLeadPayload = {};

export const unicodeLeadPayload = {
  first_name: 'Élodie',
  last_name: 'Müller-Théberge',
  email: 'elodie@societe-francaise.eu',
  company: 'Société Générale de Création & Développement 🚀',
  title: 'Directrice des Opérations',
  employee_count: 450,
  use_case: 'Automatisation des flux de facturation multi-devises € & $',
  budget: '€30,000/yr'
};
