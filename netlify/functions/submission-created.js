// Netlify event-triggered function.
// Netlify runs this automatically after every verified submission to any form
// on the site (the file name "submission-created" is what wires it up).
// For the "waitlist" form it sends the person a one-time confirmation email
// through Resend (https://resend.com).
//
// Environment variables (Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY      required, a Resend key with sending access
//   WAITLIST_FROM       optional, overrides the sender shown below
//   WAITLIST_REPLY_TO   optional, overrides the reply-to address shown below

const FROM =
  process.env.WAITLIST_FROM ||
  "Stew from You Are Star Stuff <stew@youarestarstuff.com>";
const REPLY_TO = process.env.WAITLIST_REPLY_TO || "mjonsson1@gmail.com";
const SUBJECT = "Stew saw you sign up";

// The "wants" checkboxes share one field name. Netlify may hand the values
// back as an array, a single string, or one entry per box in
// ordered_human_fields, so accept all three shapes.
function wantsText(payload) {
  const data = payload.data || {};
  const fromOrdered = (payload.ordered_human_fields || [])
    .filter((f) => f && f.name === "wants" && f.value)
    .map((f) => String(f.value));

  let list;
  if (fromOrdered.length > 1) list = fromOrdered;
  else if (Array.isArray(data.wants)) list = data.wants;
  else if (data.wants) list = [String(data.wants)];
  else list = fromOrdered;

  list = list.map((s) => s.trim()).filter(Boolean);
  return list.length ? list.join(", ") : "everything";
}

function emailBody(wants) {
  return [
    "You're on the list. Stew noticed from his corner and is, as usual, amazed.",
    "",
    `You asked to hear about: ${wants}.`,
    "",
    "When those are ready you'll get one email, and nothing in between.",
    'No newsletters, no "just checking in."',
    "",
    "Until then, the episodes live here:",
    "https://www.youtube.com/@YouAreStarStuff",
    "",
    "See you next episode.",
    "Michael, and Stew",
    "",
    "youarestarstuff.com",
  ].join("\n");
}

// Keep full addresses out of the function logs.
function mask(addr) {
  const [user, domain] = addr.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

const ok = (msg) => ({ statusCode: 200, body: msg });

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (err) {
    console.error("submission-created: could not parse event body", err);
    return { statusCode: 400, body: "bad payload" };
  }

  if (payload.form_name !== "waitlist") {
    return ok(`ignored form "${payload.form_name}"`);
  }

  const to = String(
    (payload.data && payload.data.email) || payload.email || "",
  ).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.warn(
      "submission-created: no usable email on submission",
      payload.id,
    );
    return ok("no usable email");
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("submission-created: RESEND_API_KEY is not set");
    return ok("no api key");
  }

  const wants = wantsText(payload);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      reply_to: REPLY_TO,
      subject: SUBJECT,
      text: emailBody(wants),
    }),
  });

  const result = await res.text();
  if (!res.ok) {
    console.error(
      `submission-created: Resend ${res.status} for ${mask(to)}:`,
      result,
    );
    return { statusCode: 502, body: "email send failed" };
  }

  console.log(
    `submission-created: confirmation sent to ${mask(to)} (${wants})`,
  );
  return ok("sent");
};

// Exposed for local testing only; Netlify ignores these.
exports._internal = { wantsText, emailBody };
