/**
 * Google Gemini AI utility for VidFetch.
 *
 * Key resolution order:
 *   1. the key saved in the Ayarlar tab (Ayarlar → Yapay zeka), stored on the
 *      device — this is what almost every user has, because it means NO build
 *      step and no .env edit;
 *   2. the VITE_GOOGLE_API_KEY env var, kept as a fallback for anyone who
 *      prefers baking the key into the bundle.
 *
 * All calls are client-side — the key only ever goes to Google, from the
 * device. Acceptable for a personal-use Capacitor app with no accounts.
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { loadSettings } from "@/lib/app-settings";

const ENV_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;

/** The effective Gemini key: saved setting first, env var second. */
export function getGeminiKey(): string {
  const saved = loadSettings().geminiKey;
  if (saved) return saved;
  return typeof ENV_KEY === "string" ? ENV_KEY.trim() : "";
}

let cachedModel: GenerativeModel | null = null;
let cachedKey = "";

/**
 * Lazily initialise the Gemini model.
 * Returns null when the API key is missing so callers can degrade gracefully.
 * The model is cached per key, so pasting a new key in Ayarlar takes effect
 * immediately instead of keeping the old client.
 */
export function getModel(): GenerativeModel | null {
  const key = getGeminiKey();
  if (!key) return null;
  if (cachedModel && cachedKey === key) return cachedModel;

  const genAI = new GoogleGenerativeAI(key);
  cachedKey = key;
  cachedModel = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: `You are VidFetch AI, a helpful assistant inside the VidFetch video downloader app.
You answer questions in the same language the user writes in (Turkish or English).
You specialise in: video downloading tips, supported platforms, format selection (MP4 vs MP3),
troubleshooting download errors, and general media advice.
Keep answers concise (2-4 sentences) unless the user asks for detail.
Do not fabricate URLs or file paths.`,
  });
  return cachedModel;
}

/** Is the Gemini API key configured? */
export function isGeminiAvailable(): boolean {
  return getGeminiKey().length > 0;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

/**
 * Send a chat message and stream the response token-by-token.
 * Returns an async generator of text chunks.
 */
export async function* streamChat(
  history: ChatMessage[],
  newMessage: string,
): AsyncGenerator<string> {
  const model = getModel();
  if (!model) throw new Error("Gemini API key not configured");

  const chat = model.startChat({
    history: history.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    })),
  });

  const result = await chat.sendMessageStream(newMessage);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

/**
 * Non-streaming single-shot request (for quick one-off queries).
 */
export async function askGemini(
  history: ChatMessage[],
  newMessage: string,
): Promise<string> {
  const model = getModel();
  if (!model) throw new Error("Gemini API key not configured");

  const chat = model.startChat({
    history: history.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    })),
  });

  const result = await chat.sendMessage(newMessage);
  return result.response.text();
}
