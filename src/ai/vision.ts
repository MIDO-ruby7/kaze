/**
 * AI Vision assertion — uses Claude claude-sonnet-4-6 to verify
 * that a screenshot matches a natural language description.
 *
 * Requires ANTHROPIC_API_KEY env variable.
 */

export interface VisionAssertResult {
  pass: boolean
  confidence: number  // 0-1
  reason: string
}

export async function assertScreenshotMatches(
  screenshot: Buffer,
  description: string,
  opts?: { strict?: boolean }
): Promise<VisionAssertResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for AI vision assertions. ' +
      'Set it via: export ANTHROPIC_API_KEY=your-key'
    )
  }

  const base64 = screenshot.toString("base64")

  const prompt = `You are a UI testing assistant. Examine this screenshot and determine if it matches the following description:

"${description}"

Respond with ONLY valid JSON in this format:
{
  "pass": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "Brief explanation of why it passes or fails"
}

Be strict about semantic correctness but lenient about minor style differences.
${opts?.strict ? 'In strict mode: all elements mentioned must be exactly present.' : ''}`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: base64 },
          },
          { type: "text", text: prompt },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error: ${response.status} ${err}`)
  }

  const data = await response.json() as { content: Array<{ text: string }> }
  const text = data.content[0]?.text ?? "{}"

  try {
    return JSON.parse(text) as VisionAssertResult
  } catch {
    return { pass: false, confidence: 0, reason: `Could not parse AI response: ${text}` }
  }
}
