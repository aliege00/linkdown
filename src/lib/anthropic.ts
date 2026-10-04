/**
 * Anthropic (Claude) AI client — plain fetch, no SDK.
 *
 * VidFetch already bundles @google/generative-ai for Gemini; adding the
 * Anthropic SDK as well would mean a second, much larger dependency for what
 * is one HTTP endpoint. The Messages API is a plain POST + SSE stream, so it
 * is implemented directly here with the SAME public surface as gemini.ts
 * (`isAnthropicAvailable`, `streamChat`), which is what lets src/lib/ai.ts
 * pick a provider without either UI knowing which one answered.
 *
 * The key comes from the Ayarlar tab (stored on the device). The model name
 * can be overridden at build time via VITE_ANTHROPIC_MODEL.
 */

import { loadSettings } from "@/lib/app-settings";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-haiku-latest";

export interface AnthropicMessage {
  role: "user" | "assistant";
  text: string;
}

const SYSTEM_PROMPT = `You are VidFetch AI, a helpful assistant inside the VidFetch video downloader app.
You answer questions in the same language the user writes in (Turkish or English).
You specialise in: video downloading tips, supported platforms, format selection (MP4 vs MP3),
troubleshooting download errors, and general media advice.
Keep answers concise (2-4 sentences) unless the user asks for detail.
Do not fabricate URLs or file paths.`;

/** The saved Anthropic key, or "" when the user has not set one. */
export function getAnthropicKey(): string {
  return loadSettings().anthropicKey;
}

/** Is an Anthropic key configured? */
export function isAnthropicAvailable(): boolean {
  return getAnthropicKey().length > 0;
}

/**
 * Convert the app's chat history into Anthropic's alternating user/assistant
 * shape. The API rejects two messages of the same role in a row, so runs are
 * merged and a leading assistant message is dropped.
 */
export function toAnthropicHistory(
  history: { role: "user" | "model"; text: string }[],
  newMessage: string,
): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage["role"], text: string) => {
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.text += `\n${text}`;
    else merged.push({ role, text });
  };

  for (const m of history) {
    if (!m.text) continue;
    push(m.role === "model" ? "assistant" : "user", m.text);
  }
  if (newMessage) push("user", newMessage);
  while (merged.length > 0 && merged[0].role === "assistant") merged.shift();
  return merged;
}

/**
 * Stream a Claude reply token-by-token, mirroring gemini.ts's generator.
 * Throws the same "API key not configured" error when no key is set.
 */
export async function* streamChat(
  history: { role: "user" | "model"; text: string }[],
  newMessage: string,
): AsyncGenerator<string> {
  const key = getAnthropicKey();
  if (!key) throw new Error("Anthropic API key not configured");

  const model =
    (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined)?.trim() ||
    DEFAULT_MODEL;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: toAnthropicHistory(history, newMessage),
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Anthropic isteği başarısız (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep the last partial frame.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield event.delta.text;
          }
        } catch {
          // A partial JSON frame is not fatal: the next one carries the rest.
        }
      }
    }
  }
}