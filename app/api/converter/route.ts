import { NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { writeFile, readFile, unlink, access, chmod } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import ffmpegStatic from "ffmpeg-static"

// Configuración para Vercel/Next.js
export const runtime = "nodejs" // Necesario para ejecutar binarios
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function resolveFfmpegPath(): Promise<string> {
  // 1) Intentar usar la variable de entorno FFMPEG_PATH si existe
  const fromEnv = process.env.FFMPEG_PATH
  if (fromEnv) {
    try {
      await access(fromEnv)
      // Si llegamos aquí, el archivo existe
      try { await chmod(fromEnv, 0o755) } catch {}
      console.log(`[ffmpeg] Usando binario desde ENV: ${fromEnv}`)
      return fromEnv
    } catch (e) {
      // Si falla, solo avisamos y seguimos con el fallback
      console.warn(`[ffmpeg] FFMPEG_PATH estaba definido (${fromEnv}) pero no es accesible. Intentando fallback...`)
    }
  }

  // 2) Fallback: usar la ruta que nos da la librería ffmpeg-static
  const fromStatic = (ffmpegStatic as unknown as string) || ""
  if (!fromStatic) {
    throw new Error("No se pudo resolver la ruta de FFmpeg. Asegúrate de tener 'ffmpeg-static' instalado.")
  }

  // Verificar que el binario de la librería exista realmente
  await access(fromStatic).catch(() => {
    throw new Error(
      `El binario de ffmpeg-static no se encuentra en: ${fromStatic}. \n` +
      `Si estás en Vercel, asegúrate de añadir 'ffmpeg-static' a 'serverComponentsExternalPackages' en next.config.mjs`
    )
  })

  try { await chmod(fromStatic, 0o755) } catch {}
  return fromStatic
}

// Función auxiliar para ejecutar comandos de consola (FFmpeg)
function run(cmd: string, args: string[], timeoutMs = 45000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args)
    let stdout = ""
    let stderr = ""

    // Timeout de seguridad
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, stdout, stderr: stderr + "\n[Timeout process killed]" })
    }, timeoutMs)

    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })

    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + `\n[Spawn Error: ${err.message}]` })
    })
  })
}

export async function POST(req: Request) {
  let tmpIn = ""
  let tmpOut = ""

  try {
    // 1. Obtener el archivo del FormData
    const formData = await req.formData()
    const file = formData.get("audio") as File | null
    const baseName = (formData.get("baseName") as string) || "audio_converted"

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "No se recibió ningún archivo de audio válido" }, { status: 400 })
    }

    // 2. Resolver ruta de FFmpeg (con reintento robusto)
    const ff = await resolveFfmpegPath()

    // 3. Guardar archivo temporalmente
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    if (buffer.length === 0) {
      return NextResponse.json({ error: "El archivo está vacío (0 bytes)" }, { status: 400 })
    }

    // Identificar extensión o usar .bin por defecto
    const originalName = file.name || ""
    const ext = path.extname(originalName).replace(".", "") || "bin"

    tmpIn = path.join(os.tmpdir(), `in_${Date.now()}.${ext}`)
    tmpOut = path.join(os.tmpdir(), `out_${Date.now()}.wav`)

    await writeFile(tmpIn, buffer)

    // 4. Ejecutar conversión
    // 1º intento: conversión estándar
    // Parámetros para Yeastar/3CX: 8kHz, Mono, 16-bit PCM (pcm_s16le)
    let conv = await run(
      ff,
      ["-y", "-i", tmpIn, "-vn", "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", tmpOut],
      50000
    )

    // Si falló (ej: archivo WhatsApp con metadata compleja), 2º intento mapeando stream de audio
    if (conv.code !== 0) {
      console.log("Primer intento fallido, reintentando con mapeo explícito...", conv.stderr)
      conv = await run(
        ff,
        ["-y", "-i", tmpIn, "-vn", "-map", "0:a:0?", "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", tmpOut],
        50000
      )
      if (conv.code !== 0) {
        throw new Error(`FFmpeg error:\n${conv.stderr || "Error desconocido al convertir"}`)
      }
    }

    // 5. Leer el resultado y devolverlo
    const wavBuffer = await readFile(tmpOut)
    
    // Limpieza
    await Promise.all([
        unlink(tmpIn).catch(() => {}), 
        unlink(tmpOut).catch(() => {})
    ])

    return new NextResponse(wavBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="${baseName}.wav"`,
        "Content-Length": wavBuffer.length.toString(),
      },
    })

  } catch (error: any) {
    console.error("[Converter Error]", error)
    // Intentar limpiar ficheros en caso de error
    if (tmpIn) await unlink(tmpIn).catch(() => {})
    if (tmpOut) await unlink(tmpOut).catch(() => {})

    return NextResponse.json(
      { error: error.message || "Error interno del servidor al convertir" },
      { status: 500 }
    )
  }
}
