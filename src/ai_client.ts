/**
 * Thin fetch-based clients for Anthropic Claude and Google Gemini.
 * Uses ANTHROPIC_API_KEY / GEMINI_API_KEY from the environment.
 */

const SYSTEM_PROMPT = 'You are a helpful translation assistant.'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientError(message: string): boolean {
  return /(overloaded|429|503|rate limit)/i.test(message)
}

async function withRetries<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const maxRetries = 2
  let attempt = 1

  while (true) {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= maxRetries || !isTransientError(message)) {
        throw new Error(`${provider[0]!.toUpperCase()}${provider.slice(1)} API Error: ${message}`)
      }
      await sleep(2000 * attempt)
      attempt++
    }
  }
}

async function callAnthropic(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
    error?: { message?: string }
  }

  if (!response.ok) {
    throw new Error(body.error?.message || `HTTP ${response.status}`)
  }

  const text = body.content?.find((block) => block.type === 'text')?.text
  if (!text) {
    throw new Error('Empty response from Anthropic')
  }

  return text
}

async function callGemini(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  })

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }

  if (!response.ok) {
    throw new Error(body.error?.message || `HTTP ${response.status}`)
  }

  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  if (!text) {
    throw new Error('Empty response from Gemini')
  }

  return text
}

export type AiProvider = 'anthropic' | 'gemini'

export async function promptAi(
  prompt: string,
  model: string,
  provider: AiProvider
): Promise<string> {
  return withRetries(provider, async () => {
    if (provider === 'anthropic') {
      return callAnthropic(prompt, model)
    }
    return callGemini(prompt, model)
  })
}
