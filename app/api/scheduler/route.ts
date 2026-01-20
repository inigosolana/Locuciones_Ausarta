import { NextResponse } from "next/server";
import OpenAI from "openai";

// Inicializar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = "You are an expert in writing IVR scripts. Generate exactly one JSON with two keys: 'messageInside' and 'messageOutside'.";

export async function POST(req: Request) {
  try {
    // Parsear body
    const body = await req.json();

    const {
      company,
      days,
      splitSchedule,
      openTime1,
      closeTime1,
      openTime2,
      closeTime2,
      insideType,
      ivrOptions,
      includeVoicemail, // Declare the variable here
    } = body;

    // Validación básica
    if (!company || !days || days.length === 0) {
      return NextResponse.json(
        { error: "Empresa y días son requeridos" },
        { status: 400 }
      );
    }

    if (!openTime1 || !closeTime1) {
      return NextResponse.json(
        { error: "Horario de apertura y cierre es requerido" },
        { status: 400 }
      );
    }

    // Formatear días
    const dayLabels: Record<string, string> = {
      monday: "lunes",
      tuesday: "martes",
      wednesday: "miércoles",
      thursday: "jueves",
      friday: "viernes",
      saturday: "sábado",
      sunday: "domingo",
    };
    const daysLabel = days.map((d) => dayLabels[d] || d).join(", ");

    // Formatear horarios
    let scheduleText = `de ${openTime1} a ${closeTime1}`;
    if (splitSchedule && openTime2 && closeTime2) {
      scheduleText += ` y de ${openTime2} a ${closeTime2}`;
    }

    // Lógica para mensaje "Dentro de Horario"
    let insideInstructions = "";
    if (insideType === "welcome") {
      insideInstructions = `Solo debe decir: "Gracias por contactar con ${company}. Enseguida le atenderemos."`;
    } else if (insideType === "ivr") {
      // Transformar las opciones a formato "Pulse X para..."
      let formattedOptions = "";
      if (ivrOptions) {
        const lines = ivrOptions.split("\n").filter((line: string) => line.trim());
        formattedOptions = lines
          .map((line: string) => {
            // Si la línea ya tiene formato "1. Opción", transformarla a "Pulse 1 para Opción"
            const match = line.match(/^\d+\.\s*(.+)$/);
            if (match) {
              const number = line.match(/^(\d+)/)?.[1];
              const text = match[1];
              return `Pulse ${number} para ${text}`;
            }
            return line;
          })
          .join(". ");
      }
      insideInstructions = `Primero un saludo breve: "Gracias por llamar a ${company}". Luego, leer claramente cada opción con tonos marcados:\n${formattedOptions}`;
    }

    // Lógica para mensaje "Fuera de Horario"
    let voicemailInstruction = "";
    if (includeVoicemail) {
      voicemailInstruction = `Por favor, deje un mensaje y se pondrá en contacto con usted lo antes posible.`;
    } else {
      voicemailInstruction = `No hay línea telefónica disponible. Por favor, intente nuevamente más tarde.`;
    }

    // Construcción del Prompt
    let jsonKeys = '"messageInside" y "messageOutside"';
    let voicemailInstructions = "";
    
    if (includeVoicemail) {
      jsonKeys += ' y "messageVoicemail"';
      voicemailInstructions = `

messageVoicemail (instrucciones de buzón de voz - Máx 15 segundos):
- Saludo breve
- Decir "Si desea dejar un mensaje, hágalo después de que suene la señal"
- Incluir el horario de apertura: ${scheduleText}
- Mensaje típico y profesional de buzón de voz
- Agradecer por llamar`;
    }

    const userPrompt = `Eres un experto en redacción de guiones para sistemas IVR profesionales.

Empresa: ${company}
Días de atención: ${daysLabel}
Horario: ${scheduleText}

Genera un JSON válido con las claves: ${jsonKeys}.

messageInside (empresa ABIERTA - Máx 25 segundos):
${insideInstructions}
- Tono profesional, claro y pausado
- Las opciones deben ser naturales y fáciles de entender
- Ejemplo formato: "Pulse 1 para hablar con Atención al Cliente. Pulse 2 para Reclamaciones."

messageOutside (empresa CERRADA - Máx 20 segundos):
- Saludo breve y profesional
- Disculparse por estar cerrado
- Informar horario exacto: ${scheduleText}
- Sugerir llamar durante horario de atención
- Agradecer por llamar
- NO mencionar buzón de voz${voicemailInstructions}

Responde SOLO con JSON válido, sin markdown ni explicaciones.`;

    // Llamada a OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;

    if (!content) {
      throw new Error("Sin contenido de OpenAI");
    }

    // Parsear JSON - extraer si es necesario
    let parsedData;
    try {
      parsedData = JSON.parse(content);
    } catch {
      // Intentar extraer JSON del texto
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No se encontró JSON en respuesta");
      parsedData = JSON.parse(match[0]);
    }

    const response: any = {
      messageInside: parsedData.messageInside || "",
      messageOutside: parsedData.messageOutside || "",
    };

    if (includeVoicemail && parsedData.messageVoicemail) {
      response.messageVoicemail = parsedData.messageVoicemail;
    }

    return NextResponse.json(response);

  } catch (err: any) {
    console.error("[v0] Error scheduler:", err.message);
    return NextResponse.json(
      { error: err.message || "Error generando mensajes" },
      { status: 500 }
    );
  }
}
