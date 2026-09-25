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

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== "null" && !ALLOWED_ORIGINS.has(origin)) {
    return new Response("Origin not allowed", { status: 403, headers: cors });
  }

  try {
    const raw = Buffer.from(await req.arrayBuffer());
    const html = req.headers.get("content-encoding") === "gzip"
      ? gunzipSync(raw).toString("utf8")
      : raw.toString("utf8");

    if (!html.includes("integral-print-stage")) {
      return new Response("Estágio de impressão ausente", { status: 400, headers: cors });
    }

    const browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });

      return new Response(pdf, {
        headers: {
          ...cors,
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename=clinimers-tcpe.pdf",
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    return new Response("Falha ao gerar PDF: " + (e?.message || String(e)), {
      status: 500,
      headers: cors,
    });
  }
};

export const config: Config = { path: "/api/render-pdf" };
