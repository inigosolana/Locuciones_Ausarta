import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const LANGUAGE_MAP: Record<string, string> = {
  castellano: "Spanish (Spain)",
  euskera: "Basque",
  gallego: "Galician",
  ingles: "English",
  mexicano: "Spanish (Mexico)",
}

export async function POST(req: Request) {
  try {
    const { text, sourceLanguage, targetLanguage } = await req.json()

    if (!text || !sourceLanguage || !targetLanguage) {
      return NextResponse.json(
        { error: "Parámetros requeridos: text, sourceLanguage, targetLanguage" },
        { status: 400 }
      )
    }

    if (sourceLanguage === targetLanguage) {
      return NextResponse.json({ translatedText: text })
    }

    const sourceLang = LANGUAGE_MAP[sourceLanguage] || sourceLanguage
    const targetLang = LANGUAGE_MAP[targetLanguage] || targetLanguage

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following text from ${sourceLang} to ${targetLang}. 
Only provide the translated text without any explanations or additional commentary.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.7,
    })

    const translatedText =
      response.choices[0]?.message?.content?.trim() || ""

    if (!translatedText) {
      throw new Error("No se obtuvo traducción de OpenAI")
    }

    return NextResponse.json({ translatedText })
  } catch (error: any) {
    console.error("[v0] Translation error:", error)
    return NextResponse.json(
      { error: error.message || "Error en la traducción" },
      { status: 500 }
    )
  }
}
