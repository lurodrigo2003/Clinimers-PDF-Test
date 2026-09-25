import type { Context, Config } from "@netlify/functions";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { gunzipSync } from "node:zlib";

const ALLOWED_ORIGINS = new Set([
  "https://www.clinimers.com.br",
  "https://clinimers.com.br",
  "https://clinimers-tcp-integral-v155-test.netlify.app",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = (!origin || origin === "null" || ALLOWED_ORIGINS.has(origin)) ? (origin || "*") : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Content-Encoding",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default async (req: Request, _context: Context) => {
  const cors = corsHeaders(req);
  const origin = req.headers.get("origin") || "";
  console.log("[render-pdf] inicio", { method: req.method, origin, contentEncoding: req.headers.get("content-encoding") || "" });

  if (req.method === "OPTIONS") {
    console.log("[render-pdf] preflight OPTIONS OK");
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    console.warn("[render-pdf] metodo nao permitido", req.method);
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  if (origin && origin !== "null" && !ALLOWED_ORIGINS.has(origin)) {
    console.warn("[render-pdf] origem bloqueada", origin);
    return new Response("Origin not allowed", { status: 403, headers: cors });
  }

  let browser: any = null;
  try {
    console.log("[render-pdf] lendo corpo da requisicao");
    const raw = Buffer.from(await req.arrayBuffer());
    console.log("[render-pdf] corpo recebido", { bytes: raw.length });

    const html = req.headers.get("content-encoding") === "gzip"
      ? gunzipSync(raw).toString("utf8")
      : raw.toString("utf8");
    console.log("[render-pdf] HTML preparado", { chars: html.length, gzip: req.headers.get("content-encoding") === "gzip" });

    if (!html.includes("integral-print-stage")) {
      console.error("[render-pdf] integral-print-stage ausente");
      return new Response("Estágio de impressão ausente", { status: 400, headers: cors });
    }

    const executablePath = await chromium.executablePath();
    console.log("[render-pdf] chromium preparado", { executablePath });

    browser = await playwright.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
    console.log("[render-pdf] navegador iniciado");

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    console.log("[render-pdf] pagina criada");

    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
    console.log("[render-pdf] HTML carregado no Chromium");

    await page.emulateMedia({ media: "print" });
    console.log("[render-pdf] modo de impressao aplicado");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log("[render-pdf] PDF gerado", { bytes: pdf.length });

    return new Response(pdf, {
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=clinimers-tcpe.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[render-pdf] ERRO", {
      name: e?.name || "",
      message: e?.message || String(e),
      stack: e?.stack || "",
    });
    return new Response("Falha ao gerar PDF: " + (e?.message || String(e)), {
      status: 500,
      headers: cors,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("[render-pdf] navegador fechado");
      } catch (closeError: any) {
        console.error("[render-pdf] erro ao fechar navegador", closeError?.message || String(closeError));
      }
    }
  }
};

export const config: Config = { path: "/api/render-pdf" };
