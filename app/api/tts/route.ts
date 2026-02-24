// app/api/tts/route.ts
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "edge"

// Voces fijas
const VOICES: Record<
  | "chica"
  | "chico"
  | "ausarta"
  | "euskera_chico"
  | "euskera_chica"
  | "gallego_chico"
  | "gallego_chica"
  | "ingles_chica"
  | "ingles_chico"
  | "mexicano",
  string
> = {
  chica: "a2f12ebd-80df-4de7-83f3-809599135b1d",
  chico: "3380a516-6acc-4389-97c8-68273b540dd3",
  ausarta: "44c5567b-1b68-4873-8231-4e7660f749ad",

  euskera_chico: "a62209c3-9f0a-4474-9b51-84b191593f49",
  euskera_chica: "99543693-cf6e-4e1d-9259-2e5cc9a0f76b",

  gallego_chico: "4679c1e3-1fd5-45c0-a3a6-7f6e21ef82e2",
  gallego_chica: "96eade6e-d863-4f9a-8b08-5d7b74d1643b",

  ingles_chica: "62ae83ad-4f6a-430b-af41-a9bede9286ca",
  ingles_chico: "0ad65e7f-006c-47cf-bd31-52279d487913",

  mexicano: "357a3291-faaa-4213-a586-2f18b736cec5",
}

type FormatId = "mp3" | "wav_yeastar"

function sanitizeFilename(name?: string, ext?: string) {
  const base = (name || "voz").replace(/[^\w\- ]+/g, "").trim() || "voz"
  return `${base}.${ext || "bin"}`
}

// ---------- Utils pausas ----------
// Parsea el texto buscando [pausa:Xs] y devuelve segmentos
interface Segment {
  type: "text" | "pause"
  value: string | number // texto o segundos
}

function parseTextWithPauses(text: string): Segment[] {
  const regex = /\[pausa:(\d+(?:\.\d+)?)\s*s?\]/gi
  const segments: Segment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Texto antes de la pausa
    if (match.index > lastIndex) {
      const t = text.slice(lastIndex, match.index).trim()
      if (t) segments.push({ type: "text", value: t })
    }
    // Pausa
    const seconds = Number.parseFloat(match[1])
    if (seconds > 0) segments.push({ type: "pause", value: seconds })
    lastIndex = regex.lastIndex
  }
  // Texto restante
  if (lastIndex < text.length) {
    const t = text.slice(lastIndex).trim()
    if (t) segments.push({ type: "text", value: t })
  }
  return segments.length ? segments : [{ type: "text", value: text }]
}

// Genera silencio PCM 16-bit para una duración dada
function generateSilence(seconds: number, sampleRate: number): Int16Array {
  const numSamples = Math.floor(seconds * sampleRate)
  return new Int16Array(numSamples) // Ya inicializado a 0
}

// Concatena múltiples Int16Array
function concatInt16Arrays(arrays: Int16Array[]): Int16Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Int16Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ---------- Utils WAV/PCM ----------
function int16ToWav(int16: Int16Array, sampleRate = 8000, channels = 1): ArrayBuffer {
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = int16.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let o = 0

  const wS = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i))
  }
  const w32 = (v: number) => {
    view.setUint32(o, v, true)
    o += 4
  }
  const w16 = (v: number) => {
    view.setUint16(o, v, true)
    o += 2
  }

  wS("RIFF")
  w32(36 + dataSize)
  wS("WAVE")
  wS("fmt ")
  w32(16)
  w16(1)
  w16(channels)
  w32(sampleRate)
  w32(byteRate)
  w16(blockAlign)
  w16(16)
  wS("data")
  w32(dataSize)

  new Int16Array(buffer, 44).set(int16)
  return buffer
}

function wavToPCM(wavBuf: ArrayBuffer): { sampleRate: number; s16: Int16Array } {
  const v = new DataView(wavBuf)
  const str = (p: number) =>
    String.fromCharCode(
      v.getUint8(p),
      v.getUint8(p + 1),
      v.getUint8(p + 2),
      v.getUint8(p + 3),
    )

  if (str(0) !== "RIFF" || str(8) !== "WAVE") throw new Error("WAV inválido")

  let ofs = 12
  let fmt = 1
  let channels = 1
  let sampleRate = 8000
  let bps = 16
  let dataOfs = -1
  let dataSize = 0

  while (ofs + 8 <= v.byteLength) {
    const id = str(ofs)
    const size = v.getUint32(ofs + 4, true)
    const next = ofs + 8 + size
    if (id === "fmt ") {
      fmt = v.getUint16(ofs + 8, true)
      channels = v.getUint16(ofs + 10, true)
      sampleRate = v.getUint32(ofs + 12, true)
      bps = v.getUint16(ofs + 22, true)
    } else if (id === "data") {
      dataOfs = ofs + 8
      dataSize = size
      break
    }
    ofs = next
  }
  if (dataOfs < 0) throw new Error("Chunk data no encontrado")

  const bytes = new Uint8Array(wavBuf, dataOfs, dataSize)

  function deinterleaveL<T extends Int16Array | Float32Array>(arr: T): T {
    if (channels === 1) return arr
    const out = new (arr.constructor as any)(Math.floor(arr.length / channels))
    for (let i = 0, j = 0; i < arr.length; i += channels) (out as any)[j++] = (arr as any)[i]
    return out
  }

  if (fmt === 1 && bps === 16) {
    const all = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    return { sampleRate, s16: deinterleaveL(all) as Int16Array }
  }

  if (fmt === 3 && bps === 32) {
    const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4))
    const monoF32 = deinterleaveL(f32 as any) as Float32Array
    const out = new Int16Array(monoF32.length)
    for (let i = 0; i < monoF32.length; i++) {
      const x = Math.max(-1, Math.min(1, monoF32[i]))
      out[i] = Math.round(x * 32767)
    }
    return { sampleRate, s16: out }
  }

  throw new Error(`Formato WAV no soportado: fmt=${fmt} bits=${bps}`)
}

// Error helper
async function httpErrorJson(res: Response, provider: "OpenAI" | "Cartesia") {
  let text = ""
  try {
    text = await res.text()
  } catch {}
  return NextResponse.json(
    { error: `${provider} ${res.status} ${res.statusText}`, details: text?.slice(0, 4000) },
    { status: 502 },
  )
}

function clampSpeed(raw: unknown, min: number, max: number, def = 1.0) {
  let s = typeof raw === "number" && !Number.isNaN(raw) ? raw : def
  if (s < min) s = min
  if (s > max) s = max
  return s
}

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, voice, format, filename, speed } = body as {
      text?: string
      voice?:
        | "chica"
        | "chico"
        | "ausarta"
        | "euskera_chico"
        | "euskera_chica"
        | "gallego_chico"
        | "gallego_chica"
        | "ingles_chica"
        | "ingles_chico"
        | "mexicano"
      format?: FormatId
      filename?: string
      speed?: number
    }

    if (!text) return NextResponse.json({ error: "Falta 'text'" }, { status: 400 })
    if (!voice || !VOICES[voice])
      return NextResponse.json(
        { error: "Voz inválida" },
        { status: 400 },
      )

    const fmt: FormatId = format === "wav_yeastar" ? "wav_yeastar" : "mp3"

    const isOpenAI = false // All voices now use Cartesia

    const isCartesia =
      voice === "chica" ||
      voice === "chico" ||
      voice === "ausarta" ||
      voice === "mexicano" ||
      voice === "euskera_chico" ||
      voice === "euskera_chica" ||
      voice === "gallego_chico" ||
      voice === "gallego_chica" ||
      voice === "ingles_chica" ||
      voice === "ingles_chico"

    // Parsear texto para detectar pausas
    const segments = parseTextWithPauses(text)
    const hasPauses = segments.some((s) => s.type === "pause")

    // -------------------------------
    // OPENAI (solo inglés)
    // -------------------------------
    if (isOpenAI) {
      const openaiKey = process.env.OPENAI_API_KEY
      if (!openaiKey) return NextResponse.json({ error: "Falta OPENAI_API_KEY" }, { status: 500 })

      const openaiVoice = VOICES[voice]
      const model = "tts-1"
      const ttsSpeed = clampSpeed(speed, 0.25, 4.0, 1.0)

      // MP3 sin pausas (simple)
      if (fmt === "mp3" && !hasPauses) {
        const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            voice: openaiVoice,
            input: text,
            format: "mp3",
            speed: ttsSpeed,
          }),
        })
        if (!ttsRes.ok) return httpErrorJson(ttsRes, "OpenAI")

        const buf = await ttsRes.arrayBuffer()
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": `attachment; filename=${sanitizeFilename(filename, "mp3")}`,
            "Cache-Control": "no-store",
          },
        })
      }

      // MP3 con pausas - generar como WAV, concatenar, y devolver como WAV (no se puede MP3 con pausas fácilmente)
      if (fmt === "mp3" && hasPauses) {
        const audioChunks: Int16Array[] = []
        const sampleRate = 8000

        for (const seg of segments) {
          if (seg.type === "pause") {
            audioChunks.push(generateSilence(seg.value as number, sampleRate))
          } else {
            const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
              method: "POST",
              headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                voice: openaiVoice,
                input: seg.value,
                format: "pcm",
                sample_rate: sampleRate,
                speed: ttsSpeed,
              }),
            })
            if (!ttsRes.ok) return httpErrorJson(ttsRes, "OpenAI")

            const raw = new Uint8Array(await ttsRes.arrayBuffer())
            audioChunks.push(new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2)))
          }
        }

        const combined = concatInt16Arrays(audioChunks)
        const outWav = int16ToWav(combined, sampleRate, 1)
        return new NextResponse(outWav, {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Disposition": `attachment; filename=${sanitizeFilename(filename, "wav")}`,
            "Cache-Control": "no-store",
          },
        })
      }

      // WAV YEASTAR (openai) - con o sin pausas
      const audioChunks: Int16Array[] = []
      const sampleRate = 8000

      for (const seg of segments) {
        if (seg.type === "pause") {
          audioChunks.push(generateSilence(seg.value as number, sampleRate))
        } else {
          let s16: Int16Array | null = null

          // Intentar WAV primero
          const wavRes = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              voice: openaiVoice,
              input: seg.value,
              format: "wav",
              sample_rate: sampleRate,
              speed: ttsSpeed,
            }),
          })

          if (wavRes.ok) {
            try {
              const parsed = wavToPCM(await wavRes.arrayBuffer())
              if (parsed.sampleRate === sampleRate) s16 = parsed.s16
            } catch {}
          }

          if (!s16) {
            const pcmRes = await fetch("https://api.openai.com/v1/audio/speech", {
              method: "POST",
              headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                voice: openaiVoice,
                input: seg.value,
                format: "pcm",
                sample_rate: sampleRate,
                speed: ttsSpeed,
              }),
            })
            if (!pcmRes.ok) return httpErrorJson(pcmRes, "OpenAI")

            const raw = new Uint8Array(await pcmRes.arrayBuffer())
            s16 = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
          }

          audioChunks.push(s16)
        }
      }

      const combined = concatInt16Arrays(audioChunks)
      const outWav = int16ToWav(combined, sampleRate, 1)
      return new NextResponse(outWav, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Disposition": `attachment; filename=${sanitizeFilename(filename, "wav")}`,
          "Cache-Control": "no-store",
        },
      })
    }

    // -------------------------------
    // CARTESIA (español, euskera, gallego, mexicano)
    // -------------------------------
    if (isCartesia) {
      const cartesiaKey = process.env.CARTESIA_API_KEY
      if (!cartesiaKey) return NextResponse.json({ error: "Falta CARTESIA_API_KEY" }, { status: 500 })

      const voiceId = VOICES[voice]

      // 🔹 Language: Asignar idioma según la voz
      // 🔹 Language: Asignar idioma según la voz
      let language: string | undefined = undefined
      const langParam = body.language 
      
      if (langParam === "ingles" || voice.includes("ingles")) {
        language = "en"
      } else {
        // Usamos fonética de "es" para Castellano, Euskera, Gallego y Mexicano.
        // Cartesia da error 400 si se envía "eu" o "gl".
        language = "es" 
      }
      // Helper para generar audio de un texto con Cartesia
      async function generateCartesiaAudio(inputText: string): Promise<Int16Array> {
        const body: any = {
          model_id: "sonic-3",
          transcript: inputText,
          voice: { mode: "id", id: voiceId },
          output_format: {
            container: "raw",
            encoding: "pcm_s16le",
            sample_rate: 24000,
          },
        }
        if (language) body.language = language

        const res = await fetch("https://api.cartesia.ai/tts/bytes", {
          method: "POST",
          headers: {
            "X-API-Key": cartesiaKey || "", // <<< AQUÍ ESTÁ EL CAMBIO
            "Cartesia-Version": "2024-11-13",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(`Cartesia ${res.status}: ${errText}`)
        }

        const raw = new Uint8Array(await res.arrayBuffer())
        const int16_24k = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
        
        // Downsample de 24k a 8k
        const int16_8k = new Int16Array(Math.floor(int16_24k.length / 3))
        for (let i = 0, j = 0; i < int16_24k.length; i += 3) int16_8k[j++] = int16_24k[i]
        
        return int16_8k
      }

      // MP3 sin pausas
      if (fmt === "mp3" && !hasPauses) {
        const baseBody: any = {
          model_id: "sonic-3",
          transcript: text,
          voice: { mode: "id", id: voiceId },
          output_format: {
            container: "mp3",
            encoding: "mp3",
            sample_rate: 44100,
          },
        }
        if (language) baseBody.language = language

        const resTts = await fetch("https://api.cartesia.ai/tts/bytes", {
          method: "POST",
          headers: {
            "X-API-Key": cartesiaKey || "", // <<< AQUÍ ESTÁ EL CAMBIO
            "Cartesia-Version": "2024-11-13",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(baseBody),
        })

        if (!resTts.ok) {
          const errText = await resTts.text().catch(() => "")
          console.error("CARTESIA RAW ERROR (mp3):", resTts.status, errText, baseBody)
          return NextResponse.json(
            {
              error: `Cartesia ${resTts.status} ${resTts.statusText}`,
              details: errText,
              sentBody: baseBody,
            },
            { status: 502 },
          )
        }

        const buf = await resTts.arrayBuffer()
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": `attachment; filename=${sanitizeFilename(filename, "mp3")}`,
            "Cache-Control": "no-store",
          },
        })
      }

      // MP3 con pausas o WAV
      const audioChunks: Int16Array[] = []
      const sampleRate = 8000

      for (const seg of segments) {
        if (seg.type === "pause") {
          audioChunks.push(generateSilence(seg.value as number, sampleRate))
        } else {
          try {
            const audio = await generateCartesiaAudio(seg.value as string)
            audioChunks.push(audio)
          } catch (err: any) {
            return NextResponse.json({ error: err.message }, { status: 502 })
          }
        }
      }

      const combined = concatInt16Arrays(audioChunks)
      const wav = int16ToWav(combined, sampleRate, 1)
      return new NextResponse(wav, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Disposition": `attachment; filename=${sanitizeFilename(filename, "wav")}`,
          "Cache-Control": "no-store",
        },
      })
    }

    return NextResponse.json({ error: "Configuración de voz no soportada" }, { status: 400 })
  } catch (err) {
    console.error("TTS error", err)
    return NextResponse.json({ error: "Error interno TTS" }, { status: 500 })
  }
}
