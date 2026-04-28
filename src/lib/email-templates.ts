// Plain inline-styled HTML for transactional emails. No template engine, no
// React Email — three templates, each ~30-50 lines, kept in one file so the
// shared shell + escape helper sits next to the templates that use them.
//
// All user-supplied strings (plan titles, comment bodies, names) MUST flow
// through `esc` before interpolation. Dropping it on a single field is enough
// for an HTML-injection bug, so do not skip it.

export type EmailContent = { subject: string; html: string };

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ShellArgs = {
  preheader: string;
  bodyHtml: string;
  manageUrl: string;
};

function shell({ preheader, bodyHtml, manageUrl }: ShellArgs): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:${FONT_STACK};color:#0f172a">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
        <tr><td style="padding:20px 24px 8px;font-weight:600;font-size:14px;color:#475569;letter-spacing:.02em">Squad</td></tr>
        <tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
      </table>
      <p style="font-size:12px;color:#64748b;padding:16px 0 0;margin:0">
        <a href="${esc(manageUrl)}" style="color:#64748b;text-decoration:underline">Manage notifications</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${esc(label)}</a>`;
}

function metaLine(label: string, value: string): string {
  return `<p style="margin:4px 0;font-size:14px;color:#475569"><span style="color:#94a3b8">${esc(label)}</span> ${esc(value)}</p>`;
}

const TYPE_LABEL: Record<string, string> = {
  eat: "Eat",
  play: "Play",
  chai: "Chai",
  "stay-in": "Stay in",
  other: "Other",
};

export function newPlanTemplate(args: {
  planTitle: string;
  circleName: string;
  planType: string;
  planTimeFormatted: string;
  location: string | null;
  creatorName: string;
  planUrl: string;
  manageUrl: string;
}): EmailContent {
  const subject = `New plan in ${args.circleName}: ${args.planTitle}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.3">${esc(args.planTitle)}</h1>
    <p style="margin:0 0 16px;color:#475569;font-size:14px">${esc(args.creatorName)} added a new plan to ${esc(args.circleName)}.</p>
    ${metaLine("When", args.planTimeFormatted)}
    ${metaLine("Type", TYPE_LABEL[args.planType] ?? args.planType)}
    ${args.location ? metaLine("Where", args.location) : ""}
    <p style="margin:20px 0 4px">${ctaButton(args.planUrl, "Vote now →")}</p>
  `;
  return {
    subject,
    html: shell({
      preheader: `${args.creatorName} just proposed ${args.planTitle}`,
      bodyHtml: body,
      manageUrl: args.manageUrl,
    }),
  };
}

export function newCommentTemplate(args: {
  commenterName: string;
  commentBody: string;
  planTitle: string;
  planUrl: string;
  manageUrl: string;
}): EmailContent {
  const snippet = args.commentBody.length > 60
    ? `${args.commentBody.slice(0, 60).trimEnd()}…`
    : args.commentBody;
  const subject = `${args.commenterName}: "${snippet}"`;
  const body = `
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8">On ${esc(args.planTitle)}</p>
    <p style="margin:0 0 16px;font-size:15px;font-weight:600">${esc(args.commenterName)} said:</p>
    <blockquote style="margin:0 0 20px;padding:12px 16px;background:#f1f5f9;border-radius:8px;border-left:3px solid #0f172a;white-space:pre-wrap;word-break:break-word">${esc(args.commentBody)}</blockquote>
    <p style="margin:0">${ctaButton(args.planUrl, "Open the discussion →")}</p>
  `;
  return {
    subject,
    html: shell({
      preheader: `${args.commenterName} commented on ${args.planTitle}`,
      bodyHtml: body,
      manageUrl: args.manageUrl,
    }),
  };
}

export function planCancelledTemplate(args: {
  cancellerName: string;
  planTitle: string;
  planTimeFormatted: string;
  planUrl: string;
  manageUrl: string;
}): EmailContent {
  const subject = `Cancelled: ${args.planTitle}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.3;text-decoration:line-through;color:#64748b">${esc(args.planTitle)}</h1>
    <p style="margin:0 0 16px;color:#0f172a;font-size:15px">${esc(args.cancellerName)} cancelled <strong>${esc(args.planTitle)}</strong>, scheduled for ${esc(args.planTimeFormatted)}.</p>
    <p style="margin:20px 0 4px">${ctaButton(args.planUrl, "See what happened →")}</p>
  `;
  return {
    subject,
    html: shell({
      preheader: `${args.cancellerName} called off ${args.planTitle}`,
      bodyHtml: body,
      manageUrl: args.manageUrl,
    }),
  };
}
