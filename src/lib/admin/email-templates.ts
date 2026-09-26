/** Customer email templates planned for Phase 2 automations. Safe on client and server. */
export const PLANNED_EMAIL_TEMPLATES: { key: string; name: string; when: string }[] = [
  { key: "quote_ready", name: "Quote ready", when: "When a quote is sent to the customer." },
  { key: "proof_ready", name: "Proof ready", when: "When a proof is ready for the customer to approve." },
  { key: "proof_reminder", name: "Proof reminder", when: "When a proof hasn't been answered after a few days." },
  { key: "artwork_needed", name: "Artwork needed", when: "When a job is waiting for the customer's artwork." },
  { key: "job_approved", name: "Job approved", when: "When the customer approves the proof and the job goes to production." },
  { key: "in_production", name: "In production", when: "When printing starts." },
  { key: "ready_pickup", name: "Ready for pickup", when: "When the order is ready at the counter." },
  { key: "install_scheduled", name: "Installation scheduled", when: "When an install date is set." },
  { key: "invoice_sent", name: "Invoice sent", when: "When an invoice is emailed." },
  { key: "payment_reminder", name: "Payment reminder", when: "When an invoice is past due." },
  { key: "thank_you", name: "Thank you", when: "After a job is completed and paid." },
  { key: "reorder_reminder", name: "Reorder reminder", when: "When a customer usually reorders (e.g. business cards once a year)." },
];
