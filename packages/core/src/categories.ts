/** Expense category keys stored in `expenses.category` (null = uncategorised). */
export const EXPENSE_CATEGORIES = ['food', 'transport', 'lodging', 'shopping', 'fun', 'other'] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
