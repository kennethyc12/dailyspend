import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

/**
 * 這份設定的目的不是統一風格，是抓 bug。
 *
 * 最重要的一條是 `no-floating-promises`：沒 await 也沒 catch 的 Promise
 * 一旦 reject，使用者看到的是「按鈕沒反應」。Phase 6 的還原按鈕就是這樣
 * 卡住的，而 240 個單元測試完全抓不到。這條規則讓它在編譯期就現形。
 */
export default ts.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...ts.configs.recommended,
  // essential 只含防錯規則；recommended 會帶進一堆排版意見，對單人專案是雜訊。
  ...vue.configs['flat/essential'],

  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // 以下兩條刻意關閉，否則噪音會多到讓人忽略整份輸出：
      //
      // no-unnecessary-condition 會和防禦性的瀏覽器 API 判斷打架。TS 的 lib
      // 型別宣稱 navigator.storage、navigator.canShare 一定存在，但舊版
      // Safari 沒有，那些 `?.` 是必要的。
      '@typescript-eslint/no-unnecessary-condition': 'off',
      //
      // tsconfig 開了 noUncheckedIndexedAccess，陣列存取一律是 T | undefined，
      // `arr[0]!` 是這個設定下的慣用寫法而非偷懶。
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },

  {
    files: ['*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 這份設定檔本身是 JS，不在 tsconfig 的範圍內，型別感知的規則跑不動。
  {
    files: ['eslint.config.js'],
    extends: [ts.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
)
