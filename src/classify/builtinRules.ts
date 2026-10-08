import type { Rule, RuleType } from '@/models/types'
import { basePriority } from './matching'

type Seed = [RuleType, string, string]

/**
 * 起始規則，只求涵蓋最常見的幾類，其餘交給 §6.2 的修正學習長出來。
 *
 * 刻意不收的店家：7-11、全家、萊爾富、OK超商、全聯、家樂福、大潤發。
 * 它們橫跨飲料 / 飲食 / 日用品，猜一個預設值會系統性低估被猜走的那類，
 * 進而污染 §8 的建議排序（§3.3 定案：無品項時直接進待確認）。
 */
const SEEDS: Seed[] = [
  ['itemKeyword', '咖啡', 'drink'],
  ['itemKeyword', '拿鐵', 'drink'],
  ['itemKeyword', '美式', 'drink'],
  ['itemKeyword', '卡布奇諾', 'drink'],
  ['itemKeyword', '奶茶', 'drink'],
  ['itemKeyword', '紅茶', 'drink'],
  ['itemKeyword', '綠茶', 'drink'],
  ['itemKeyword', '珍珠', 'drink'],
  ['itemKeyword', '可樂', 'drink'],
  ['itemKeyword', '果汁', 'drink'],
  ['itemKeyword', '豆漿', 'drink'],
  ['itemKeyword', '礦泉水', 'drink'],

  ['itemKeyword', '便當', 'food'],
  ['itemKeyword', '飯糰', 'food'],
  ['itemKeyword', '炒飯', 'food'],
  ['itemKeyword', '滷肉飯', 'food'],
  ['itemKeyword', '拉麵', 'food'],
  ['itemKeyword', '牛肉麵', 'food'],
  ['itemKeyword', '義大利麵', 'food'],
  ['itemKeyword', '水餃', 'food'],
  ['itemKeyword', '小籠包', 'food'],
  ['itemKeyword', '三明治', 'food'],
  ['itemKeyword', '吐司', 'food'],
  ['itemKeyword', '漢堡', 'food'],
  ['itemKeyword', '壽司', 'food'],
  ['itemKeyword', '沙拉', 'food'],

  ['itemKeyword', '衛生紙', 'daily'],
  ['itemKeyword', '洗髮精', 'daily'],
  ['itemKeyword', '沐浴乳', 'daily'],
  ['itemKeyword', '牙膏', 'daily'],
  ['itemKeyword', '牙刷', 'daily'],
  ['itemKeyword', '洗衣精', 'daily'],
  ['itemKeyword', '洗碗精', 'daily'],
  ['itemKeyword', '垃圾袋', 'daily'],
  ['itemKeyword', '電池', 'daily'],

  ['itemKeyword', '口罩', 'medical'],
  ['itemKeyword', '維他命', 'medical'],
  ['itemKeyword', '感冒藥', 'medical'],
  ['itemKeyword', '酸痛貼布', 'medical'],
  ['itemKeyword', 'OK繃', 'medical'],

  ['itemKeyword', '電影票', 'fun'],
  ['itemKeyword', '門票', 'fun'],

  ['itemKeyword', '參考書', 'education'],
  ['itemKeyword', '講義', 'education'],
  ['itemKeyword', '課程', 'education'],

  ['itemKeyword', '捷運', 'transport'],
  ['itemKeyword', '悠遊卡', 'transport'],
  ['itemKeyword', '加油', 'transport'],
  ['itemKeyword', '汽油', 'transport'],
  ['itemKeyword', '停車', 'transport'],
  ['itemKeyword', '計程車', 'transport'],

  ['merchant', 'Netflix', 'subscription'],
  ['merchant', 'Spotify', 'subscription'],
  ['merchant', 'Disney+', 'subscription'],
  ['merchant', 'YouTube Premium', 'subscription'],
  ['merchant', 'iCloud', 'subscription'],
  ['merchant', 'Apple One', 'subscription'],
  ['merchant', 'ChatGPT', 'subscription'],
  ['merchant', 'Notion', 'subscription'],

  ['merchant', '中油', 'transport'],
  ['merchant', '台塑石油', 'transport'],
  ['merchant', '台灣大車隊', 'transport'],
  ['merchant', '高鐵', 'transport'],
  ['merchant', '台鐵', 'transport'],
]

export function builtinRules(now = Date.now()): Rule[] {
  return SEEDS.map(([type, pattern, categoryId], i) => ({
    id: `builtin-${type}-${i}`,
    type,
    pattern,
    matchMode: 'contains' as const,
    categoryId,
    priority: basePriority(type, 'builtin'),
    origin: 'builtin' as const,
    isActive: true,
    hitCount: 0,
    lastHitAt: null,
    createdAt: now,
    updatedAt: now,
  }))
}
