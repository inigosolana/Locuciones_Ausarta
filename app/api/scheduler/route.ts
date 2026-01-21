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

    // --- 1. PROCESAR HORARIOS PARA LA IA ---
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

    // --- 2. PREPARAR INSTRUCCIONES ---
    
    // Mensaje DENTRO de horario
    let insideInstructions = "";
    if (insideType === "welcome") {
      insideInstructions = `Solo debe decir: "Gracias por contactar con ${company}. Enseguida le atenderemos."`;
    } else if (insideType === "ivr") {
      let formattedOptions = ivrOptions || "Espere para ser atendido.";
      insideInstructions = `Primero un saludo breve: "Gracias por llamar a ${company}". Luego, leer claramente estas opciones: "${formattedOptions}".`;
    }

    // Mensaje BUZÓN DE VOZ (Aquí está el cambio que pediste)
    let voicemailPromptInfo = "";
    let jsonKeys = '"messageInside" y "messageOutside"';

    if (includeVoicemail) {
      jsonKeys += ' y "messageVoicemail"';
      voicemailPromptInfo = `
messageVoicemail (instrucciones buzón - Máx 20s):
1. Saludo indicando claramente que han llamado a ${company}.
2. Informar del horario de atención: "${fullScheduleText}".
3. FINALMENTE, decir la frase: "Por favor, deje un mensaje después de la señal".
- Tono profesional.
`;
    }

    // --- 3. PROMPT PARA GPT ---
    const userPrompt = `Eres un experto en guiones IVR.
Empresa: ${company}
HORARIOS COMPLETOS:
${fullScheduleText}

Genera un JSON válido con las claves: ${jsonKeys}.

REGLAS DE FORMATO (OBLIGATORIAS):
1. Escribe TODOS los números en letra (ej: "uno" no "1").
2. Horas en formato natural hablado (ej: "las dos de la tarde").
3. NO uses formato 24h.

messageInside (Empresa ABIERTA - Máx 25s):
${insideInstructions}

messageOutside (Empresa CERRADA - Máx 25s):
- Saludo breve.
- Disculparse por estar cerrado.
- Informar del horario de atención de forma natural.
- Agradecer y despedirse.
${voicemailPromptInfo}

Responde SOLO con JSON válido.`;

    // --- 4. LLAMADA A OPENAI ---
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
      { error: err.message || "Error interno." },
      { status: 500 }
    );
  }
}
