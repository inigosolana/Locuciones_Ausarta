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
    } = body;

    if (!company || !scheduleGroups || scheduleGroups.length === 0) {
      return NextResponse.json(
        { error: "Falta el nombre de la empresa o los horarios." },
        { status: 400 }
      );
    }

    // 1. LIMPIEZA DE DATOS (CRÍTICO PARA EVITAR EL ERROR)
    // Si no hay horario partido, eliminamos las horas de la tarde para que la IA no las vea.
    const sanitizedSchedule = scheduleGroups.map((g: any) => {
      if (!g.splitSchedule) {
        // Desestructuramos para excluir openTime2 y closeTime2
        const { openTime2, closeTime2, ...rest } = g;
        return rest;
      }
      return g;
    });

    const scheduleJson = JSON.stringify(sanitizedSchedule);

    // 2. MAPEO DE IDIOMA
    const langPromptMap: Record<string, string> = {
      castellano: "Spanish",
      euskera: "Basque (Euskera)",
      gallego: "Galician",
      ingles: "English",
    };
    const targetLang = langPromptMap[language] || "Spanish";

    // 3. INSTRUCCIONES ESPECÍFICAS
    let insideInstructions = "";
    if (insideType === "welcome") {
      insideInstructions = `Generate a simple welcome message: "Thanks for contacting ${company}. We will attend you shortly." (Translated to ${targetLang}).`;
    } else {
      const rawOptions = ivrOptions || "1. Info";
      insideInstructions = `
        Generate an IVR menu structure.
        1. Brief greeting for ${company}.
        2. Read these options naturally: """${rawOptions}""".
        RULES:
        - Do NOT say "please hold" or "we will attend you".
        - Just the greeting and the options.
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
      Target Language: ${targetLang}

      SCHEDULE_DATA (JSON):
      ${scheduleJson}

      TASK:
      Generate a JSON object with keys: ${jsonKeys}.
      The content of the messages must be in ${targetLang}.

      *** CRITICAL FORMATTING RULES (STRICT) ***:
      1. **CASING (Minúsculas)**: Use "Sentence case". 
         - Write mostly in lowercase.
         - Only capitalize the very first letter of a sentence and Proper Nouns (names). 
         - NEVER capitalize whole words.
      
      2. **NATURAL TIME (Horas naturales)**: 
         - Convert digital times into spoken words (NO digits).
         - X:00 -> "en punto" / "o'clock".
         - X:30 -> "y media" / "half past" / "eta erdiak".
         - X:15 -> "y cuarto" / "quarter past".
         - X:45 -> "menos cuarto" / "quarter to".
         - Example: "09:30" => "nueve y media".
      
      3. **SCHEDULE LOGIC**:
         - Use ONLY the times present in SCHEDULE_DATA.
         - If a group has NO "openTime2", it is NOT split schedule. Do not invent afternoon hours.

      LOGIC FOR MESSAGES:
      
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
