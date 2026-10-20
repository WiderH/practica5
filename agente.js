import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `Eres un Ingeniero Frontend y Experto en UX/UI.
Tu objetivo es traducir los requerimientos del usuario en interfaces funcionales usando las herramientas de Stitch.
Reglas:
1. Analiza el requerimiento y decide qué herramientas usar.
2. Si una herramienta falla, lee el error, ajusta los parámetros y vuelve a intentarlo.
3. Informa al usuario de tus acciones de forma concisa.`;

const USER_PROMPT = `Crea un proyecto nuevo y genera una pantalla de inicio de sesión con un botón azul oscuro, el cual reciba un usuario y password, así como las opciones de registrarse, olvidé mi contraseña y recordar sesión siempre.`;

async function iniciarAgente() {
    console.log("Iniciando conexión con Stitch MCP...");

    const isWin = process.platform === "win32";
    const command = isWin ? "cmd.exe" : "npx";
    const args = isWin
        ? [
              "/c",
              "npx",
              "-y",
              "mcp-remote",
              "https://stitch.googleapis.com/mcp",
              "--header",
              `X-Goog-Api-Key:${process.env.STITCH_API_KEY}`
          ]
        : [
              "-y",
              "mcp-remote",
              "https://stitch.googleapis.com/mcp",
              "--header",
              `X-Goog-Api-Key:${process.env.STITCH_API_KEY}`
          ];

    const transport = new StdioClientTransport({
        command: command,
        args: args,
        env: {
            ...process.env
        }
    });

    const mcpClient = new Client(
        { name: "agente-stitch", version: "1.0" },
        { capabilities: {} }
    );
    await mcpClient.connect(transport);

    const mcpTools = await mcpClient.listTools();
    const openRouterTools = mcpTools.tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }
    }));

    console.log(`Conexión exitosa. ${openRouterTools.length} herramientas disponibles.`);

    const mensajes = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT }
    ];

    let tareaCompletada = false;

    while (!tareaCompletada) {
        const respuesta = await openai.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: mensajes,
            tools: openRouterTools,
            temperature: 0.1
        });

        const mensajeModelo = respuesta.choices[0].message;
        mensajes.push(mensajeModelo);

        if (mensajeModelo.tool_calls && mensajeModelo.tool_calls.length > 0) {
            for (const toolCall of mensajeModelo.tool_calls) {
                console.log(`Acción del Agente -> Ejecutando: ${toolCall.function.name}`);
                try {
                    const argumentos = JSON.parse(toolCall.function.arguments);

                    const resultado = await mcpClient.callTool(
                        {
                            name: toolCall.function.name,
                            arguments: argumentos
                        },
                        undefined,
                        { timeout: 300000 }
                    );

                    let textoResultado = JSON.stringify(resultado);
                    if (textoResultado.length > 2500) {
                        textoResultado = textoResultado.substring(0, 2500) + "... [Contenido HTML/Imagen truncado para ahorrar tokens. Pantalla creada con éxito]";
                    }

                    mensajes.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: textoResultado
                    });
                    console.log("Acción completada con éxito.");
                } catch (error) {
                    console.log(`Error en la herramienta: ${error.message}. Informando al agente para que corrija...`);
                    mensajes.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`
                    });
                }
            }
        } else {
            console.log(`\nAgente: ${mensajeModelo.content}`);
            tareaCompletada = true;
        }
    }

    await mcpClient.close();
    process.exit(0);
}

iniciarAgente().catch(console.error);