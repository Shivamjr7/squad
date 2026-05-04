// Supabase Edge Function (Deno). Triggered by pg_cron via net.http_post once
// per hour. Finds confirmed plans starting 1-2h from now with no
// reminder_sent_at, atomically claims them, then fans out one email per plan
// to the IN voters.
//
// Auth: requires Authorization: Bearer <CRON_SECRET>. The anon key is public
// and not used here — pg_cron passes the custom secret instead.
//
// Why no shared code with src/lib/email.ts: this runs on Deno, the Next.js
// app runs on Node. Different runtime, different deploy unit. The email HTML
// is small enough that a small duplication is cheaper than building a shared
// package. Keep them in sync if the design changes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Squad <onboarding@resend.dev>";
const EMAIL_TIMEZONE = Deno.env.get("EMAIL_TIMEZONE") || "UTC";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── helpers ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimeShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: EMAIL_TIMEZONE,
  }).format(new Date(iso));
}

function formatTimeLong(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: EMAIL_TIMEZONE,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function buildReminderEmail(args: {
  planTitle: string;
  circleName: string;
  startsAt: string;
  location: string | null;
  whosIn: string[];
  planUrl: string;
}): { subject: string; html: string } {
  const short = formatTimeShort(args.startsAt);
  const long = formatTimeLong(args.startsAt);
  const subject =
    `[${args.circleName}] Tonight at ${short} — ${args.planTitle}`;
  const whosInLine = args.whosIn.length > 0 ? args.whosIn.join(", ") : "You";
  const preheader = `${args.planTitle} starts at ${short}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:${FONT_STACK};color:#0f172a">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
        <tr><td style="padding:20px 24px 8px;font-weight:600;font-size:14px;color:#475569;letter-spacing:.02em">Squad</td></tr>
        <tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.55">
          <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;line-height:1.3">${esc(args.planTitle)}</h1>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">in ${esc(args.circleName)}</p>
          <p style="margin:0 0 16px;color:#0f172a;font-size:15px">Starting in about an hour. See you there.</p>
          <p style="margin:4px 0;font-size:14px;color:#475569"><span style="color:#94a3b8">When</span> ${esc(long)}</p>
          ${args.location ? `<p style="margin:4px 0;font-size:14px;color:#475569"><span style="color:#94a3b8">Where</span> ${esc(args.location)}</p>` : ""}
          <p style="margin:4px 0;font-size:14px;color:#475569"><span style="color:#94a3b8">Who's in</span> ${esc(whosInLine)}</p>
          <p style="margin:20px 0 4px"><a href="${esc(args.planUrl)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Open plan →</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { subject, html };
}

async function sendOneEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("[remind-plans] RESEND_API_KEY not set; skipping", {
      to,
      subject,
    });
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[remind-plans] resend rejected", {
        to,
        subject,
        status: res.status,
        body,
      });
    }
  } catch (err) {
    console.error("[remind-plans] send threw", {
      to,
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── handler ────────────────────────────────────────────────────────────

type ClaimedPlan = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  circle_id: string;
};

type VoterJoinRow = {
  users: { display_name: string | null; email: string | null } | null;
};

Deno.serve(async (req) => {
  if (!CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const lower = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const upper = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  // Atomic claim. Concurrent firings see reminder_sent_at flip and skip.
  const { data: claimed, error: claimErr } = await supabase
    .from("plans")
    .update({ reminder_sent_at: now.toISOString() })
    .eq("status", "confirmed")
    .gte("starts_at", lower)
    .lt("starts_at", upper)
    .is("reminder_sent_at", null)
    .select("id, title, starts_at, location, circle_id")
    .returns<ClaimedPlan[]>();

  if (claimErr) {
    console.error("[remind-plans] claim failed", claimErr);
    return new Response(
      JSON.stringify({ error: "claim failed", detail: claimErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!claimed || claimed.length === 0) {
    console.log("[remind-plans]", { reminded: 0, at: now.toISOString() });
    return new Response(JSON.stringify({ reminded: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let reminded = 0;
  for (const plan of claimed) {
    try {
      const { data: circle } = await supabase
        .from("circles")
        .select("slug, name")
        .eq("id", plan.circle_id)
        .single();
      if (!circle) continue;

      const { data: voterRows } = await supabase
        .from("votes")
        .select("users(display_name, email)")
        .eq("plan_id", plan.id)
        .eq("status", "in")
        .returns<VoterJoinRow[]>();

      const rows = voterRows ?? [];
      const recipients = rows
        .map((v) => v.users?.email)
        .filter((e): e is string => Boolean(e));
      if (recipients.length === 0) continue;

      const whosIn = rows
        .map((v) => v.users?.display_name)
        .filter((n): n is string => Boolean(n));

      const planUrl = `${APP_URL}/c/${circle.slug}/p/${plan.id}`;
      const { subject, html } = buildReminderEmail({
        planTitle: plan.title,
        circleName: circle.name,
        startsAt: plan.starts_at,
        location: plan.location,
        whosIn,
        planUrl,
      });

      await Promise.all(
        recipients.map((to) => sendOneEmail(to, subject, html)),
      );
      reminded += 1;
    } catch (err) {
      console.error("[remind-plans] per-plan failed", {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[remind-plans]", { reminded, at: now.toISOString() });
  return new Response(JSON.stringify({ reminded }), {
    headers: { "Content-Type": "application/json" },
  });
});
