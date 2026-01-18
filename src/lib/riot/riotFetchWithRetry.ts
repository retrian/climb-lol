/**
 * Riot API fetch with automatic retry logic for rate limits (429) and server errors (5xx)
 * Implements exponential backoff for rate limit retries
 */

interface RiotFetchOptions {
  maxRetries?: number
  retryDelay?: number
  retryOn429?: boolean
}

const DEFAULT_OPTIONS: Required<RiotFetchOptions> = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second base delay
  retryOn429: true,
}

/**
 * Parse Retry-After header or calculate delay from rate limit headers
 */
function getRetryDelay(response: Response, attempt: number, baseDelay: number): number {
  // Check for Retry-After header (seconds)
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000 // Convert to milliseconds
    }
  }

  // Check for X-Rate-Limit-Type header
  const rateLimitType = response.headers.get('X-Rate-Limit-Type')
  
  // Exponential backoff: baseDelay * 2^attempt
  // For 429 errors, use longer delays
  if (response.status === 429) {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000 // Add jitter
  }

  // For other retryable errors, use shorter delays
  return baseDelay * Math.pow(2, attempt)
}

/**
 * Check if an error status should be retried
 */
function shouldRetry(status: number, attempt: number, maxRetries: number, retryOn429: boolean): boolean {
  if (attempt >= maxRetries) return false
  
  // Always retry 429 if enabled
  if (status === 429 && retryOn429) return true
  
  // Retry 5xx server errors
  if (status >= 500 && status < 600) return true
  
  // Retry 408 Request Timeout
  if (status === 408) return true
  
  return false
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch from Riot API with automatic retry logic
 */
export async function riotFetchWithRetry<T>(
  url: string,
  apiKey: string,
  options: RiotFetchOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: Error | null = null
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'X-Riot-Token': apiKey,
        },
        next: { revalidate: 30 },
      })

      // Success
      if (response.ok) {
        return await response.json() as T
      }

      lastResponse = response
      const status = response.status

      // Check if we should retry
      if (shouldRetry(status, attempt, opts.maxRetries, opts.retryOn429)) {
        const delay = getRetryDelay(response, attempt, opts.retryDelay)
        
        // Log rate limit for monitoring
        if (status === 429) {
          console.warn(
            `[Riot API] Rate limit hit (429) for ${url}. ` +
            `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries + 1})`
          )
        } else {
          console.warn(
            `[Riot API] Error ${status} for ${url}. ` +
            `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries + 1})`
          )
        }

        await sleep(delay)
        continue // Retry
      }

      // Non-retryable error or max retries reached
      const body = await response.text().catch(() => '')
      const errorMessage = status === 429
        ? `Rate limit exceeded. Please try again later.`
        : `Riot fetch failed ${status}: ${body.slice(0, 200)}`
      
      throw new Error(errorMessage)

    } catch (error) {
      lastError = error as Error
      
      // If it's our own error (non-retryable), throw it
      if (error instanceof Error && !error.message.includes('fetch')) {
        throw error
      }

      // Network errors or other fetch errors - retry if we have attempts left
      if (attempt < opts.maxRetries) {
        const delay = opts.retryDelay * Math.pow(2, attempt)
        console.warn(
          `[Riot API] Network error for ${url}. ` +
          `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries + 1})`
        )
        await sleep(delay)
        continue
      }

      // Max retries reached
      throw error
    }
  }

  // Should never reach here, but TypeScript needs it
  if (lastResponse) {
    const body = await lastResponse.text().catch(() => '')
    throw new Error(`Riot fetch failed after ${opts.maxRetries + 1} attempts: ${body.slice(0, 200)}`)
  }
  
  throw lastError || new Error('Unknown error in riotFetchWithRetry')
}
