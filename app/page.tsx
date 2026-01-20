"use client"

import type React from "react"
import Image from "next/image"
import { useRef, useState, useCallback, type ChangeEvent } from "react"

type Mode = "tts" | "stt" | "converter" | "merge" | "scheduler"

// 🔹 Añadimos "gallego" al tipo Language
type Language = "castellano" | "euskera" | "gallego" | "ingles" | "mexicano"

// 🔹 Actualizamos las voces para que coincidan con el backend
type VoiceAlias =
  | "chica"
  | "chico"
  | "euskera_chico"
  | "euskera_chica"
  | "gallego_chico"
  | "gallego_chica"
  | "ingles_chica"
  | "ingles_chico"
  | "mexicano"

type FormatId = "mp3" | "wav_yeastar"

// 🔹 Mapeo voces por idioma (front) → alias que entiende el backend
const VOICES: Record<Language, { id: VoiceAlias; label: string }[]> = {
  castellano: [
    { id: "chica", label: "Chica (ES)" },
    { id: "chico", label: "Chico (ES)" },
  ],
  euskera: [
    { id: "euskera_chico", label: "Chico (Euskera)" },
    { id: "euskera_chica", label: "Chica (Euskera)" },
  ],
  gallego: [
    { id: "gallego_chico", label: "Chico (Gallego)" },
    { id: "gallego_chica", label: "Chica (Gallego)" },
  ],
  ingles: [
    { id: "ingles_chica", label: "Chica (EN)" },
    { id: "ingles_chico", label: "Chico (EN)" },
  ],
  mexicano: [{ id: "mexicano", label: "Mexicano" }],
}

const FORMATS: { id: FormatId; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "wav_yeastar", label: "WAV_YEASTAR/3CX (8kHz PCM 16-bit)" },
]

// STT
const SUPPORTED_FORMATS = ["mp3", "wav", "m4a", "flac", "ogg", "opus", "aac"]
const INVALID_CHARACTERS = ["*", "?", '"', "<", ">", "|", ":", "\\"]

// Converter: extensiones comunes (WhatsApp y más)
const CONVERTER_ACCEPT_EXTS = [
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "oga",
  "webm",
  "amr",
  "3gp",
  "flac",
  "mp4",
  "mov",
  "caf",
]
const CONVERTER_ACCEPT_ATTR = [
  "audio/*",
  "video/*",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".oga",
  ".webm",
  ".amr",
  ".3gp",
  ".flac",
  ".mp4",
  ".mov",
  ".caf",
].join(",")

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs = 55000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("tts")

  // ---------- TTS ----------
  const [text, setText] = useState("Hola, esto es una prueba con voces españolas.")
  const [language, setLanguage] = useState<Language>("castellano")
  const [voice, setVoice] = useState<VoiceAlias>("chica")
  const [format, setFormat] = useState<FormatId>("mp3")
  const [filename, setFilename] = useState("locucion")
  const [loading, setLoading] = useState(false)
  const [audioURL, setAudioURL] = useState("")
  const [ttsError, setTtsError] = useState("")
  const audioRef = useRef<HTMLAudioElement>(null)

  const [speed, setSpeed] = useState<number>(1) // <<< velocidad (1 = normal)

  const handleLanguageChange = (newLanguage: Language) => {
    setLanguage(newLanguage)
    setVoice(VOICES[newLanguage][0].id)
    setAudioURL("")
    if (audioRef.current) audioRef.current.src = ""
  }

  const handleFormatChange = (newFormat: FormatId) => {
    setFormat(newFormat)
    setAudioURL("")
    if (audioRef.current) audioRef.current.src = ""
  }

  async function generateVoice() {
    try {
      setTtsError("")
      setLoading(true)
      setAudioURL("")
      const res = await fetchWithTimeout(
        "/api/tts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice,
            format,
            filename,
            language,
            speed, // <<< enviamos velocidad al backend
          }),
        },
        55000,
      )
      const maybeJson = await res
        .clone()
        .json()
        .catch(() => null)
      if (!res.ok) {
        const msg = (maybeJson && (maybeJson.detail || maybeJson.error)) || `Fallo TTS (HTTP ${res.status})`
        setTtsError(msg)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setAudioURL(url)
      if (audioRef.current) {
        audioRef.current.src = url
        await audioRef.current.play().catch(() => {})
      }
    } catch (e: any) {
      setTtsError(e?.message || "Error desconocido al generar voz")
    } finally {
      setLoading(false)
    }
  }

  // ---------- STT ----------
  const [file, setFile] = useState<File | null>(null)
  const [engine, setEngine] = useState("whisper-1")
  const [sttLoading, setSttLoading] = useState(false)
  const [textOut, setTextOut] = useState("")
  const [sttError, setSttError] = useState("")
  const [isDragActive, setIsDragActive] = useState(false)

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null)
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") setIsDragActive(true)
    else if (e.type === "dragleave") setIsDragActive(false)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
    const droppedFile = (e as any).dataTransfer?.files?.[0]
    if (droppedFile) setFile(droppedFile)
  }, [])

  async function transcribe() {
    if (!file) return alert("Sube un archivo primero")
    setSttLoading(true)
    setTextOut("")
    setSttError("")
    const fd = new FormData()
    fd.append("audio", file)
    fd.append("filename", file.name)
    fd.append("engine", engine)
    const res = await fetch("/api/stt", { method: "POST", body: fd })
    const data = await res.json()
    setSttLoading(false)
    if (!res.ok) {
      setSttError(typeof data === "string" ? data : JSON.stringify(data, null, 2))
      return
    }
    setTextOut(data.text || "")
  }

  const fileExtension = file?.name.split(".").pop()?.toLowerCase() || ""
  const isValidFormat = SUPPORTED_FORMATS.includes(fileExtension)
  const hasInvalidCharacters = file?.name.split("").some((char) => INVALID_CHARACTERS.includes(char)) || false

  // ---------- CONVERTER (usa /api/converter) ----------
  const convInputRef = useRef<HTMLInputElement | null>(null)
  const [convBaseName, setConvBaseName] = useState<string>("")
  const [convOutputName, setConvOutputName] = useState<string>("")
  const [convStatus, setConvStatus] = useState<string>("Arrastra tu archivo aquí o haz clic para seleccionar.")
  const [convProcessing, setConvProcessing] = useState<boolean>(false)
  const [convDownloadUrl, setConvDownloadUrl] = useState<string>("")
  const [convOutSize, setConvOutSize] = useState<number | null>(null)
  const [convError, setConvError] = useState<string>("")
  const [convIsDrag, setConvIsDrag] = useState(false)

  function openConvPicker() {
    convInputRef.current?.click()
  }

  function convDrag(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") setConvIsDrag(true)
    else if (e.type === "dragleave") setConvIsDrag(false)
  }

  async function convDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setConvIsDrag(false)
    const f = (e as any).dataTransfer?.files?.[0]
    if (f) await onConvPickFile(f)
  }

  async function onConvPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) await onConvPickFile(f)
  }

  async function onConvPickFile(f: File) {
    const ext = (f.name.split(".").pop() || "").toLowerCase()
    if (!CONVERTER_ACCEPT_EXTS.includes(ext)) {
      setConvError(`Formato no soportado: .${ext}`)
      return
    }
    setConvError("")
    if (convDownloadUrl) URL.revokeObjectURL(convDownloadUrl)
    setConvDownloadUrl("")
    setConvOutSize(null)

    const base = (f.name.replace(/\.[^.]+$/, "") || "audio").replace(/[^\w\-.]+/g, "_").slice(0, 80)
    setConvBaseName(base)
    setConvOutputName(`${base}_wav_yeastar`)

    setConvStatus("Subiendo y convirtiendo…")
    setConvProcessing(true)

    try {
      const fd = new FormData()
      fd.append("audio", f)
      fd.append("baseName", base)

      // fetch con timeout en cliente
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 55000)
      const res = await fetch("/api/converter", {
        method: "POST",
        body: fd,
        signal: controller.signal,
        cache: "no-store",
      })
      clearTimeout(t)

      if (!res.ok) {
        let msg = ""
        try {
          const j = await res.json()
          msg = j?.error || ""
        } catch {
          msg = await res.text().catch(() => "")
        }
        throw new Error(msg || `Fallo conversión (HTTP ${res.status})`)
      }

      const blob = await res.blob()
      setConvOutSize(blob.size)
      const url = URL.createObjectURL(blob)
      setConvDownloadUrl(url)
      setConvStatus("¡Listo! Descarga tu WAV.")
    } catch (err: any) {
      console.error(err)
      setConvError(err?.name === "AbortError" ? "Tiempo de espera agotado" : err?.message || "Error al convertir")
      setConvStatus("Ocurrió un error.")
    } finally {
      setConvProcessing(false)
    }
  }

  // ---------- MERGE ----------
  const mergeInputRef = useRef<HTMLInputElement | null>(null)
  const [mergeFiles, setMergeFiles] = useState<File[]>([])
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string>("")
  const [mergedFileName, setMergedFileName] = useState<string>("")

  // ---------- SCHEDULER ----------
  const [schedCompanyName, setSchedCompanyName] = useState("")
  const [schedOpenHour1, setSchedOpenHour1] = useState("09:00")
  const [schedCloseHour1, setSchedCloseHour1] = useState("13:00")
  const [schedOpenHour2, setSchedOpenHour2] = useState("15:00")
  const [schedCloseHour2, setSchedCloseHour2] = useState("19:00")
  const [schedSplitSchedule, setSchedSplitSchedule] = useState(false)
  const [schedSelectedDays, setSchedSelectedDays] = useState<string[]>(["monday", "tuesday", "wednesday", "thursday", "friday"])
  const [schedInsideType, setSchedInsideType] = useState<"welcome" | "ivr">("welcome")
  const [schedIvrOptions, setSchedIvrOptions] = useState("1. Atención al cliente\n2. Reclamaciones\n3. Información")
  const [schedGenerating, setSchedGenerating] = useState(false)
  const [schedError, setSchedError] = useState("")
  const [schedInsideText, setSchedInsideText] = useState("")
  const [schedOutsideText, setSchedOutsideText] = useState("")
  const [schedIncludeVoicemail, setSchedIncludeVoicemail] = useState(false)
  const [schedVoicemailText, setSchedVoicemailText] = useState("")

  const weekDays = [
    { id: "monday", label: "Lunes" },
    { id: "tuesday", label: "Martes" },
    { id: "wednesday", label: "Miércoles" },
    { id: "thursday", label: "Jueves" },
    { id: "friday", label: "Viernes" },
    { id: "saturday", label: "Sábado" },
    { id: "sunday", label: "Domingo" },
  ]

  const toggleDay = (day: string) => {
    setSchedSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    )
  }

  // etiqueta amigable para la velocidad
  const speedLabel = speed < 0.9 ? "Lenta" : speed > 1.1 ? "Rápida" : "Normal"

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="text-center w-full">
            <Image
              src="/ausarta.png"
              alt="Ausarta Logo"
              width={500}
              height={150}
              priority
              className="mx-auto mb-4 object-contain"
            />
            <p className="text-slate-600">Transcriptor y Generador de Voz</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 bg-white rounded-lg shadow-lg p-2">
          <button
            onClick={() => setMode("tts")}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
              mode === "tts" ? "bg-blue-600 text-white shadow-md" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            🎧 Generación de Voz
          </button>
          <button
            onClick={() => setMode("stt")}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
              mode === "stt" ? "bg-blue-600 text-white shadow-md" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            📝 Transcribir Audio
          </button>
          <button
            onClick={() => setMode("converter")}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
              mode === "converter"
                ? "bg-blue-600 text-white shadow-md"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            🔄 Convertir a WAV_YEASTAR/3CX
          </button>
          <button
            onClick={() => setMode("merge")}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mode === "merge" ? "bg-blue-600 text-white shadow-md" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            🔗 Unir Audios
          </button>
          <button
            onClick={() => setMode("scheduler")}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mode === "scheduler" ? "bg-blue-600 text-white shadow-md" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            ⏰ Mensajes por Horario
          </button>
        </div>

        {mode === "tts" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-3xl font-bold text-slate-900 mb-6 text-center">🎧 Generador de Voz</h2>

            {/* --- Información de idiomas y voces disponibles --- */}
            <div className="mb-8 grid sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">🌍 Idiomas disponibles</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>🇪🇸 Castellano — voces masculina & femenina</li>
                  <li>🇪🇺 Euskera — voces masculina & femenina</li>
                  <li>🇬🇦 Gallego — voces masculina & femenina</li>
                  <li>🇬🇧 Inglés — voces masculina & femenina</li>
                  <li>🇲🇽 Español Mexicano — voz masculina</li>
                </ul>
              </div>

              <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                <h3 className="font-semibold text-green-900 mb-2">📄 Formatos disponibles</h3>
                <ul className="text-sm text-green-800 space-y-1">
                  <li>
                    <b>MP3</b> — calidad estándar 44.1kHz
                  </li>
                  <li>
                    <b>WAV_YEASTAR/3CX</b> — 8kHz PCM · mono (compatible con centralitas)
                  </li>
                </ul>
              </div>
            </div>

            {/* Texto */}
            <div className="mb-6">
              <label className="text-sm font-semibold text-slate-900 mb-2 block">Locución (texto)</label>
              <textarea
                className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[140px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe aquí lo que quieres locutar…"
              />
              <p className="text-xs text-slate-500 mt-2">
                <b>Pausas:</b> Usa <code className="bg-slate-100 px-1 rounded">[pausa:X.Xs]</code> para insertar pausas. Ejemplo: <code className="bg-slate-100 px-1 rounded">Hola [pausa:2.5s] mundo</code> = pausa de 2.5 segundos. Usa punto (.) para decimales.
              </p>
            </div>

            {/* Controles */}
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Selector idioma */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Idioma</label>
                <select
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value as Language)}
                >
                  <option value="castellano">🇪🇸 Castellano</option>
                  <option value="euskera">🇪🇺 Euskera</option>
                  <option value="gallego">🇬🇦 Gallego</option>
                  <option value="ingles">🇬🇧 Inglés</option>
                  <option value="mexicano">🇲🇽 Mexicano</option>
                </select>
              </div>

              {/* Selector voz */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Voz</label>
                <select
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as VoiceAlias)}
                >
                  {VOICES[language].map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label.includes("Chica") ? "👩‍🦰 " : "👨‍🦱 "}
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Formato */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Formato</label>
                <select
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  value={format}
                  onChange={(e) => handleFormatChange(e.target.value as FormatId)}
                >
                  {FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Velocidad */}
            <div className="mt-6 space-y-2">
              <label className="text-sm font-semibold text-slate-900 flex justify-between">
                <span>Velocidad de locución</span>
                <span className="text-xs text-slate-500">
                  {speedLabel} ({speed.toFixed(2)}x)
                </span>
              </label>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={speed}
                onChange={(e) => setSpeed(Number.parseFloat(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Nombre archivo */}
            <div className="mt-4 space-y-2">
              <label className="text-sm font-semibold text-slate-900">Nombre del archivo</label>
              <input
                className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                placeholder="locucion"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
              <p className="text-xs text-slate-500">No pongas la extensión (mp3, wav…); se añade automáticamente.</p>
            </div>

            {/* Botón generar */}
            <button
              onClick={generateVoice}
              disabled={loading}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg"
            >
              {loading ? "Generando..." : "▶ Generar voz"}
            </button>

            {/* Error */}
            {ttsError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{ttsError}</div>
            )}

            {/* Player */}
            <div className="mt-8">
              <audio ref={audioRef} controls className="w-full" />
              {audioURL && (
                <a
                  href={audioURL}
                  download={`${filename}.${format === "mp3" ? "mp3" : "wav"}`}
                  className="block mt-3 p-2 bg-slate-100 hover:bg-slate-200 rounded text-center"
                >
                  ⬇ Descargar {format.toUpperCase()}
                </a>
              )}
            </div>
          </div>
        ) : mode === "stt" ? (
          // ----------- STT -----------
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">📝 Transcribir Audio</h2>

            {/* Arrastrar y soltar */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-lg p-8 mb-6 transition-all duration-200 ${
                isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
              }`}
            >
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={onFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center gap-3 pointer-events-none">
                <div className="text-4xl">🎵</div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-slate-900">Arrastra tu archivo aquí</p>
                  <p className="text-sm text-slate-600">o haz clic para seleccionar</p>
                </div>
              </div>
            </div>

            {/* Archivo seleccionado */}
            {file && (
              <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm font-medium text-slate-900">Archivo seleccionado:</p>
                <p className="text-sm text-slate-700 break-all">{file.name}</p>
                <p className="text-xs text-slate-500 mt-1">Tamaño: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
                {!isValidFormat && <p className="text-xs text-red-600 mt-2">⚠️ Formato no compatible</p>}
                {hasInvalidCharacters && (
                  <p className="text-xs text-red-600 mt-2">⚠️ El nombre contiene caracteres no permitidos</p>
                )}
              </div>
            )}

            {/* Ayuda */}
            <div className="space-y-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">Formatos Compatibles</h3>
                <p className="text-xs text-blue-800">{SUPPORTED_FORMATS.join(", ").toUpperCase()}</p>
              </div>

              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="text-sm font-semibold text-green-900 mb-2">Nombres Válidos</h3>
                <p className="text-xs text-green-800">
                  Usa letras, números, guiones y puntos. Sin espacios al inicio/final.
                </p>
              </div>

              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <h3 className="text-sm font-semibold text-red-900 mb-2">Caracteres No Permitidos</h3>
                <p className="text-xs text-red-800 font-mono">
                  {INVALID_CHARACTERS.map((char) => (
                    <span key={char} className="mr-2">
                      &quot;{char}&quot;
                    </span>
                  ))}
                </p>
              </div>
            </div>

            {/* Motor */}
            <div className="space-y-2 mb-6">
              <label className="text-sm font-semibold text-slate-900">Motor de Transcripción</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="whisper-1">Whisper v3 (Más preciso)</option>
                <option value="gpt-4o-mini-transcribe">GPT-4o Mini (Más rápido)</option>
              </select>
            </div>

            {/* Botón */}
            <button
              onClick={transcribe}
              disabled={sttLoading || !file || !isValidFormat || hasInvalidCharacters}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors duration-200"
            >
              {sttLoading ? "Transcribiendo..." : "📝 Transcribir Ahora"}
            </button>

            {/* Transcripción */}
            {textOut && (
              <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-green-900">Transcripción Completada</h3>
                  <button
                    onClick={() => navigator.clipboard.writeText(textOut)}
                    className="text-xs px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                  >
                    Copiar
                  </button>
                </div>
                <p className="text-sm text-green-800 whitespace-pre-wrap">{textOut}</p>
              </div>
            )}

            {/* Error */}
            {sttError && (
              <div className="mt-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <h3 className="text-sm font-semibold text-red-900 mb-2">Error</h3>
                <pre className="text-xs text-red-800 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                  {sttError}
                </pre>
              </div>
            )}
          </div>
        ) : mode === "converter" ? (
          // ----------- CONVERTER -----------
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">
              🔄 Convertir a WAV_YEASTAR/3CX (8kHz, Mono, 16-bit)
            </h2>

            <input
              type="file"
              ref={convInputRef}
              accept={CONVERTER_ACCEPT_ATTR}
              className="hidden"
              onChange={onConvPick}
            />

            {/* Dropzone grande */}
            <div
              onDragEnter={convDrag}
              onDragLeave={convDrag}
              onDragOver={convDrag}
              onDrop={convDrop}
              className={`relative border-2 border-dashed rounded-2xl p-10 mb-6 transition-all duration-200 text-center ${
                convIsDrag ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
              }`}
              style={{ minHeight: 180 }}
              onClick={openConvPicker}
            >
              <div className="pointer-events-none select-none flex flex-col items-center gap-2">
                <div className="text-5xl">📦</div>
                <p className="text-lg font-semibold text-slate-900">Arrastra tu archivo aquí</p>
                <p className="text-sm text-slate-600">
                  o haz clic para seleccionar (WhatsApp/OPUS, MP3, OGG, M4A/AAC, FLAC, WEBM, AMR, 3GP, MP4…)
                </p>
              </div>
            </div>

            {/* Estado / error */}
            {convError && (
              <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
                {convError}
              </div>
            )}
            <div className="text-sm mb-4">{convStatus}</div>

            {convOutputName && (
              <div className="mb-6 space-y-2">
                <label className="text-sm font-semibold text-slate-900">Nombre del archivo de salida</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={convOutputName}
                  onChange={(e) => setConvOutputName(e.target.value)}
                  placeholder="nombre_wav_yeastar"
                />
                <p className="text-xs text-slate-500">Se añadirá automáticamente la extensión .wav</p>
              </div>
            )}

            {/* Resultado */}
            {convDownloadUrl && (
              <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl p-3 border">
                <div className="text-sm">
                  <div className="font-medium">WAV YEASTAR generado</div>
                  <div className="text-gray-600">
                    Formato: 16-bit PCM • 8kHz • Mono
                    {convOutSize ? ` • Tamaño: ${(convOutSize / 1024).toFixed(1)} KB` : ""}
                  </div>
                </div>
                <a
                  href={convDownloadUrl}
                  download={`${convOutputName || "audio_wav_yeastar"}.wav`}
                  className="px-4 py-2 rounded-2xl shadow bg-black text-white hover:opacity-90"
                >
                  Descargar WAV
                </a>
              </div>
            )}

            {/* Tipos soportados visibles */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">Tipos admitidos</h3>
                <p className="text-xs text-blue-800">{CONVERTER_ACCEPT_EXTS.map((e) => e.toUpperCase()).join(", ")}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="text-sm font-semibold text-green-900 mb-2">Salida</h3>
                <p className="text-xs text-green-800">WAV PCM 16-bit • 8 kHz • Mono</p>
              </div>
            </div>
          </div>
        ) : mode === "merge" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-2 text-slate-800">Unir Audios</h2>
            <p className="text-slate-600 mb-6">
              Combina múltiples archivos de audio en uno solo. Los audios deben estar en el mismo formato (WAV o MP3).
            </p>

            {mergeError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{mergeError}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Selecciona los archivos de audio (en orden)
                </label>
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/mp3"
                  multiple
                  ref={mergeInputRef}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    console.log(
                      "[v0] Selected files for merging:",
                      files.map((f) => f.name),
                    )
                    setMergeFiles(files)
                    setMergeError(null)
                    if (files.length > 0) {
                      const firstFile = files[0].name
                      const baseName = firstFile.replace(/\.[^/.]+$/, "")
                      setMergedFileName(`${baseName}_combinado`)
                    }
                  }}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                    cursor-pointer"
                />
                <p className="mt-2 text-sm text-slate-500">
                  Puedes seleccionar múltiples archivos WAV o MP3. Todos deben ser del mismo formato.
                </p>
                {mergeFiles.length > 0 && (
                  <div className="mt-2 text-sm text-slate-600">
                    <p className="font-medium">Archivos seleccionados ({mergeFiles.length}):</p>
                    <ul className="list-disc list-inside">
                      {mergeFiles.map((f, i) => (
                        <li key={i}>{f.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del archivo combinado</label>
                <input
                  type="text"
                  value={mergedFileName}
                  onChange={(e) => setMergedFileName(e.target.value)}
                  placeholder="audio_combinado"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={async () => {
                  if (mergeFiles.length < 2) {
                    setMergeError("Debes seleccionar al menos 2 archivos para unir")
                    return
                  }

                  setMergeLoading(true)
                  setMergeError(null)

                  try {
                    const formData = new FormData()
                    mergeFiles.forEach((file) => formData.append("files", file))

                    const response = await fetch("/api/merge", {
                      method: "POST",
                      body: formData,
                    })

                    if (!response.ok) {
                      const errorData = await response.json()
                      setMergeError(errorData.error || "Error al unir los archivos")
                      setMergeLoading(false)
                      return
                    }

                    const blob = await response.blob()
                    const url = URL.createObjectURL(blob)

                    // Detect output format from first file
                    const extension = mergeFiles[0].name.toLowerCase().endsWith(".mp3") ? ".mp3" : ".wav"
                    const filename = `${mergedFileName}${extension}`

                    const a = document.createElement("a")
                    a.href = url
                    a.download = filename
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)

                    console.log("[v0] Audio files merged successfully")
                  } catch (error) {
                    console.error("[v0] Error merging audio:", error)
                    setMergeError("Error al unir los archivos de audio")
                  } finally {
                    setMergeLoading(false)
                  }
                }}
                disabled={mergeLoading || mergeFiles.length < 2}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-lg font-semibold
                  hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mergeLoading ? "Uniendo..." : "Unir Audios"}
              </button>
            </div>
          </div>
        ) : mode === "scheduler" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-2 text-slate-800">IA Mensajes</h2>
            <p className="text-slate-600 mb-6">
              Genera automáticamente mensajes de respuesta automática (IVR) usando IA. Configura tu empresa, horario y días de atención.
            </p>

            {schedError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{schedError}</div>
            )}

            <div className="space-y-6">
              {/* Nombre de empresa */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la empresa</label>
                <input
                  type="text"
                  value={schedCompanyName}
                  onChange={(e) => setSchedCompanyName(e.target.value)}
                  placeholder="Ej: Ausarta, Cefagasa"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Días de la semana */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Días de atención</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {weekDays.map((day) => (
                    <button
                      key={day.id}
                      onClick={() => toggleDay(day.id)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                        schedSelectedDays.includes(day.id)
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Horario partido */}
              {/* Horario partido y Buzón de Voz */}
              <div className="flex flex-col gap-3 mb-4">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={schedSplitSchedule}
                    onChange={(e) => setSchedSplitSchedule(e.target.checked)}
                    className="rounded cursor-pointer"
                  />
                  Horario partido (cierre mediodía)
                </label>

                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={schedIncludeVoicemail}
                    onChange={(e) => setSchedIncludeVoicemail(e.target.checked)}
                    className="rounded cursor-pointer"
                  />
                  Incluir invitación al buzón de voz (mensaje fuera de horario)
                </label>
              </div>
              {/* Horarios */}
              {schedSplitSchedule ? (
                <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm font-medium text-slate-700 mb-3">Turno mañana</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Apertura</label>
                      <input
                        type="time"
                        value={schedOpenHour1}
                        onChange={(e) => setSchedOpenHour1(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cierre (mediodía)</label>
                      <input
                        type="time"
                        value={schedCloseHour1}
                        onChange={(e) => setSchedCloseHour1(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <p className="text-sm font-medium text-slate-700 mb-3 mt-4">Turno tarde</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Apertura (tarde)</label>
                      <input
                        type="time"
                        value={schedOpenHour2}
                        onChange={(e) => setSchedOpenHour2(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cierre</label>
                      <input
                        type="time"
                        value={schedCloseHour2}
                        onChange={(e) => setSchedCloseHour2(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Hora de apertura</label>
                    <input
                      type="time"
                      value={schedOpenHour1}
                      onChange={(e) => setSchedOpenHour1(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Hora de cierre</label>
                    <input
                      type="time"
                      value={schedCloseHour1}
                      onChange={(e) => setSchedCloseHour1(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {/* Tipo de mensaje dentro de horario */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">Tipo de mensaje (dentro de horario)</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSchedInsideType("welcome")}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition text-sm ${
                      schedInsideType === "welcome"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Bienvenida
                  </button>
                  <button
                    onClick={() => setSchedInsideType("ivr")}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition text-sm ${
                      schedInsideType === "ivr"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    IVR (con opciones)
                  </button>
                </div>
              </div>

              {schedInsideType === "ivr" && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Opciones del IVR</label>
                  <textarea
                    value={schedIvrOptions}
                    onChange={(e) => setSchedIvrOptions(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="1. Opción 1\n2. Opción 2\n3. Opción 3"
                  />
                  <p className="text-xs text-slate-500 mt-1">Una opción por línea. La IA lo incorporará en el mensaje.</p>
                </div>
              )}

              {/* Buzón de voz */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={schedIncludeVoicemail}
                    onChange={(e) => setSchedIncludeVoicemail(e.target.checked)}
                    className="rounded cursor-pointer"
                  />
                  Incluir opción de buzón de voz
                </label>
                <p className="text-xs text-slate-500 mt-1">Se generará un mensaje de buzón de voz con instrucciones</p>
              </div>

              {/* Botón generar */}
              <button
                onClick={async () => {
                  if (!schedCompanyName.trim()) {
                    setSchedError("Por favor, ingresa el nombre de la empresa")
                    return
                  }

                  if (schedSelectedDays.length === 0) {
                    setSchedError("Por favor, selecciona al menos un día de atención")
                    return
                  }

                  setSchedGenerating(true)
                  setSchedError("")
                  setSchedInsideText("")
                  setSchedOutsideText("")
                  // setSchedVoicemailText("") // Ya no es necesario limpiar esto por separado

                  try {
                    const res = await fetch("/api/scheduler", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        company: schedCompanyName,
                        days: schedSelectedDays,
                        splitSchedule: schedSplitSchedule,
                        openTime1: schedOpenHour1,
                        closeTime1: schedCloseHour1,
                        openTime2: schedSplitSchedule ? schedOpenHour2 : null,
                        closeTime2: schedSplitSchedule ? schedCloseHour2 : null,
                        insideType: schedInsideType,
                        ivrOptions: schedInsideType === "ivr" ? schedIvrOptions : null,
                        includeVoicemail: schedIncludeVoicemail,
                      }),
                    })

                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}))
                      throw new Error(err.error || `Error HTTP ${res.status}`)
                    }

                    const data = await res.json()
                    setSchedInsideText(data.messageInside)
                    setSchedOutsideText(data.messageOutside)
                    setSchedVoicemailText(data.messageVoicemail || "")
                  } catch (err: any) {
                    setSchedError(err?.message || "Error al generar mensajes")
                  } finally {
                    setSchedGenerating(false)
                  }
                }}
                disabled={schedGenerating || !schedCompanyName.trim() || schedSelectedDays.length === 0}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-lg font-semibold
                  hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {schedGenerating ? "Generando..." : "Generar Mensajes"}
              </button>

              {/* Textos generados */}
                  {(schedInsideText || schedOutsideText) && (
                <div className="space-y-4 pt-4 border-t">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje - Dentro de horario</label>
                    <textarea
                      value={schedInsideText}
                      onChange={(e) => setSchedInsideText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">Puedes editar el texto antes de generar audio</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje - Fuera de horario</label>
                    <textarea
                      value={schedOutsideText}
                      onChange={(e) => setSchedOutsideText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">Puedes editar el texto antes de generar audio</p>
                  </div>

                  {schedVoicemailText && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje - Buzón de voz</label>
                      <textarea
                        value={schedVoicemailText}
                        onChange={(e) => setSchedVoicemailText(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-slate-500 mt-1">Puedes editar el texto antes de generar audio</p>
                    </div>
                  )}

                  <div className={`grid gap-3 ${schedVoicemailText ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                    <button
                      onClick={() => {
                        if (!schedInsideText.trim()) {
                          setSchedError("El texto de dentro de horario está vacío")
                          return
                        }
                        setText(schedInsideText)
                        setMode("tts")
                      }}
                      className="bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition font-medium text-sm"
                    >
                      Audio (Dentro)
                    </button>
                    <button
                      onClick={() => {
                        if (!schedOutsideText.trim()) {
                          setSchedError("El texto de fuera de horario está vacío")
                          return
                        }
                        setText(schedOutsideText)
                        setMode("tts")
                      }}
                      className="bg-orange-600 text-white py-2 rounded-lg hover:bg-orange-700 transition font-medium text-sm"
                    >
                      Audio (Fuera)
                    </button>
                    {schedVoicemailText && (
                      <button
                        onClick={() => {
                          if (!schedVoicemailText.trim()) {
                            setSchedError("El texto de buzón está vacío")
                            return
                          }
                          setText(schedVoicemailText)
                          setMode("tts")
                        }}
                        className="bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition font-medium text-sm"
                      >
                        Audio (Buzón)
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
