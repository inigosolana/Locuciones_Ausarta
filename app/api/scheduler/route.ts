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
      scheduleGroups, // <--- CAMBIO: Recibimos un array de grupos en vez de horas sueltas
      insideType,
      ivrOptions,
      includeVoicemail,
    } = body;

    // Validación básica
    if (!company || !scheduleGroups || scheduleGroups.length === 0) {
      return NextResponse.json(
        { error: "Empresa y horarios son requeridos" },
        { status: 400 }
      );
    }

    // --- CONSTRUCCIÓN DEL TEXTO DEL HORARIO PARA EL PROMPT ---
    // Recorremos cada grupo y generamos una frase (ej: "Lunes, Martes: 09:00 a 18:00")
    
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
      
      return `${daysText}: ${hoursText}`;
    });

    const fullScheduleText = scheduleDescriptions.join(". \n");
    // ---------------------------------------------------------

    // Lógica para mensaje "Dentro de Horario" (Igual que antes)
    let insideInstructions = "";
    if (insideType === "welcome") {
      insideInstructions = `Solo debe decir: "Gracias por contactar con ${company}. Enseguida le atenderemos."`;
    } else if (insideType === "ivr") {
      // ... (Mismo código que tenías para IVR) ...
      let formattedOptions = "";
      if (ivrOptions) {
        const lines = ivrOptions.split("\n").filter((line: string) => line.trim());
        formattedOptions = lines.map((line: string) => line).join(". "); // Simplificado para el ejemplo
      }
      insideInstructions = `Primero un saludo breve: "Gracias por llamar a ${company}". Luego, leer claramente cada opción: ${formattedOptions}`;
    }

    // Lógica mensaje "Fuera de Horario"
    let voicemailInstruction = includeVoicemail 
      ? `Por favor, deje un mensaje y se pondrá en contacto con usted lo antes posible.` 
      : `No hay línea telefónica disponible. Por favor, intente nuevamente más tarde.`;

    let jsonKeys = '"messageInside" y "messageOutside"';
    let voicemailPromptInfo = "";
    
    if (includeVoicemail) {
      jsonKeys += ' y "messageVoicemail"';
      voicemailPromptInfo = `
messageVoicemail (instrucciones de buzón de voz - Máx 15 segundos):
- Saludo breve, y nombre de empresa.
- Mencionar resumidamente el horario general:
- Decir "Si desea dejar un mensaje, hágalo después de que suene la señal"
${fullScheduleText}
- Mensaje profesional.`;
    }

    const userPrompt = `Eres un experto en redacción de guiones para sistemas IVR profesionales.

Empresa: ${company}
HORARIOS DETALLADOS:
${fullScheduleText}

Genera un JSON válido con las claves: ${jsonKeys}.

REGLAS DE FORMATO OBLIGATORIAS:
1. Escribe TODOS los números en letra.
2. Escribe TODAS las horas en letra y en formato natural hablado (ej: "las dos de la tarde").
3. NO uses formato 24h.

messageInside (empresa ABIERTA - Máx 25 segundos):
${insideInstructions}

messageOutside (empresa CERRADA - Máx 25 segundos):
- Saludo breve y profesional.
- Disculparse por estar cerrado.
- Informar del horario de atención RESUMIDO de forma natural (ej: "Atendemos de lunes a jueves de tal a cual, y los viernes de tal a cual"). Usa los datos de HORARIOS DETALLADOS.
- Agradecer por llamar.
${voicemailPromptInfo}

Responde SOLO con JSON válido.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("Sin contenido de OpenAI");

    // ... (Mismo código de parseo JSON que tenías) ...
    let parsedData;
    try {
        parsedData = JSON.parse(content);
    } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No se encontró JSON");
        parsedData = JSON.parse(match[0]);
    }

    return NextResponse.json(parsedData);

  } catch (err: any) {
    console.error("Error scheduler:", err.message);
    return NextResponse.json({ error: err.message || "Error" }, { status: 500 });
  }
}
