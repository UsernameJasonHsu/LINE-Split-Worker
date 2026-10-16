import type { FeedbackCategory, FeedbackStatus } from '../api';

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: '問題回報',
  idea: '功能建議',
  other: '其他',
};

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: '新回饋',
  in_progress: '處理中',
  done: '已完成',
  wont_fix: '暫不處理',
};

export const CATEGORY_PLACEHOLDERS: Record<FeedbackCategory, string> = {
  bug: '發生了什麼事？在哪個畫面、做了什麼操作？\n例如：新增支出時，日期欄位超出畫面',
  idea: '希望增加或改進什麼功能？\n例如：可以匯出成 Excel',
  other: '想說的話都可以寫在這裡',
};
