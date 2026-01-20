import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { writeFile, readFile, unlink, access, chmod } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Importamos ambas librerías para tener un "Plan B"
import ffmpegStatic from "ffmpeg-static"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function resolveFfmpegPath(): Promise<string> {
  // 1. INTENTO: Variable de entorno (si la definiste en Vercel)
  if (process.env.FFMPEG_PATH) {
    try {
      await access(process.env.FFMPEG_PATH)
      console.log("[ffmpeg] Usando FFMPEG_PATH del entorno")
      return process.env.FFMPEG_PATH
    } catch {
      console.warn("[ffmpeg] FFMPEG_PATH definido pero no accesible. Probando alternativas...")
    }
  }

  // 2. INTENTO: @ffmpeg-installer/ffmpeg (Suele ser más robusto en Vercel/Linux)
  try {
    const installerPath = ffmpegInstaller.path
    if (installerPath) {
      await access(installerPath)
      await chmod(installerPath, 0o755).catch(() => {}) // Asegurar ejecución
      console.log("[ffmpeg] Usando @ffmpeg-installer")
      return installerPath
    }
  } catch (e) {
    console.log("[ffmpeg] @ffmpeg-installer no disponible, probando ffmpeg-static...")
  }

  // 3. INTENTO: ffmpeg-static (Tu configuración original)
  try {
    const staticPath = (ffmpegStatic as unknown as string)
    if (staticPath) {
      await access(staticPath)
      await chmod(staticPath, 0o755).catch(() => {})
      console.log("[ffmpeg] Usando ffmpeg-static")
      return staticPath
    }
  } catch (e) {
    console.error("[ffmpeg] Error verificando ffmpeg-static:", e)
  }

  throw new Error(
    "FATAL: No se encontró ningún binario de FFmpeg ejecutable.\n" +
    "Revisa que 'serverExternalPackages' esté configurado en next.config.mjs"
  )
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

    // Buscamos el binario de forma segura
    const ff = await resolveFfmpegPath()

    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    
    // Nombres únicos para evitar colisiones
    const uniqueId = Date.now() + Math.random().toString(36).slice(2, 5)
    const ext = file.name ? path.extname(file.name).replace(".", "") : "bin"
    tmpIn = path.join(os.tmpdir(), `in_${uniqueId}.${ext}`)
    tmpOut = path.join(os.tmpdir(), `out_${uniqueId}.wav`)

    await writeFile(tmpIn, buffer)

    // Conversión (Yeastar compatible: 8kHz, Mono, 16bit)
    // 1. Intento normal
    let result = await run(ff, [
      "-y", "-i", tmpIn, 
      "-vn",
      "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", 
      tmpOut
    ])

    // 2. Si falla, intentar mapeo forzado (útil para audios de WhatsApp/Opus corruptos)
    if (result.code !== 0) {
      console.log("Reintentando conversión con mapeo...", result.stderr)
      result = await run(ff, [
        "-y", "-i", tmpIn, 
        "-vn", "-map", "0:a:0?",
        "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", 
        tmpOut
      ])
      
      if (result.code !== 0) {
        throw new Error(`Error FFmpeg: ${result.stderr}`)
      }
    }

    const wavBuffer = await readFile(tmpOut)

    // Limpieza asíncrona (no bloqueante)
    Promise.all([unlink(tmpIn).catch(()=>{}), unlink(tmpOut).catch(()=>{} )])

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
