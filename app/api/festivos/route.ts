import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

type Language = "castellano" | "euskera" | "gallego" | "ingles" | "mexicano"

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      festiveName,
      date,
      company,
      type, // "nacional" | "autonomico" | "local"
      autonomyOrLocation,
      languages,
    } = body

    // Validación básica
    if (!festiveName || !date || !company || !languages || languages.length === 0) {
      return NextResponse.json(
        { error: "Datos incompletos" },
        { status: 400 }
      )
    }

    // Generar mensajes para cada idioma
    const messages: Record<Language, string> = {} as Record<Language, string>

    for (const lang of languages as Language[]) {
      const languageNames: Record<Language, string> = {
        castellano: "español",
        euskera: "euskera",
        gallego: "gallego",
        ingles: "inglés",
        mexicano: "español mexicano",
      }
      const languageName = languageNames[lang]

      const typeTexts: Record<string, string> = {
        nacional: "nacional",
        autonomico: `autonómico de ${autonomyOrLocation}`,
        local: `local de ${autonomyOrLocation}`,
      }
      const typeText = typeTexts[type] || type

      const prompt = `Genera un mensaje de locución profesional y cordial para un día festivo en una empresa. 
El mensaje debe ser breve (máximo 20 segundos de lectura), natural y profesional.

Detalles:
- Empresa: ${company}
- Festivo: ${festiveName}
- Fecha: ${date}
- Tipo: ${typeText}
- Idioma: ${languageName}

El mensaje debe:
1. Saludar amablemente
2. Mencionar el festivo y explicar brevemente por qué es especial
3. Agradecer a los clientes/visitantes por su comprensión
4. Informar que la empresa estará cerrada
5. Despedirse de forma profesional y cálida

Responde SOLO con el texto del mensaje, sin explicaciones adicionales.`

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      })

      const content = completion.choices[0].message.content
      if (!content) {
        throw new Error(`No se generó contenido para ${lang}`)
      }

      messages[lang as Language] = content
    }

    return NextResponse.json({
      messages,
      metadata: {
        festiveName,
        date,
        company,
        type,
        autonomyOrLocation,
      },
    })
  } catch (err: any) {
    console.error("[v0] Error festivos:", err.message)
    return NextResponse.json(
      { error: err.message || "Error generando mensajes" },
      { status: 500 }
    )
  }
}
