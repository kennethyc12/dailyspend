import { readonly, ref } from 'vue'

export type Platform = 'ios-safari' | 'ios-other-browser' | 'android' | 'desktop'

const STANDALONE_QUERY = '(display-mode: standalone)'
const DEV_BYPASS_KEY = 'dailyspend.devBypassInstallGate'

// iOS Safari 至今仍未實作 display-mode media query，只認 navigator.standalone。
// 少了這行，加到主畫面的 App 會被誤判成分頁而永遠卡在安裝引導。
interface IosNavigator extends Navigator {
  standalone?: boolean
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia(STANDALONE_QUERY).matches) return true
  return (navigator as IosNavigator).standalone === true
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  // iPadOS 13+ 的 UA 偽裝成 Mac，靠觸控點數量才分得出來。
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)

  if (isIos) {
    const isRealSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
    return isRealSafari ? 'ios-safari' : 'ios-other-browser'
  }
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

const isStandalone = ref(detectStandalone())
const platform = ref<Platform>(detectPlatform())

if (typeof window !== 'undefined') {
  window.matchMedia(STANDALONE_QUERY).addEventListener('change', (e) => {
    isStandalone.value = e.matches || (navigator as IosNavigator).standalone === true
  })
}

const devBypass = ref(import.meta.env.DEV && localStorage.getItem(DEV_BYPASS_KEY) === '1')

export function enableDevBypass() {
  if (!import.meta.env.DEV) return
  localStorage.setItem(DEV_BYPASS_KEY, '1')
  devBypass.value = true
}

export function useDisplayMode() {
  return {
    isStandalone: readonly(isStandalone),
    platform: readonly(platform),
    devBypass: readonly(devBypass),
  }
}
