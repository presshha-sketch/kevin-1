import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { Resend } from "resend";
import { storage } from "./storage";
import { insertLeadSchema, type InsertLead } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const NOTIFICATION_EMAILS = [
  "khussey@gbpproagency.com",
  "sales@gbpproagency.com",
];

async function sendLeadNotification(lead: InsertLead) {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping email notification");
    return;
  }

  const subject = `New Lead: ${lead.businessName} — ${lead.name}`;
  const html = `
    <h2>New Lead from GBP Pro Agency Website</h2>
    <table style="border-collapse:collapse;width:100%;max-width:500px;">
      <tr><td style="padding:6px 12px;font-weight:bold;">Name</td><td style="padding:6px 12px;">${lead.name}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${lead.email}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Phone</td><td style="padding:6px 12px;">${lead.phone}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Business</td><td style="padding:6px 12px;">${lead.businessName}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;">Type</td><td style="padding:6px 12px;">${lead.businessType}</td></tr>
      ${lead.website ? `<tr><td style="padding:6px 12px;font-weight:bold;">Website</td><td style="padding:6px 12px;">${lead.website}</td></tr>` : ""}
      ${lead.city ? `<tr><td style="padding:6px 12px;font-weight:bold;">City</td><td style="padding:6px 12px;">${lead.city}</td></tr>` : ""}
      ${lead.googleListingUrl ? `<tr><td style="padding:6px 12px;font-weight:bold;">Google Listing</td><td style="padding:6px 12px;">${lead.googleListingUrl}</td></tr>` : ""}
      ${lead.message ? `<tr><td style="padding:6px 12px;font-weight:bold;">Message</td><td style="padding:6px 12px;">${lead.message}</td></tr>` : ""}
    </table>
  `;

  try {
    await resend.emails.send({
      from: "GBP Pro Agency <onboarding@resend.dev>",
      to: NOTIFICATION_EMAILS,
      subject,
      html,
    });
    console.log("Lead notification email sent successfully");
  } catch (error) {
    console.error("Failed to send lead notification email:", error);
  }
}

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  app.post("/api/leads", async (req, res) => {
    try {
      const data = insertLeadSchema.parse(req.body);
      const lead = await storage.createLead(data);
      sendLeadNotification(data);
      res.status(201).json(lead);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating lead:", error);
        res.status(500).json({ message: "Failed to submit your request" });
      }
    }
  });

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ message: "Incorrect password" });
      return;
    }
    req.session.isAdmin = true;
    res.json({ success: true });
  });

  app.get("/api/admin/session", (req, res) => {
    res.json({ isAdmin: !!req.session.isAdmin });
  });

  app.get("/api/leads", async (req, res) => {
    if (!req.session.isAdmin) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    try {
      const allLeads = await storage.getLeads();
      res.json(allLeads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  return httpServer;
}
