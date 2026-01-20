import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { writeFile, readFile, unlink, access, chmod } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import ffmpegStatic from "ffmpeg-static"

// Configuración para Vercel (Serverless)
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function resolveFfmpegPath(): Promise<string> {
  // 1. Intentar usar variable de entorno (pero SIN romper si falla)
  const fromEnv = process.env.FFMPEG_PATH
  if (fromEnv) {
    try {
      await access(fromEnv)
      try { await chmod(fromEnv, 0o755) } catch {} // Dar permisos si es posible
      console.log(`[ffmpeg] Usando binario desde ENV: ${fromEnv}`)
      return fromEnv
    } catch (e) {
      console.warn(`[ffmpeg] FFMPEG_PATH definido (${fromEnv}) pero no accesible. Usando fallback...`)
    }
  }

  // 2. Fallback: Usar el binario interno de ffmpeg-static
  const fromStatic = (ffmpegStatic as unknown as string) || ""
  if (!fromStatic) {
    throw new Error("No se pudo encontrar la ruta de FFmpeg. Revisa next.config.mjs")
  }

  // Comprobar que existe de verdad
  try {
    await access(fromStatic)
    try { await chmod(fromStatic, 0o755) } catch {}
  } catch (e) {
    throw new Error(`El binario de ffmpeg-static no aparece en: ${fromStatic}. \nIMPORTANTE: Asegúrate de haber creado el archivo next.config.mjs con 'serverComponentsExternalPackages'`)
  }

  return fromStatic
}

function run(cmd: string, args: string[], timeoutMs = 45000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args)
    let stdout = ""
    let stderr = ""

    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, stdout, stderr: stderr + "\n[Timeout killed]" })
    }, timeoutMs)

    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + `\n[Error spawn: ${err.message}]` })
    })
  })
}

export async function POST(req: Request) {
  let tmpIn = ""
  let tmpOut = ""

  try {
    const formData = await req.formData()
    const file = formData.get("audio") as File | null
    const baseName = (formData.get("baseName") as string) || "audio_converted"

    if (!file) {
      return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 })
    }

    // AQUI OCURRE LA MAGIA: Buscamos ffmpeg de forma segura
    const ff = await resolveFfmpegPath()

    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    
    // Rutas temporales
    const ext = file.name ? path.extname(file.name).replace(".", "") : "bin"
    tmpIn = path.join(os.tmpdir(), `in_${Date.now()}.${ext}`)
    tmpOut = path.join(os.tmpdir(), `out_${Date.now()}.wav`)

    await writeFile(tmpIn, buffer)

    // Conversión (Yeastar compatible: 8kHz, Mono, 16bit)
    // 1. Intento normal
    let result = await run(ff, [
      "-y", "-i", tmpIn, 
      "-vn", // sin video
      "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", 
      tmpOut
    ])

    // 2. Si falla, intentar mapeo forzado (para audios raros de WhatsApp/Opus)
    if (result.code !== 0) {
      console.log("Reintentando conversión con mapeo...", result.stderr)
      result = await run(ff, [
        "-y", "-i", tmpIn, 
        "-vn", "-map", "0:a:0?", // fuerza primer canal de audio
        "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", 
        tmpOut
      ])
      
      if (result.code !== 0) {
        throw new Error(`Error FFmpeg: ${result.stderr}`)
      }
    }

    const wavBuffer = await readFile(tmpOut)

    // Limpieza
    await Promise.all([unlink(tmpIn).catch(()=>{}), unlink(tmpOut).catch(()=>{} )])

    return new NextResponse(wavBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="${baseName}.wav"`,
        "Content-Length": wavBuffer.length.toString(),
      },
    })

  } catch (error: any) {
    console.error("[Converter Error]", error)
    if (tmpIn) await unlink(tmpIn).catch(() => {})
    if (tmpOut) await unlink(tmpOut).catch(() => {})
    
    return NextResponse.json(
      { error: error.message || "Error al convertir" },
      { status: 500 }
    )
  }
}
