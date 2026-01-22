import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      company,
      scheduleGroups, 
      insideType,
      ivrOptions,
      includeVoicemail,
      language = "castellano",
      secondLanguage = null, // Nuevo campo
    } = body;

    if (!company || !scheduleGroups || scheduleGroups.length === 0) {
      return NextResponse.json(
        { error: "Falta el nombre de la empresa o los horarios." },
        { status: 400 }
      );
    }

    // 1. LIMPIEZA DE DATOS (Horario Partido)
    const sanitizedSchedule = scheduleGroups.map((g: any) => {
      if (!g.splitSchedule) {
        const { openTime2, closeTime2, ...rest } = g;
        return rest;
      }
      return g;
    });
    const scheduleJson = JSON.stringify(sanitizedSchedule);

    // 2. CONFIGURACIÓN IDIOMAS
    const langPromptMap: Record<string, string> = {
      castellano: "Spanish",
      euskera: "Basque (Euskera)",
      gallego: "Galician",
      ingles: "English",
      mexicano: "Mexican Spanish",
    };

    const primaryLangName = langPromptMap[language] || "Spanish";
    
    let bilingualInstruction = "Write the messages strictly in the Target Language defined above.";
    let targetLangLabel = primaryLangName;

    // Si se seleccionó un segundo idioma y es diferente al primero
    if (secondLanguage && secondLanguage !== "none" && secondLanguage !== language) {
        const secondaryLangName = langPromptMap[secondLanguage];
        targetLangLabel = `${primaryLangName} AND ${secondaryLangName}`;
        bilingualInstruction = `
        CRITICAL - BILINGUAL MODE:
        For every message field ("messageInside", "messageOutside", etc.):
        1. Write the text in ${primaryLangName} first.
        2. Insert exactly this tag: [pausa:1.5s]
        3. Write the exact same meaning in ${secondaryLangName}.
        
        Example structure: "Texto en ${primaryLangName} [pausa:1.5s] Texto en ${secondaryLangName}"
        `;
    }

    // 3. INSTRUCCIONES ESPECÍFICAS
    let insideInstructions = "";
    if (insideType === "welcome") {
      insideInstructions = `Generate a simple welcome message: "Thanks for contacting ${company}. We will attend you shortly."`;
    } else {
      const rawOptions = ivrOptions || "1. Info";
      insideInstructions = `
        Generate an IVR menu structure.
        1. Brief greeting for ${company}.
        2. Read these options naturally: """${rawOptions}""".
        RULES:
        - Do NOT say "please hold" or "we will attend you".
        - Terminate after the last option.
      `;
    }

    let voicemailInstruction = "";
    let jsonKeys = '"messageInside" y "messageOutside"';
    if (includeVoicemail) {
      jsonKeys += ' y "messageVoicemail"';
      voicemailInstruction = `
        "messageVoicemail":
        1. Greeting ("You have contacted ${company}").
        2. Summarize the opening hours naturally based on the SCHEDULE_DATA.
        3. Ask to leave a message after the signal.
      `;
    }

    // 4. PROMPT MAESTRO
    const userPrompt = `
      Role: Expert IVR Scriptwriter.
      Company: ${company}
      Target Language: ${targetLangLabel}

      SCHEDULE_DATA (JSON):
      ${scheduleJson}

      TASK:
      Generate a JSON object with keys: ${jsonKeys}.

      ${bilingualInstruction}

      *** CRITICAL FORMATTING RULES (STRICT) ***:
      1. **CASING (Minúsculas)**: Use "Sentence case" (mostly lowercase). 
         Example: "hola, bienvenidos a Ausarta."
      
      2. **NATURAL TIME (Horas naturales)**: 
         - Convert digital times into spoken words (NO digits).
         - In Spanish: X:30 -> "y media", X:15 -> "y cuarto", X:45 -> "menos cuarto".
         - In English: X:30 -> "half past", X:15 -> "quarter past", X:45 -> "quarter to".
         - In Basque (Euskera): X:30 -> "eta erdiak", X:45 -> "laurden gutxi", etc.
         - Use ONLY the times present in SCHEDULE_DATA.

      LOGIC FOR MESSAGES (Apply Bilingual Rule if enabled):
      
      "messageInside" (Open hours):
      ${insideInstructions}

      "messageOutside" (Closed):
      - Polite greeting.
      - State clearly that the office is closed.
      - Explain the opening hours naturally using the SCHEDULE_DATA.
      - Polite goodbye.

      ${voicemailInstruction}

      Response format: Just raw JSON.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.5,
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("OpenAI no devolvió contenido.");

    let parsedData;
    try {
        parsedData = JSON.parse(content);
    } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("La IA no generó un JSON válido.");
        parsedData = JSON.parse(match[0]);
    }

    return NextResponse.json(parsedData);

  } catch (err: any) {
    console.error("Error scheduler:", err);
    return NextResponse.json(
      { error: err.message || "Error generando mensajes." },
      { status: 500 }
    );
  }
}
