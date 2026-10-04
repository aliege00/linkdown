/**
 * AI provider dispatch.
 *
 * The user can paste EITHER a Google AI Studio key (Gemini) or an Anthropic
 * console key (Claude) in Ayarlar → Yapay zeka. Both chat UIs import from
 * here instead of talking to a specific vendor, so they keep working no
 * matter which key is present and neither UI grows vendor-specific code.
 *
 * Gemini wins when both are configured (it is the free tier); a user who only
 * filled in Claude still gets a working assistant with no further setup.
 */

import {
  isGeminiAvailable,
  streamChat as geminiStreamChat,
  type ChatMessage,
} from "@/lib/gemini";
import { isAnthropicAvailable, streamChat as anthropicStreamChat } from "@/lib/anthropic";

export type { ChatMessage };
export type AiProvider = "gemini" | "anthropic";

/** Which provider will answer right now, or null when no key is set. */
export function activeProvider(): AiProvider | null {
  if (isGeminiAvailable()) return "gemini";
  if (isAnthropicAvailable()) return "anthropic";
  return null;
}

/** Is any AI provider usable? */
export function isAiAvailable(): boolean {
  return activeProvider() !== null;
}

/** Human-readable provider name for the UI. */
export function providerLabel(provider: AiProvider): string {
  return provider === "gemini" ? "Gemini" : "Claude";
}

/** Stream the assistant reply from whichever provider is configured. */
export async function* streamChat(
  history: ChatMessage[],
  newMessage: string,
): AsyncGenerator<string> {
  const provider = activeProvider();
  if (provider === "gemini") {
    yield* geminiStreamChat(history, newMessage);
    return;
  }
  if (provider === "anthropic") {
    yield* anthropicStreamChat(history, newMessage);
    return;
  }
  // Both chat UIs look for "API key" in the message to show the
  // "go to Ayarlar" hint instead of a raw error.
  throw new Error("API key not configured");
}