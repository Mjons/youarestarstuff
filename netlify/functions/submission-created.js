// Netlify event-triggered function.
// Netlify runs this automatically after every verified submission to any form
// on the site (the file name "submission-created" is what wires it up).
// For the "waitlist" form it sends the person a one-time confirmation email
// through Resend (https://resend.com).
//
// Environment variables (Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY           required, a Resend key with sending access
//   WAITLIST_FROM            optional, overrides the sender shown below
//   WAITLIST_REPLY_TO        optional, overrides the reply-to address shown below
//   WAITLIST_POSTAL_ADDRESS  strongly recommended. Canada's anti-spam law (CASL)
//                            requires a mailing address in every commercial
//                            email. A PO box or mailbox-service address is fine.
//
// Every email carries the CASL-required footer: who sent it, a mailing address,
// and a way to unsubscribe (reply with "unsubscribe"; honour it within 10
// business days by deleting the entry in Netlify > Forms).

const SITE_URL = "https://youarestarstuff.com";
const FROM =
  process.env.WAITLIST_FROM ||
  "Stew from You Are Star Stuff <stew@youarestarstuff.com>";
const REPLY_TO = process.env.WAITLIST_REPLY_TO || "stew@youarestarstuff.com";
const POSTAL =
  process.env.WAITLIST_POSTAL_ADDRESS || "Toronto, Ontario, Canada";
const SUBJECT = "Stew saw you sign up";

// The "wants" checkboxes share one field name. Netlify may hand the values
// back as an array, a single string, or one entry per box in
// ordered_human_fields, so accept all three shapes.
function wantsList(payload) {
  const data = payload.data || {};
  const fromOrdered = (payload.ordered_human_fields || [])
    .filter((f) => f && f.name === "wants" && f.value)
    .map((f) => String(f.value));

  let list;
  if (fromOrdered.length > 1) list = fromOrdered;
  else if (Array.isArray(data.wants)) list = data.wants;
  else if (data.wants) list = [String(data.wants)];
  else list = fromOrdered;

  return list.map((s) => String(s).trim()).filter(Boolean);
}

function emailBody(wants) {
  // Only promise what they actually asked for. An empty list (possible if the
  // form is posted without the page's own validation) gets no promise at all.
  const asked = wants.length
    ? [
        `You asked to hear about: ${wants.join(", ")}.`,
        "",
        "When those are ready you'll get one email per item, and nothing in between.",
        'No newsletters, no "just checking in."',
      ]
    : [
        "You didn't tick anything to hear about, so we won't email you again",
        "unless you reply and tell us what you'd like.",
      ];

  return [
    "You're on the list. Stew noticed from his corner and is, as usual, amazed.",
    "",
    ...asked,
    "",
    "Until then, the episodes live here:",
    "https://www.youtube.com/@YouAreStarStuff",
    "",
    "See you next episode.",
    "Michael, and Stew",
    "",
    "--",
    `You're getting this because this address was entered on ${SITE_URL}.`,
    "If that wasn't you, reply \"remove\" and we'll delete it, no questions asked.",
    'To unsubscribe at any time, reply with "unsubscribe". We act on it within 10 business days.',
    `You Are Star Stuff · ${POSTAL}`,
    `${SITE_URL} · ${REPLY_TO} · Privacy: ${SITE_URL}/privacy`,
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
  if (!process.env.WAITLIST_POSTAL_ADDRESS) {
    console.warn(
      "submission-created: WAITLIST_POSTAL_ADDRESS is not set; CASL requires a mailing address in every email",
    );
  }

  const wants = wantsList(payload);
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
      headers: {
        // Lets mail clients show a one-click unsubscribe control.
        "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=unsubscribe>`,
      },
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
    `submission-created: confirmation sent to ${mask(to)} (${wants.join(", ") || "nothing ticked"})`,
  );
  return ok("sent");
};

// Exposed for local testing only; Netlify ignores these.
exports._internal = { wantsList, emailBody };
