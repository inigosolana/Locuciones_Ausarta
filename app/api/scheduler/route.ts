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
    } = body;

    // Validación básica
    if (!company || !scheduleGroups || scheduleGroups.length === 0) {
      return NextResponse.json(
        { error: "Falta el nombre de la empresa o los horarios." },
        { status: 400 }
      );
    }

    // --- 1. PROCESAR HORARIOS (Texto legible para la IA) ---
    const dayLabels: Record<string, string> = {
      monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles",
      thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo",
    };

    const scheduleDescriptions = scheduleGroups.map((group: any) => {
      const daysText = group.days.map((d: string) => dayLabels[d] || d).join(", ");
      let hoursText = "";
      if (group.splitSchedule) {
         hoursText = `de ${group.openTime1} a ${group.closeTime1} y de ${group.openTime2} a ${group.closeTime2}`;
      } else {
         hoursText = `de ${group.openTime1} a ${group.closeTime1}`;
      }
      return `Los días ${daysText} abrimos ${hoursText}`;
    });

    const fullScheduleText = scheduleDescriptions.join(". \n");

    // --- 2. INSTRUCCIONES PARA "DENTRO DE HORARIO" (IVR vs BIENVENIDA) ---
    let insideInstructions = "";
    let insideTitleLabel = ""; // Para cambiar el título en el prompt
    
    if (insideType === "welcome") {
      insideTitleLabel = "BIENVENIDA (Horario de Apertura)";
      insideInstructions = `Solo debe decir: "Gracias por contactar con ${company}. Enseguida le atenderemos."`;
    } else if (insideType === "ivr") {
      insideTitleLabel = "IVR (Menú de opciones)";
      const rawOptions = ivrOptions || "1. Información";
      insideInstructions = `
        Estructura OBLIGATORIA para messageInside (Modo IVR):
        1. Saludo breve: "Gracias por llamar a ${company}".
        2. Leer las siguientes opciones convertidas a formato hablado (Ej: "Para ventas, pulse uno"):
        Opciones a leer: """${rawOptions}"""
        
        IMPORTANTE (Restricciones):
        - NO digas "manténgase a la espera".
        - NO digas "en breve le atenderemos".
        - Termina justo después de decir la última opción.
      `;
    }

    // --- 3. INSTRUCCIONES PARA "BUZÓN DE VOZ" ---
    let voicemailPromptInfo = "";
    let jsonKeys = '"messageInside" y "messageOutside"';

    if (includeVoicemail) {
      jsonKeys += ' y "messageVoicemail"';
      voicemailPromptInfo = `
messageVoicemail (Instrucciones ESTRICTAS - Máx 20s):
Debes seguir EXACTAMENTE este orden:
1. Saludo: "Ha contactado con ${company}."
2. Horario: Informar resumidamente del horario de apertura (${fullScheduleText}).
3. Cierre: "Por favor, deje su mensaje después de la señal."
`;
    }

    // --- 4. CONSTRUCCIÓN DEL PROMPT ---
    const userPrompt = `Eres un experto en guiones telefónicos (IVR).
Empresa: ${company}
HORARIOS DETALLADOS:
${fullScheduleText}

Genera un JSON válido con las claves: ${jsonKeys}.

REGLAS DE FORMATO (OBLIGATORIAS):
- Escribe TODOS los números en letra (ej: "pulse uno", "las dos de la tarde").
- NO uses formato 24h (14:00 -> "las dos").
- NO uses markdown. Texto plano.

messageInside (${insideTitleLabel} - Máx 45s):
${insideInstructions}

messageOutside (CERRADO - Máx 25s):
- Saludo breve y profesional.
- Indicar claramente que la empresa está cerrada.
- Informar del horario de atención de forma natural hablada.
- Despedida cordial.
${voicemailPromptInfo}

Responde SOLO con el JSON raw.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.7,
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
