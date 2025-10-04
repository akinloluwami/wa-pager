import { serve } from "@hono/node-server";
import { createClient } from "@libsql/client/web";
import { Hono } from "hono";
import twilio from "twilio";
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";

const db = createClient({
  url: process.env.DB_URL!,
  authToken: process.env.DB_TOKEN!,
});

const accountSid = process.env.TWILIO_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const whatsappFrom = "whatsapp:+14155238886";

const client = twilio(accountSid, authToken);

const app = new Hono();

app.get("/", (c) => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");
  return c.html(html);
});

app.post("/alert", async (c) => {
  const { to, message } = await c.req.json();

  await client.messages.create({
    from: whatsappFrom,
    to: `whatsapp:${to}`,
    body: message || "⚠️ Alert: Please respond YES or NO",
  });

  return c.json({ status: "sent", to });
});

app.post("/whatsapp-webhook", async (c) => {
  const formData = await c.req.parseBody<{ From: string; Body: string }>();
  const from = formData.From;
  const body = formData.Body?.trim().toLowerCase();

  await db.execute({
    sql: "INSERT INTO replies (user, message) VALUES (?, ?)",
    args: [from, body],
  });

  let replyMsg = "Got it. Thanks!";
  if (body.toLowerCase().includes("yes")) replyMsg = "✅ Noted: YES";
  if (body.toLowerCase().includes("no")) replyMsg = "❌ Noted: NO";

  await client.messages.create({
    from: whatsappFrom,
    to: from,
    body: replyMsg,
  });

  return c.text("ok");
});

app.get("/responses", async (c) => {
  const rs = await db.execute("SELECT * FROM replies ORDER BY created_at DESC");
  return c.json(rs.rows);
});

serve(
  {
    fetch: app.fetch,
    port: 4200,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
