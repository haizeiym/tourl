import { onMounted, onUnmounted, ref } from 'vue'

/** 视口宽度 < 768px 视为移动端 */
export function useIsMobile(breakpoint = 768) {
  const isMobile = ref(false)

  function update() {
    isMobile.value = window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', update)
  })

  return { isMobile }
}
