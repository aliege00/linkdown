/**
 * Google Gemini AI utility for VidFetch.
 *
 * Uses the @google/generative-ai SDK with a VITE_GOOGLE_API_KEY env var.
 * All calls are client-side — the key is only exposed in the built bundle
 * (acceptable for a personal-use Capacitor app).
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;

let cachedModel: GenerativeModel | null = null;

/**
 * Lazily initialise the Gemini model.
 * Returns null when the API key is missing so callers can degrade gracefully.
 */
export function getModel(): GenerativeModel | null {
  if (!API_KEY) return null;
  if (cachedModel) return cachedModel;

  const genAI = new GoogleGenerativeAI(API_KEY);
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
  return typeof API_KEY === "string" && API_KEY.length > 0;
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
