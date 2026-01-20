import { type NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll("files") as File[]

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 })
    }

    console.log("[v0] Merging", files.length, "audio files")

    const firstFileName = files[0].name.toLowerCase()
    const isMP3 = firstFileName.endsWith(".mp3")
    const isWAV = firstFileName.endsWith(".wav")

    if (!isMP3 && !isWAV) {
      return NextResponse.json({ error: "Only WAV and MP3 files are supported" }, { status: 400 })
    }

    for (let i = 1; i < files.length; i++) {
      const fileName = files[i].name.toLowerCase()
      const fileIsMP3 = fileName.endsWith(".mp3")
      const fileIsWAV = fileName.endsWith(".wav")

      if ((isMP3 && !fileIsMP3) || (isWAV && !fileIsWAV)) {
        return NextResponse.json(
          {
            error: `Todos los archivos deben ser del mismo formato. El archivo "${files[i].name}" no coincide con el formato de los demás.`,
          },
          { status: 400 },
        )
      }
    }

    if (isMP3) {
      // For MP3 files, we simply concatenate them
      const mp3Buffers: Uint8Array[] = []
      for (const file of files) {
        const buffer = await file.arrayBuffer()
        mp3Buffers.push(new Uint8Array(buffer))
      }

      // Calculate total size
      const totalSize = mp3Buffers.reduce((sum, arr) => sum + arr.length, 0)
      const mergedMP3 = new Uint8Array(totalSize)
      let offset = 0

      for (const mp3Data of mp3Buffers) {
        mergedMP3.set(mp3Data, offset)
        offset += mp3Data.length
      }

      console.log("[v0] Merged MP3 audio: total size =", totalSize, "bytes")

      return new NextResponse(mergedMP3, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": 'attachment; filename="merged_audio.mp3"',
        },
      })
    }

    // Handle WAV merging
    // Read all audio files as ArrayBuffers
    const audioBuffers: ArrayBuffer[] = []
    for (const file of files) {
      const buffer = await file.arrayBuffer()
      audioBuffers.push(buffer)
    }

    // Parse WAV files and extract PCM data
    const pcmDataArrays: Int16Array[] = []
    let sampleRate = 8000
    let channels = 1

    for (let i = 0; i < audioBuffers.length; i++) {
      const buffer = audioBuffers[i]
      const view = new DataView(buffer)

      // Read WAV header
      // Check for "RIFF" at offset 0
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
      if (riff !== "RIFF") {
        return NextResponse.json({ error: `El archivo ${i + 1} no es un archivo WAV válido` }, { status: 400 })
      }

      // Read sample rate at offset 24
      const fileSampleRate = view.getUint32(24, true)
      // Read channels at offset 22
      const fileChannels = view.getUint16(22, true)

      if (i === 0) {
        sampleRate = fileSampleRate
        channels = fileChannels
      } else if (fileSampleRate !== sampleRate || fileChannels !== channels) {
        return NextResponse.json(
          {
            error: `Todos los archivos deben tener el mismo formato. El archivo ${i + 1} tiene diferente frecuencia de muestreo o canales.`,
          },
          { status: 400 },
        )
      }

      // Find "data" chunk
      let dataOffset = 12
      while (dataOffset < buffer.byteLength) {
        const chunkId = String.fromCharCode(
          view.getUint8(dataOffset),
          view.getUint8(dataOffset + 1),
          view.getUint8(dataOffset + 2),
          view.getUint8(dataOffset + 3),
        )
        const chunkSize = view.getUint32(dataOffset + 4, true)

        if (chunkId === "data") {
          // Extract PCM data
          const pcmData = new Int16Array(buffer, dataOffset + 8, chunkSize / 2)
          pcmDataArrays.push(pcmData)
          break
        }

        dataOffset += 8 + chunkSize
      }
    }

    // Concatenate all PCM data
    const totalSamples = pcmDataArrays.reduce((sum, arr) => sum + arr.length, 0)
    const mergedPcm = new Int16Array(totalSamples)
    let offset = 0

    for (const pcmData of pcmDataArrays) {
      mergedPcm.set(pcmData, offset)
      offset += pcmData.length
    }

    console.log("[v0] Merged audio: total samples =", totalSamples, "duration =", totalSamples / sampleRate, "seconds")

    // Create WAV file with merged PCM data
    const wavHeader = new ArrayBuffer(44)
    const view = new DataView(wavHeader)

    // RIFF header
    view.setUint8(0, 0x52) // R
    view.setUint8(1, 0x49) // I
    view.setUint8(2, 0x46) // F
    view.setUint8(3, 0x46) // F
    view.setUint32(4, 36 + mergedPcm.byteLength, true) // File size - 8
    view.setUint8(8, 0x57) // W
    view.setUint8(9, 0x41) // A
    view.setUint8(10, 0x56) // V
    view.setUint8(11, 0x45) // E

    // fmt chunk
    view.setUint8(12, 0x66) // f
    view.setUint8(13, 0x6d) // m
    view.setUint8(14, 0x74) // t
    view.setUint8(15, 0x20) // space
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // Audio format (1 = PCM)
    view.setUint16(22, channels, true) // Number of channels
    view.setUint32(24, sampleRate, true) // Sample rate
    view.setUint32(28, sampleRate * channels * 2, true) // Byte rate
    view.setUint16(32, channels * 2, true) // Block align
    view.setUint16(34, 16, true) // Bits per sample

    // data chunk
    view.setUint8(36, 0x64) // d
    view.setUint8(37, 0x61) // a
    view.setUint8(38, 0x74) // t
    view.setUint8(39, 0x61) // a
    view.setUint32(40, mergedPcm.byteLength, true) // Data size

    // Combine header and PCM data
    const wavFile = new Uint8Array(wavHeader.byteLength + mergedPcm.byteLength)
    wavFile.set(new Uint8Array(wavHeader), 0)
    wavFile.set(new Uint8Array(mergedPcm.buffer), wavHeader.byteLength)

    return new NextResponse(wavFile, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": 'attachment; filename="merged_audio.wav"',
      },
    })
  } catch (error) {
    console.error("[v0] Error merging audio:", error)
    return NextResponse.json({ error: "Failed to merge audio files" }, { status: 500 })
  }
}
