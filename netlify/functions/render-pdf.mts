import type { Context, Config } from "@netlify/functions";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { gunzipSync } from "node:zlib";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const raw = Buffer.from(await req.arrayBuffer());
    const html = req.headers.get("content-encoding") === "gzip" ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    if (!html.includes("integral-print-stage")) return new Response("Estágio de impressão ausente", { status: 400 });
    const browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=clinimers-tcpe.pdf", "Cache-Control": "no-store" } });
    } finally { await browser.close(); }
  } catch (e: any) {
    return new Response("Falha ao gerar PDF: " + (e?.message || String(e)), { status: 500 });
  }
};

export const config: Config = { path: "/api/render-pdf" };
