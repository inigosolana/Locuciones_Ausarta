// app/api/converter/route.ts
import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { writeFile, readFile, unlink, access, chmod } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import ffmpegStatic from "ffmpeg-static"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function resolveFfmpegPath(): Promise<string> {
  // 1) prioriza env var (Vercel)
  const fromEnv = process.env.FFMPEG_PATH
  if (fromEnv) {
    await access(fromEnv).catch(() => { throw new Error(`FFMPEG_PATH apunta a ruta inexistente: ${fromEnv}`) })
    try { await chmod(fromEnv, 0o755) } catch {}
    return fromEnv
  }
  // 2) fallback a ffmpeg-static
  const fromStatic = (ffmpegStatic as unknown as string) || ""
  if (!fromStatic) throw new Error("No se pudo resolver FFmpeg. Define FFMPEG_PATH o instala ffmpeg-static.")
  await access(fromStatic).catch(() => { throw new Error(`ffmpeg-static no disponible en runtime: ${fromStatic}`) })
  try { await chmod(fromStatic, 0o755) } catch {}
  return fromStatic
}

function run(cmd: string, args: string[], killAfterMs = 45000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, ["-hide_banner", "-loglevel", "error", ...args])
    let stderr = ""
    let killed = false
    const timer = setTimeout(() => { killed = true; p.kill("SIGKILL") }, killAfterMs)
    p.stderr.on("data", (d) => (stderr += d.toString()))
    p.on("error", (err) => { clearTimeout(timer); reject(err) })
    p.on("close", (code) => {
      clearTimeout(timer)
      if (killed) return reject(new Error("Timeout: la conversión tardó demasiado y fue cancelada."))
      resolve({ code: code ?? -1, stderr })
    })
  })
}

function safeBaseName(name: string) {
  return (name || "audio").replace(/\.[^.]+$/, "").replace(/[^\w\-.]+/g, "_").slice(0, 80) || "audio"
}

export async function POST(req: Request) {
  let tmpIn = ""
  let tmpOut = ""
  try {
    const ff = await resolveFfmpegPath()

    const form = await req.formData()
    const file = form.get("audio") as unknown as File | null
    if (!file) return NextResponse.json({ error: "Falta 'audio' en form-data" }, { status: 400 })

    const origName = (file.name || "audio").trim()
    const ext = (origName.split(".").pop() || "").toLowerCase()
    const baseRaw = (form.get("baseName") as string) || origName || "audio"
    const base = safeBaseName(baseRaw)

    const arrayBuf = await file.arrayBuffer()
    if (arrayBuf.byteLength === 0) return NextResponse.json({ error: "El archivo está vacío (0 bytes)" }, { status: 400 })

    tmpIn = path.join(os.tmpdir(), `in_${Date.now()}.${ext || "bin"}`)
    tmpOut = path.join(os.tmpdir(), `out_${Date.now()}.wav`)
    await writeFile(tmpIn, Buffer.from(arrayBuf))

    // 1º intento: conversión estándar (sirve para la mayoría: MP3, OPUS, OGG, M4A, etc.)
    let conv = await run(
      ff,
      ["-y", "-i", tmpIn, "-vn", "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", tmpOut],
      45000
    )

    // Si falló, 2º intento con mapeo explícito de la primera pista de audio
    if (conv.code !== 0) {
      conv = await run(
        ff,
        ["-y", "-i", tmpIn, "-vn", "-map", "0:a:0?", "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", tmpOut],
        45000
      )
      if (conv.code !== 0) {
        throw new Error(`FFmpeg no pudo convertir el archivo: ${conv.stderr || "error desconocido"}`)
      }
    }

    const wav = await readFile(tmpOut)
    const downloadName = `${base}_8kHz_mono_16bit.wav`

    return new NextResponse(wav, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Error al convertir" }, { status: 500 })
  } finally {
    if (tmpIn) unlink(tmpIn).catch(() => {})
    if (tmpOut) unlink(tmpOut).catch(() => {})
  }
}
