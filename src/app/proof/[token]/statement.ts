/** What the customer agrees to. Stored with the approval, so the page and the action must build it the same way. */
export const approvalStatement = (shopName: string) =>
  `I approve this proof as shown. I have checked spelling, phone numbers, colors, sizes and layout, and I understand ${shopName} will produce the job exactly as it appears.`;

/** The shop's name for customer-facing text, with a neutral fallback. */
export const shopName = (name: string | null | undefined) => name?.trim() || "the print shop";
