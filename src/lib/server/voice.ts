import "server-only";
import OpenAI from "openai";

/**
 * Voz de Alexia: transcripción de lo que dice la persona y lectura en voz alta de las
 * respuestas (API de OpenAI). Los modelos y la voz se pueden cambiar sin tocar código.
 */
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "coral";

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI());

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export async function transcribe(file: File) {
  const res = await getClient().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    language: "es",
    // Vocabulario de la plataforma para que no se equivoque con los términos propios
    prompt: "Plataforma de proyectos NPD de NATU Laboratories: reposiciones, P1, P2, cotización, arte final, etiqueta, estuche, brief, Marketing, Diseño, Calidad, Compras, Alexia.",
  });
  return res.text.trim();
}

/** Texto apto para leer en voz alta: sin markdown, enlaces ni emojis. */
export function speakable(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\n{2,}/g, ".\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 4000);
}

export async function speak(text: string) {
  const res = await getClient().audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: speakable(text),
    instructions: "Habla en español de España, con tono cercano, natural y algo de chispa, como una compañera de trabajo resolutiva. Ritmo ágil.",
    response_format: "mp3",
  });
  return res.arrayBuffer();
}
