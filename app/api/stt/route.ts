import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**<option value="ingles">Inglés</option>
 * ENV necesarias:
 *  - OPENAI_API_KEY
 *  - (si tu clave empieza por sk-proj-...) OPENAI_PROJECT_ID = proj_xxxxx
 *
 * Recibe multipart/form-data con:
 *  - audio (File/Blob)
 *  - filename (opcional)
 *  - engine (opcional: whisper-1 | gpt-4o-mini-transcribe)
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const project = process.env.OPENAI_PROJECT_ID;

    if (!apiKey) return jerr(500, "❌ Falta OPENAI_API_KEY");
    if (apiKey.startsWith("sk-proj") && !project) {
      return jerr(500, "❌ Falta OPENAI_PROJECT_ID para key sk-proj-…");
    }

    const form = await req.formData().catch(() => null);
    if (!form) return jerr(400, "❌ Debe ser multipart/form-data");

    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return jerr(400, "❌ Falta archivo 'audio'");

    const filename = (form.get("filename") as string) || "audio_input";
    const engine = (form.get("engine") as string) || "whisper-1";
    const type =
      (audio as any).type || guessMimeFromName(filename) || "application/octet-stream";

    const file = new File([audio], filename, { type });

    const fd = new FormData();
    fd.append("file", file, filename);
    fd.append("model", engine);  // whisper-1 | gpt-4o-mini-transcribe
    fd.append("language", "es");

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (project) headers["OpenAI-Project"] = project;

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers,
      body: fd,
    });

    const raw = await r.text();
    if (!r.ok) return jerr(r.status, "❌ Error transcribiendo", tryJSON(raw) ?? raw);

    const data = tryJSON(raw) ?? { text: raw };
    return json({ text: data.text || "" });
  } catch (e: any) {
    return jerr(500, "❌ Fallo STT", e?.message || "Error desconocido");
  }
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function jerr(status: number, error: string, detail?: any) {
  return json({ error, status, detail }, status);
}
function tryJSON(s: string) { try { return JSON.parse(s); } catch { return null; } }
function guessMimeFromName(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".m4a")) return "audio/m4a";
  if (n.endsWith(".webm")) return "audio/webm";
  if (n.endsWith(".mp4")) return "video/mp4";
  return null;
}
