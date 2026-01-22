// app/api/scheduler/route.ts
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
      language = "castellano", // Nuevo campo
    } = body;

    if (!company || !scheduleGroups || scheduleGroups.length === 0) {
      return NextResponse.json(
        { error: "Falta el nombre de la empresa o los horarios." },
        { status: 400 }
      );
    }

    // Mapeo de idioma para el Prompt
    const langPromptMap: Record<string, string> = {
      castellano: "Spanish",
      euskera: "Basque (Euskera)",
      gallego: "Galician",
      ingles: "English",
    };
    const targetLang = langPromptMap[language] || "Spanish";

    // Pasamos los horarios en JSON puro para que la IA los interprete en el idioma correcto
    const scheduleJson = JSON.stringify(scheduleGroups);

    // --- CONSTRUCCIÓN DE INSTRUCCIONES ---
    
    // Instrucciones IVR / Bienvenida
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

    // Instrucciones Buzón de voz
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

    // --- PROMPT MAESTRO ---
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
         - NEVER capitalize whole words or the start of every word.
         - Example: "hola, gracias por llamar a Ausarta." (Correct) vs "Hola, Gracias Por Llamar A Ausarta" (Incorrect).
      
      2. **NATURAL TIME (Horas naturales)**: 
         - Convert digital times (09:30, 15:45) into spoken words.
         - **X:30** must be "y media" / "half past" / "eta erdiak". NEVER say "treinta".
         - **X:15** must be "y cuarto" / "quarter past" / "eta laurden".
         - **X:45** must be "menos cuarto" / "quarter to" / "laurden gutxi".
         - Example (ES): "nueve y media", "tres menos cuarto de la tarde".
         - Example (EU): "bederatzi eta erdiak", "hirurak laurden gutxi".
         - Do NOT use digits like "9:30". Use always letters.

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
      temperature: 0.5, // Bajamos temp para que respete mejor las reglas
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("OpenAI no devolvió contenido.");

    let parsedData;
    try {
        parsedData = JSON.parse(content);
    } catch {
        // Intento de fallback si devuelve markdown ```json ... ```
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
