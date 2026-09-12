import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://tiveltext.tivalsdeveloper.site",
  "https://tiveltext-docs.netlify.app",
  "https://tivalsdeveloper-oss.github.io",
  "https://tivalsdeveloper.github.io",
]);

const GUIDES: Record<string, { title: string; file: string }> = {
  pytorch: { title: "PyTorch on CPU — 30 Lessons", file: "learn-pytorch-on-cpu-30-lessons.pdf" },
  pytest: { title: "pytest — Beginner to Advanced", file: "learn-pytest-beginner-to-advanced.pdf" },
};

function cors(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin || "null");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (Number(req.headers.get("content-length") ?? "0") > 4096) return json({ error: "Request too large" }, 413, origin);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid request" }, 400, origin); }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Service unavailable" }, 503, origin);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (payload.action === "visit") {
    const candidate = String(payload.visitorId ?? "");
    const visitorId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : crypto.randomUUID();
    let referrerHost: string | null = null;
    try { if (payload.referrer) referrerHost = new URL(String(payload.referrer)).hostname.slice(0, 180); } catch { /* ignore invalid referrer */ }
    const { error } = await admin.from("page_visits").insert({
      visitor_id: visitorId,
      path: String(payload.path ?? "/").slice(0, 180),
      referrer_host: referrerHost,
      user_agent_family: (req.headers.get("user-agent") ?? "unknown").slice(0, 80),
    });
    return error ? json({ error: "Could not record visit" }, 500, origin) : json({ ok: true, visitorId }, 200, origin);
  }

  if (payload.action !== "subscribe") return json({ error: "Unknown action" }, 400, origin);

  const email = String(payload.email ?? "").trim().toLowerCase();
  const guideSlug = String(payload.guide ?? "");
  const guide = GUIDES[guideSlug];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ error: "Enter a valid email address" }, 400, origin);
  if (!guide) return json({ error: "Choose a valid guide" }, 400, origin);

  const { data: existing } = await admin.from("subscribers").select("last_requested_at").eq("email", email).maybeSingle();
  if (existing?.last_requested_at && Date.now() - new Date(existing.last_requested_at).getTime() < 30_000) {
    return json({ error: "Please wait a moment before requesting another email." }, 429, origin);
  }

  const { data: subscriber, error: subscriberError } = await admin.from("subscribers").upsert({
    email,
    first_guide: guideSlug,
    confirmed_at: new Date().toISOString(),
    last_requested_at: new Date().toISOString(),
  }, { onConflict: "email" }).select("id").single();
  if (subscriberError || !subscriber) return json({ error: "Could not save your request" }, 500, origin);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "TivelText <downloads@tivalsdeveloper.site>";
  if (!resendKey) return json({ error: "Email delivery is not configured yet." }, 503, origin);

  const downloadUrl = `https://tiveltext.tivalsdeveloper.site/guides/${guide.file}`;
  const mailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json", "idempotency-key": `tiveltext-${subscriber.id}-${guideSlug}-${Math.floor(Date.now()/30000)}` },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Your free guide: ${guide.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#10251e"><h1 style="font-size:28px">Your TivelText guide is ready</h1><p>Thanks for learning with tivalsdeveloper.</p><p><strong>${guide.title}</strong> is attached to this email. You can also use the button below:</p><p style="margin:28px 0"><a href="${downloadUrl}" style="background:#25d895;color:#071510;padding:14px 20px;text-decoration:none;border-radius:6px;font-weight:bold">Download your PDF</a></p><p style="color:#63766f;font-size:13px">If the button does not work, copy this link: ${downloadUrl}</p></div>`,
      text: `Your TivelText guide is ready. Download ${guide.title}: ${downloadUrl}`,
      attachments: [{ filename: guide.file, path: downloadUrl }],
      tags: [{ name: "guide", value: guideSlug }],
    }),
  });

  if (!mailResponse.ok) {
    console.error("Resend delivery failed", mailResponse.status, await mailResponse.text());
    return json({ error: "We saved your request but could not send the email. Please try again shortly." }, 502, origin);
  }

  const { error: requestError } = await admin.from("download_requests").insert({ subscriber_id: subscriber.id, guide_slug: guideSlug });
  if (requestError) console.error("Download request logging failed", requestError.message);
  return json({ ok: true, message: "Your PDF has been emailed." }, 200, origin);
});
