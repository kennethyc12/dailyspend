import { createApp } from 'vue'
import App from '@/App.vue'
import { router } from '@/router'
import { installGlobalErrorHandlers } from '@/errors/install'
import '@/styles/base.css'

const app = createApp(App)
installGlobalErrorHandlers(app)
app.use(router).mount('#app')
