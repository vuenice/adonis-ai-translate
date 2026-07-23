import router from '@adonisjs/core/services/router'

router.get('/', () => {
  return {
    ok: true,
    message: 'Open /ai-translate for the AI Translate dashboard.',
  }
})
