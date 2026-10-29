export type ChineseVariant = 'original' | 'simplified' | 'traditional';
export const CHINESE_VARIANTS = [
  { value: 'original', label: '原文' },
  { value: 'simplified', label: '简体' },
  { value: 'traditional', label: '繁体' },
] as const;
