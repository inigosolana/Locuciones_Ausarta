"use client"

import type React from "react"
import Image from "next/image"
import { useRef, useState, useCallback, type ChangeEvent } from "react"

// --- TIPOS ---

type Mode = "tts" | "stt" | "converter" | "merge" | "scheduler" | "festivos"

type Language = "castellano" | "euskera" | "gallego" | "ingles" | "mexicano"

type VoiceAlias =
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

type FormatId = "mp3" | "wav_yeastar"

interface ScheduleGroup {
  id: string
  days: string[]
  splitSchedule: boolean
  openTime1: string
  closeTime1: string
  openTime2: string
  closeTime2: string
}

// --- CONSTANTES ---

const VOICES: Record<Language, { id: VoiceAlias; label: string }[]> = {
  castellano: [
    { id: "chica", label: "Chica (ES)" },
    { id: "chico", label: "Chico (ES)" },
    { id: "ausarta", label: "Voz Ausarta" },
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

// Converter
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

const WEEK_DAYS = [
  { id: "monday", label: "Lunes" },
  { id: "tuesday", label: "Martes" },
  { id: "wednesday", label: "Miércoles" },
  { id: "thursday", label: "Jueves" },
  { id: "friday", label: "Viernes" },
  { id: "saturday", label: "Sábado" },
  { id: "sunday", label: "Domingo" },
]

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

  const [speed, setSpeed] = useState<number>(1)

  // ---------- TRANSLATION ----------
  const [sourceLanguage, setSourceLanguage] = useState<Language>("castellano")
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState("")

  // ---------- FESTIVOS ----------
  const [festiveName, setFestiveName] = useState("")
  const [festiveDate, setFestiveDate] = useState("")
  const [isDateRange, setIsDateRange] = useState(false)
  const [festiveEndDate, setFestiveEndDate] = useState("")
  const [festiveCompany, setFestiveCompany] = useState("")
  const [festiveType, setFestiveType] = useState<"nacional" | "autonomico" | "local">("nacional")
  const [festiveAutonomy, setFestiveAutonomy] = useState("")
  const [festiveLanguages, setFestiveLanguages] = useState<Language[]>(["castellano"])
  const [festiveLoading, setFestiveLoading] = useState(false)
  const [festiveError, setFestiveError] = useState("")
  const [festiveMessages, setFestiveMessages] = useState<Partial<Record<Language, string>>>({})
  const [festiveAudios, setFestiveAudios] = useState<Partial<Record<Language, string>>>({})
  const [generatingFestiveAudio, setGeneratingFestiveAudio] = useState<Language | null>(null)
  
  const [festiveVoiceType, setFestiveVoiceType] = useState<"chico" | "chica">("chica")
  const [festiveFormat, setFestiveFormat] = useState<FormatId>("mp3")

  const handleLanguageChange = (newLanguage: Language) => {
    setLanguage(newLanguage)
    setVoice(VOICES[newLanguage][0].id)
    setAudioURL("")
    if (audioRef.current) audioRef.current.src = ""
  }

  const translateText = async (targetLang: Language) => {
    if (!text.trim()) {
      setTranslationError("El texto está vacío")
      return
    }

    setTranslating(true)
    setTranslationError("")

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLang,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error en la traducción")
      }

      const data = await res.json()
      setText(data.translatedText)
      setLanguage(targetLang)
      setVoice(VOICES[targetLang][0].id)
      setSourceLanguage(targetLang)
    } catch (error: any) {
      setTranslationError(error.message || "Error desconocido")
    } finally {
      setTranslating(false)
    }
  }

  const generateFestiveMessages = async () => {
    if (!festiveName.trim() || !festiveCompany.trim() || festiveLanguages.length === 0) {
      setFestiveError("Por favor completa todos los campos (nombre, fechas, empresa).")
      return
    }

    if (!festiveDate || (isDateRange && !festiveEndDate)) {
      setFestiveError("Por favor completa las fechas correctamente.")
      return
    }

    setFestiveLoading(true)
    setFestiveError("")
    setFestiveMessages({})
    setFestiveAudios({})

    const dateStr = isDateRange && festiveEndDate ? `del ${festiveDate} al ${festiveEndDate}` : festiveDate;

    try {
      const res = await fetchWithTimeout(
        "/api/festivos",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            festiveName,
            date: dateStr,
            company: festiveCompany,
            type: festiveType,
            autonomyOrLocation: festiveAutonomy,
            languages: festiveLanguages,
          }),
        },
        30000
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error generando mensajes")
      }

      const data = await res.json()
      setFestiveMessages(data.messages)
    } catch (error: any) {
      setFestiveError(error.message || "Error desconocido")
    } finally {
      setFestiveLoading(false)
    }
  }

  const generateFestiveAudio = async (lang: Language) => {
    const messageText = festiveMessages[lang]
    if (!messageText) {
      setFestiveError("No hay mensaje para este idioma")
      return
    }

    setGeneratingFestiveAudio(lang)
    setFestiveError("")

    try {
      const voiceForLang = VOICES[lang].find(v => 
        v.id.toLowerCase().includes(festiveVoiceType)
      )?.id || VOICES[lang][0].id

      const res = await fetchWithTimeout(
        "/api/tts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: messageText,
            voice: voiceForLang,
            format: festiveFormat,
            filename: `festivo_${lang}`,
            language: lang,
            speed: 1,
          }),
        },
        55000
      )

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Error generando audio")
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setFestiveAudios((prev) => ({ ...prev, [lang]: url }))
    } catch (error: any) {
      setFestiveError(error.message || "Error generando audio")
    } finally {
      setGeneratingFestiveAudio(null)
    }
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
            speed,
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

  // ---------- CONVERTER ----------
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

  // ---------- SCHEDULER (ACTUALIZADO) ----------
  const [schedCompanyName, setSchedCompanyName] = useState("")
  // IDIOMA PRINCIPAL
  const [schedLanguage, setSchedLanguage] = useState<Language>("castellano")
  // IDIOMA SECUNDARIO (OPCIONAL)
  const [schedSecondLanguage, setSchedSecondLanguage] = useState<Language | "none">("none")
  
  // Estado para los grupos de horarios
  const [schedGroups, setSchedGroups] = useState<ScheduleGroup[]>([
    {
      id: "1",
      days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      splitSchedule: false,
      openTime1: "09:00",
      closeTime1: "18:00",
      openTime2: "16:00",
      closeTime2: "19:00",
    },
  ])

  const [schedInsideType, setSchedInsideType] = useState<"welcome" | "ivr">("welcome")
  const [schedIvrOptions, setSchedIvrOptions] = useState("1. Atención al cliente\n2. Reclamaciones\n3. Información")
  const [schedGenerating, setSchedGenerating] = useState(false)
  const [schedError, setSchedError] = useState("")
  const [schedInsideText, setSchedInsideText] = useState("")
  const [schedOutsideText, setSchedOutsideText] = useState("")
  const [schedIncludeVoicemail, setSchedIncludeVoicemail] = useState(false)
  const [schedVoicemailText, setSchedVoicemailText] = useState("")

  // -- Helpers de Grupos --

  const addScheduleGroup = () => {
    setSchedGroups([
      ...schedGroups,
      {
        id: Date.now().toString(),
        days: [], // Se empieza vacío
        splitSchedule: false,
        openTime1: "08:00",
        closeTime1: "15:00",
        openTime2: "16:00",
        closeTime2: "19:00",
      },
    ])
  }

  const removeScheduleGroup = (id: string) => {
    setSchedGroups(schedGroups.filter((g) => g.id !== id))
  }

  const updateGroup = (id: string, field: keyof ScheduleGroup, value: any) => {
    setSchedGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value } : g))
    )
  }

  const toggleDayInGroup = (groupId: string, dayId: string) => {
    setSchedGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g
        const hasDay = g.days.includes(dayId)
        return {
          ...g,
          days: hasDay ? g.days.filter((d) => d !== dayId) : [...g.days, dayId],
        }
      })
    )
  }

  // Comprueba qué días están ya seleccionados en OTROS grupos para deshabilitarlos
  const getDaysSelectedInOtherGroups = (currentGroupId: string) => {
    const allSelected: string[] = []
    schedGroups.forEach((g) => {
      if (g.id !== currentGroupId) {
        allSelected.push(...g.days)
      }
    })
    return allSelected
  }

  const speedLabel = speed < 0.9 ? "Lenta" : speed > 1.1 ? "Rápida" : "Normal"

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
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

        {/* MENU NAVEGACION */}
        <div className="flex flex-wrap gap-3 mb-8 bg-white rounded-xl shadow-lg p-4 justify-center">
          <button
            onClick={() => setMode("tts")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "tts"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            🎧 Generación Voz
          </button>
          <button
            onClick={() => setMode("stt")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "stt"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            📝 Transcribir
          </button>
          <button
            onClick={() => setMode("converter")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "converter"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            🔄 Convertidor a WAV YEASTAR/3CX
          </button>
          <button
            onClick={() => setMode("merge")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "merge"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            🔗 Unir Audios
          </button>
          <button
            onClick={() => setMode("scheduler")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "scheduler"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            ⏰ IA Generador Locucion
          </button>
          <button
            onClick={() => setMode("festivos")}
            className={`flex-grow md:flex-none py-4 px-8 rounded-xl font-bold text-lg transition-all duration-200 ${
              mode === "festivos"
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:scale-105"
            }`}
          >
            🎉 Generador Festivos
          </button>
        </div>

        {mode === "tts" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-3xl font-bold text-slate-900 mb-6 text-center">🎧 Generador de Voz</h2>

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

            <div className="mb-6">
              <label className="text-sm font-semibold text-slate-900 mb-2 block">Locución (texto)</label>
              <textarea
                className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[140px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe aquí lo que quieres locutar…"
              />
              <p className="text-xs text-slate-500 mt-2">
                <b>Pausas:</b> Usa <code className="bg-slate-100 px-1 rounded">[pausa:X.Xs]</code> para insertar pausas. Ejemplo: <code className="bg-slate-100 px-1 rounded">Hola [pausa:2.5s] mundo</code>.
              </p>
            </div>

            <div className="mb-6 space-y-3">
              <label className="text-sm font-semibold text-slate-900">Traducir a otro idioma</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.keys(VOICES).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => translateText(lang as Language)}
                    disabled={translating}
                    className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 disabled:bg-slate-300 text-slate-900 rounded-lg transition font-medium"
                  >
                    {lang === "castellano"
                      ? "🇪🇸 Castellano"
                      : lang === "euskera"
                        ? "🇪🇺 Euskera"
                        : lang === "gallego"
                          ? "🇬🇦 Gallego"
                          : lang === "ingles"
                            ? "🇬🇧 Inglés"
                            : "🇲🇽 Mexicano"}
                  </button>
                ))}
              </div>
              {translationError && (
                <p className="text-sm text-red-600">{translationError}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
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

            <button
              onClick={generateVoice}
              disabled={loading}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg"
            >
              {loading ? "Generando..." : "▶ Generar voz"}
            </button>

            {ttsError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{ttsError}</div>
            )}

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
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">📝 Transcribir Audio</h2>

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

            <div className="space-y-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">Formatos Compatibles</h3>
                <p className="text-xs text-blue-800">{SUPPORTED_FORMATS.join(", ").toUpperCase()}</p>
              </div>
            </div>

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

            <button
              onClick={transcribe}
              disabled={sttLoading || !file || !isValidFormat || hasInvalidCharacters}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors duration-200"
            >
              {sttLoading ? "Transcribiendo..." : "📝 Transcribir Ahora"}
            </button>

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
                    setMergeFiles(files)
                    setMergeError("")
                    if (files.length > 0) {
                      const firstFile = files[0].name
                      const baseName = firstFile.replace(/\.[^/.]+$/, "")
                      setMergedFileName(`${baseName}_combinado`)
                    }
                  }}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
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
                  setMergeError("")
                  try {
                    const formData = new FormData()
                    mergeFiles.forEach((file) => formData.append("files", file))
                    const response = await fetch("/api/merge", { method: "POST", body: formData })
                    if (!response.ok) {
                      const errorData = await response.json()
                      setMergeError(errorData.error || "Error al unir los archivos")
                      setMergeLoading(false)
                      return
                    }
                    const blob = await response.blob()
                    const url = URL.createObjectURL(blob)
                    const extension = mergeFiles[0].name.toLowerCase().endsWith(".mp3") ? ".mp3" : ".wav"
                    const filename = `${mergedFileName}${extension}`
                    const a = document.createElement("a")
                    a.href = url
                    a.download = filename
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  } catch (error) {
                    setMergeError("Error al unir los archivos de audio")
                  } finally {
                    setMergeLoading(false)
                  }
                }}
                disabled={mergeLoading || mergeFiles.length < 2}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-all duration-200 disabled:opacity-50"
              >
                {mergeLoading ? "Uniendo..." : "Unir Audios"}
              </button>
            </div>
          </div>
        ) : mode === "scheduler" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-2 text-slate-800">IA Mensajes</h2>
            <p className="text-slate-600 mb-6">
              Genera automáticamente mensajes de respuesta automática (IVR) usando IA. Configura tu empresa y sus diferentes horarios.
            </p>

            {schedError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{schedError}</div>
            )}

            <div className="space-y-6">
              
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la empresa</label>
                  <input
                    type="text"
                    value={schedCompanyName}
                    onChange={(e) => setSchedCompanyName(e.target.value)}
                    placeholder="Ej: Ausarta, Cefagasa"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Idioma Principal</label>
                  <select
                    value={schedLanguage}
                    onChange={(e) => setSchedLanguage(e.target.value as any)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="castellano">🇪🇸 Castellano</option>
                    <option value="euskera">🇪🇺 Euskera</option>
                    <option value="gallego">🇬🇦 Gallego</option>
                    <option value="ingles">🇬🇧 Inglés</option>
                    <option value="mexicano">🇲🇽 Mexicano</option>
                  </select>

                  <div className="mt-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Segundo Idioma (Opcional - Bilingüe)</label>
                    <select
                      value={schedSecondLanguage}
                      onChange={(e) => setSchedSecondLanguage(e.target.value as any)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="none">-- Ninguno --</option>
                      <option value="castellano">🇪🇸 Castellano</option>
                      <option value="euskera">🇪🇺 Euskera</option>
                      <option value="gallego">🇬🇦 Gallego</option>
                      <option value="ingles">🇬🇧 Inglés</option>
                      <option value="mexicano">🇲🇽 Mexicano</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* LISTA DE GRUPOS DE HORARIO */}
              <div className="border-t pt-4">
                <label className="block text-lg font-bold text-slate-800 mb-4">Configuración de Horarios</label>
                
                <div className="space-y-6">
                  {schedGroups.map((group, index) => {
                    const daysTaken = getDaysSelectedInOtherGroups(group.id)
                    
                    return (
                      <div key={group.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 relative transition-all duration-200 hover:shadow-sm">
                        {/* Botón borrar grupo (solo si hay más de uno) */}
                        {schedGroups.length > 1 && (
                          <button
                            onClick={() => removeScheduleGroup(group.id)}
                            className="absolute top-2 right-2 text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 bg-white rounded border border-red-100 hover:bg-red-50 transition"
                          >
                            ✕ Eliminar
                          </button>
                        )}

                        <h4 className="text-sm font-bold text-blue-800 mb-3 uppercase tracking-wide">
                          Bloque de Horario {index + 1}
                        </h4>

                        {/* Selector de Días */}
                        <div className="mb-4">
                          <label className="block text-xs font-medium text-slate-500 mb-2">Días aplicables</label>
                          <div className="flex flex-wrap gap-2">
                            {WEEK_DAYS.map((day) => {
                              const isSelected = group.days.includes(day.id)
                              const isDisabled = daysTaken.includes(day.id)
                              return (
                                <button
                                  key={day.id}
                                  disabled={isDisabled}
                                  onClick={() => toggleDayInGroup(group.id, day.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition duration-200 ${
                                    isSelected
                                      ? "bg-blue-600 text-white border-blue-600 shadow-md transform scale-105"
                                      : isDisabled
                                      ? "bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed opacity-60"
                                      : "bg-white text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600"
                                  }`}
                                >
                                  {day.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Toggle Horario Partido */}
                        <div className="mb-4">
                           <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={group.splitSchedule}
                              onChange={(e) => updateGroup(group.id, "splitSchedule", e.target.checked)}
                              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span>Activar horario partido (mañana y tarde)</span>
                          </label>
                        </div>

                        {/* Inputs de Horas */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                          <div className="space-y-1">
                            <label className="block text-xs text-slate-500 font-medium">
                               {group.splitSchedule ? "Mañana: Apertura" : "Apertura"}
                            </label>
                            <input
                              type="time"
                              value={group.openTime1}
                              onChange={(e) => updateGroup(group.id, "openTime1", e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs text-slate-500 font-medium">
                               {group.splitSchedule ? "Mañana: Cierre" : "Cierre"}
                            </label>
                            <input
                              type="time"
                              value={group.closeTime1}
                              onChange={(e) => updateGroup(group.id, "closeTime1", e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          
                          {group.splitSchedule && (
                            <>
                              <div className="space-y-1">
                                <label className="block text-xs text-slate-500 font-medium">Tarde: Apertura</label>
                                <input
                                  type="time"
                                  value={group.openTime2}
                                  onChange={(e) => updateGroup(group.id, "openTime2", e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-xs text-slate-500 font-medium">Tarde: Cierre</label>
                                <input
                                  type="time"
                                  value={group.closeTime2}
                                  onChange={(e) => updateGroup(group.id, "closeTime2", e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <button
                  onClick={addScheduleGroup}
                  className="mt-4 text-sm inline-flex items-center gap-2 font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg transition"
                >
                  <span className="text-lg leading-none">+</span> Añadir otro horario diferenciado (ej: Viernes)
                </button>
              </div>

              {/* OPCIONES GENERALES */}
              <div className="space-y-4 pt-4 border-t">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={schedIncludeVoicemail}
                    onChange={(e) => setSchedIncludeVoicemail(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  Incluir invitación al buzón de voz
                </label>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Tipo de mensaje (dentro de horario)</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSchedInsideType("welcome")}
                      className={`flex-1 px-4 py-2 rounded-lg font-medium transition text-sm ${
                        schedInsideType === "welcome"
                          ? "bg-blue-600 text-white shadow-md"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      Bienvenida simple
                    </button>
                    <button
                      onClick={() => setSchedInsideType("ivr")}
                      className={`flex-1 px-4 py-2 rounded-lg font-medium transition text-sm ${
                        schedInsideType === "ivr"
                          ? "bg-blue-600 text-white shadow-md"
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
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono bg-slate-50"
                      placeholder="1. Opción 1\n2. Opción 2\n3. Opción 3"
                    />
                    <p className="text-xs text-slate-500 mt-1">Una opción por línea.</p>
                  </div>
                )}
              </div>

              <button
                onClick={async () => {
                  if (!schedCompanyName.trim()) {
                    setSchedError("Por favor, ingresa el nombre de la empresa")
                    return
                  }
                  if (schedGroups.length === 0) {
                     setSchedError("Debes tener al menos un horario")
                     return
                  }
                  // Validar que no haya grupos sin días
                  const emptyGroupIndex = schedGroups.findIndex(g => g.days.length === 0);
                  if (emptyGroupIndex >= 0) {
                    setSchedError(`El bloque de horario ${emptyGroupIndex + 1} no tiene días seleccionados.`)
                    return
                  }

                  setSchedGenerating(true)
                  setSchedError("")
                  setSchedInsideText("")
                  setSchedOutsideText("")
                  
                  try {
                    const res = await fetch("/api/scheduler", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        company: schedCompanyName,
                        scheduleGroups: schedGroups, 
                        insideType: schedInsideType,
                        ivrOptions: schedInsideType === "ivr" ? schedIvrOptions : null,
                        includeVoicemail: schedIncludeVoicemail,
                        language: schedLanguage,
                        secondLanguage: schedSecondLanguage === "none" ? null : schedSecondLanguage
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
                disabled={schedGenerating || !schedCompanyName.trim()}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 shadow-lg"
              >
                {schedGenerating ? "🤖 Generando Mensajes con IA..." : "✨ Generar Mensajes"}
              </button>

              {(schedInsideText || schedOutsideText) && (
                <div className="space-y-6 pt-6 border-t animate-in fade-in duration-500">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                      {schedInsideType === "ivr" ? "Mensaje de IVR" : "Mensaje - Dentro de horario"}
                    </label>
                    <textarea
                      value={schedInsideText}
                      onChange={(e) => setSchedInsideText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Mensaje - Fuera de horario</label>
                    <textarea
                      value={schedOutsideText}
                      onChange={(e) => setSchedOutsideText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {schedVoicemailText && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Mensaje - Buzón de voz</label>
                      <textarea
                        value={schedVoicemailText}
                        onChange={(e) => setSchedVoicemailText(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  <div className={`grid gap-3 ${schedVoicemailText ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                    <button
                      onClick={() => {
                        if (!schedInsideText.trim()) return
                        const safeName = schedCompanyName.trim().replace(/\s+/g, "_") || "empresa"
                        const suffix = schedInsideType === "ivr" ? "_IVR" : "_DH"
                        setFilename(`${safeName}${suffix}`)
                        setText(schedInsideText)
                        
                        // Sincronizar idioma TTS (Usamos el principal como base)
                        setLanguage(schedLanguage)
                        setVoice(VOICES[schedLanguage][0].id)

                        setMode("tts")
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-medium text-sm shadow flex justify-center items-center gap-2"
                    >
                      🎙️ Audio ({schedInsideType === "ivr" ? "IVR" : "Dentro"})
                    </button>
                    <button
                      onClick={() => {
                        if (!schedOutsideText.trim()) return
                        const safeName = schedCompanyName.trim().replace(/\s+/g, "_") || "empresa"
                        setFilename(`${safeName}_FH`)
                        setText(schedOutsideText)
                        
                        setLanguage(schedLanguage)
                        setVoice(VOICES[schedLanguage][0].id)

                        setMode("tts")
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="bg-orange-600 text-white py-3 rounded-lg hover:bg-orange-700 transition font-medium text-sm shadow flex justify-center items-center gap-2"
                    >
                      🎙️ Audio (Fuera)
                    </button>
                    {schedVoicemailText && (
                      <button
                        onClick={() => {
                          if (!schedVoicemailText.trim()) return
                          const safeName = schedCompanyName.trim().replace(/\s+/g, "_") || "empresa"
                          setFilename(`${safeName}_BV`)
                          setText(schedVoicemailText)
                          
                          setLanguage(schedLanguage)
                          setVoice(VOICES[schedLanguage][0].id)

                          setMode("tts")
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition font-medium text-sm shadow flex justify-center items-center gap-2"
                      >
                        🎙️ Audio (Buzón)
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : mode === "festivos" ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-3xl font-bold text-slate-900 mb-6 text-center">🎉 Generador de Festivos</h2>

            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Nombre del festivo</label>
                <input
                  type="text"
                  value={festiveName}
                  onChange={(e) => setFestiveName(e.target.value)}
                  placeholder="Ej: Navidad, Rebajas, Aniversario..."
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-semibold text-slate-700">Fecha</label>
                    <label className="text-xs flex items-center gap-1 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={isDateRange} 
                        onChange={(e) => setIsDateRange(e.target.checked)} 
                      />
                      Rango de fechas
                    </label>
                  </div>
                  
                  {isDateRange ? (
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        value={festiveDate}
                        onChange={(e) => setFestiveDate(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-slate-500 font-medium">a</span>
                      <input
                        type="date"
                        value={festiveEndDate}
                        onChange={(e) => setFestiveEndDate(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <input
                      type="date"
                      value={festiveDate}
                      onChange={(e) => setFestiveDate(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Empresa</label>
                  <input
                    type="text"
                    value={festiveCompany}
                    onChange={(e) => setFestiveCompany(e.target.value)}
                    placeholder="Nombre de la empresa"
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Tipo de festivo</label>
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => setFestiveType("nacional")}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      festiveType === "nacional"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Nacional
                  </button>
                  <button
                    onClick={() => setFestiveType("autonomico")}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      festiveType === "autonomico"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Autonómico
                  </button>
                  <button
                    onClick={() => setFestiveType("local")}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      festiveType === "local"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Local
                  </button>
                </div>
              </div>

              {(festiveType === "autonomico" || festiveType === "local") && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    {festiveType === "autonomico" ? "Comunidad Autónoma" : "Localidad"}
                  </label>
                  <input
                    type="text"
                    value={festiveAutonomy}
                    onChange={(e) => setFestiveAutonomy(e.target.value)}
                    placeholder={festiveType === "autonomico" ? "Ej: Cataluña, Euskadi..." : "Ej: Madrid, Barcelona..."}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-3">Idiomas para generar</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.keys(VOICES).map((lang) => (
                    <label key={lang} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={festiveLanguages.includes(lang as Language)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFestiveLanguages([...festiveLanguages, lang as Language])
                          } else {
                            setFestiveLanguages(festiveLanguages.filter((l) => l !== lang))
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-slate-700">
                        {lang === "castellano"
                          ? "🇪🇸 Castellano"
                          : lang === "euskera"
                            ? "🇪🇺 Euskera"
                            : lang === "gallego"
                              ? "🇬🇦 Gallego"
                              : lang === "ingles"
                                ? "🇬🇧 Inglés"
                                : "🇲🇽 Mexicano"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Preferencia de Voz</label>
                  <select 
                    value={festiveVoiceType} 
                    onChange={(e) => setFestiveVoiceType(e.target.value as "chico" | "chica")}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="chica">👩‍🦰 Voz Femenina</option>
                    <option value="chico">👨‍🦱 Voz Masculina</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Formato de Salida</label>
                  <select 
                    value={festiveFormat} 
                    onChange={(e) => setFestiveFormat(e.target.value as FormatId)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="mp3">MP3 (Calidad Estándar)</option>
                    <option value="wav_yeastar">WAV YEASTAR (8kHz Centralita)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={generateFestiveMessages}
                disabled={festiveLoading || !festiveName.trim() || !festiveCompany.trim() || (!festiveDate)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 shadow-lg"
              >
                {festiveLoading ? "🤖 Generando mensajes..." : "✨ Generar Mensajes"}
              </button>

              {festiveError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mt-4">
                  {festiveError}
                </div>
              )}

              {Object.keys(festiveMessages).length > 0 && (
                <div className="space-y-6 pt-6 border-t mt-6">
                  <h3 className="text-xl font-bold text-slate-900">Mensajes generados</h3>
                  {festiveLanguages.map((lang) => (
                    <div key={lang} className="border border-slate-200 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-lg font-semibold text-slate-800">
                          {lang === "castellano"
                            ? "🇪🇸 Castellano"
                            : lang === "euskera"
                              ? "🇪🇺 Euskera"
                              : lang === "gallego"
                                ? "🇬🇦 Gallego"
                                : lang === "ingles"
                                  ? "🇬🇧 Inglés"
                                  : "🇲🇽 Mexicano"}
                        </h4>
                        <button
                          onClick={() => generateFestiveAudio(lang)}
                          disabled={generatingFestiveAudio === lang}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition font-medium text-sm disabled:opacity-50"
                        >
                          {generatingFestiveAudio === lang ? "🎙️ Generando..." : "🎙️ Generar Audio"}
                        </button>
                      </div>

                      <textarea
                        value={festiveMessages[lang] || ""}
                        onChange={(e) => setFestiveMessages({ ...festiveMessages, [lang]: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />

                      {festiveAudios[lang] && (
                        <div className="mt-3">
                          <audio
                            controls
                            src={festiveAudios[lang]}
                            className="w-full"
                          />
                          <a
                            href={festiveAudios[lang]}
                            download={`festivo_${lang}.${festiveFormat === "mp3" ? "mp3" : "wav"}`}
                            className="text-sm text-blue-600 hover:underline mt-2 inline-block"
                          >
                            📥 Descargar audio
                          </a>
                        </div>
                      )}
                    </div>
                  ))}

                  {festiveLanguages.length > 1 && Object.keys(festiveAudios).length === festiveLanguages.length && (
                    <button
                      onClick={() => {
                        const audioUrls = festiveLanguages
                          .filter((lang) => festiveAudios[lang])
                          .map((lang) => ({
                            url: festiveAudios[lang],
                            name: `festivo_${lang}`,
                          }))

                        if (audioUrls.length > 0) {
                          setMode("merge")
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }
                      }}
                      className="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition font-medium shadow-lg"
                    >
                      🔗 Unir todos los audios
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
