import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mail_ok') === '1') {
  document.body.textContent = 'MAIL_OK'
} else {
  const app = createApp(App)
  app.use(ElementPlus, { locale: zhCn })
  app.mount('#app')
}
