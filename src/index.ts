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

// Phone number validation function
function validatePhoneNumber(phone: string): {
  isValid: boolean;
  error?: string;
} {
  if (!phone) {
    return { isValid: false, error: "Phone number is required" };
  }

  // Remove spaces and special characters except +
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, "");

  // Check if it starts with +
  if (!cleanPhone.startsWith("+")) {
    return {
      isValid: false,
      error: "Phone number must start with country code (e.g., +1234567890)",
    };
  }

  // Check if it has the right format: + followed by 10-15 digits
  const phoneRegex = /^\+[1-9]\d{9,14}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return {
      isValid: false,
      error:
        "Invalid phone number format. Use +[country code][number] (10-15 digits total)",
    };
  }

  return { isValid: true };
}

app.post("/alert", async (c) => {
  try {
    const { to } = await c.req.json();

    // Validate phone number
    const validation = validatePhoneNumber(to);
    if (!validation.isValid) {
      return c.json(
        {
          status: "error",
          message: validation.error,
        },
        400,
      );
    }

    // Clean the phone number
    const cleanPhone = to.replace(/[\s\-\(\)]/g, "");

    const data = await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${cleanPhone}`,
      body: "⚠️ Alert: Please respond YES or NO",
    });

    //+2347035101279

    console.log("Message sent:", data);

    return c.json({ status: "sent", to: cleanPhone });
  } catch (error: any) {
    console.error("Error sending alert:", error);

    // Handle specific Twilio errors
    let errorMessage = "Failed to send alert";
    if (error.code === 21211) {
      errorMessage = "Invalid phone number";
    } else if (error.code === 63003) {
      errorMessage = "Phone number is not a valid WhatsApp number";
    } else if (error.code === 21408) {
      errorMessage = "Permission to send messages to this number is required";
    } else if (error.message) {
      errorMessage = error.message;
    }

    return c.json(
      {
        status: "error",
        message: errorMessage,
      },
      500,
    );
  }
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
