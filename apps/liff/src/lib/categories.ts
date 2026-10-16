import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@line-split/core';

export const CATEGORY_META: Record<ExpenseCategory, { label: string; emoji: string }> = {
  food: { label: '餐飲', emoji: '🍜' },
  transport: { label: '交通', emoji: '🚕' },
  lodging: { label: '住宿', emoji: '🏨' },
  shopping: { label: '購物', emoji: '🛍️' },
  fun: { label: '娛樂', emoji: '🎡' },
  other: { label: '其他', emoji: '📦' },
};

export const UNCATEGORIZED = { label: '未分類', emoji: '🧾' };

export { EXPENSE_CATEGORIES };

export function categoryMeta(category: string | null) {
  return (category && CATEGORY_META[category as ExpenseCategory]) || UNCATEGORIZED;
}
