/**
 * Server-side wording for emails and text messages in the user's language ("en" or "hi").
 * Notification titles are fixed English strings in the code; HI_TITLES translates the known ones
 * (the body keeps job titles and names exactly as people typed them).
 */
export type Lang = "en" | "hi";
export const LANGS: readonly Lang[] = ["en", "hi"];
export const asLang = (v: unknown): Lang => (v === "hi" ? "hi" : "en");

export const HI_TITLES: Record<string, string> = {
  "New bid on your job": "आपके काम पर नई बोली",
  "A professional bid again on your job": "एक प्रोफ़ेशनल ने आपके काम पर फिर से बोली लगाई",
  "Quote revised on a bid": "एक बोली का कोटेशन बदला गया",
  "Bid accepted!": "बोली स्वीकार हुई!",
  "Bid not selected": "बोली नहीं चुनी गई",
  "Counter-offer received": "जवाबी ऑफ़र मिला",
  "Counter-offer declined": "जवाबी ऑफ़र अस्वीकार हुआ",
  "The client viewed your revised quote": "क्लाइंट ने आपका बदला हुआ कोटेशन देखा",
  "Shortlisted professional replies faster": "शॉर्टलिस्ट किया गया प्रोफ़ेशनल जल्दी जवाब देता है",
  "Work started": "काम शुरू हुआ",
  "Please confirm the work is complete": "कृपया पुष्टि करें कि काम पूरा हो गया है",
  "Job completed": "काम पूरा हुआ",
  "Job confirmed": "काम की पुष्टि हुई",
  "Job confirmed automatically": "काम की अपने-आप पुष्टि हुई",
  "Booking cancelled": "बुकिंग रद्द हुई",
  "Job cancelled": "काम रद्द हुआ",
  "Job cancelled by FixLocal": "FixLocal ने काम रद्द किया",
  "Payment released": "भुगतान जारी हुआ",
  "Visit time proposed": "विज़िट का समय सुझाया गया",
  "Visit time confirmed": "विज़िट का समय पक्का हुआ",
  "New dispute opened": "नया विवाद खोला गया",
  "Dispute opened on your job": "आपके काम पर विवाद खोला गया",
  "Dispute resolved": "विवाद सुलझ गया",
  "Job invite": "काम का न्योता",
  "Invite declined": "न्योता अस्वीकार हुआ",
  "New review received": "नया रिव्यू मिला",
  "You're verified": "आप वेरिफ़ाई हो गए हैं",
  "Viewed but no reply": "देखा, पर जवाब नहीं",
  "Saved professional update": "सेव किए गए प्रोफ़ेशनल की जानकारी",
  "A saved professional may be a fit": "सेव किया गया प्रोफ़ेशनल इस काम के लिए सही हो सकता है",
  "Saved professional has more availability": "सेव किए गए प्रोफ़ेशनल के पास अब ज़्यादा समय है",
  "Recurring package proposal": "नियमित पैकेज का प्रस्ताव",
  "Client requested a recurring package": "क्लाइंट ने नियमित पैकेज माँगा",
  "New report": "नई रिपोर्ट",
  "New jobs match your alerts": "आपके अलर्ट से मिलते नए काम",
  "You earned FixLocal credit": "आपको FixLocal क्रेडिट मिला",
  "Referral credit reversed": "रेफ़रल क्रेडिट वापस लिया गया",
};

export function localizeTitle(lang: Lang, title: string): string {
  if (lang !== "hi") return title;
  if (HI_TITLES[title]) return HI_TITLES[title];
  const job = /^New job: (.+)$/.exec(title);
  if (job) return `नया काम: ${job[1]}`;
  return title;
}

type Mail = { subject: string; text: string };

export const emails = {
  verify(lang: Lang, v: { name?: string | null; link: string }): Mail {
    return lang === "hi"
      ? {
          subject: "अपना FixLocal ईमेल वेरिफ़ाई करें",
          text: `नमस्ते ${v.name || ""},\n\nFixLocal इस्तेमाल करना शुरू करने के लिए अपना ईमेल पक्का करें:\n${v.link}\n\nयह लिंक 48 घंटे में खत्म हो जाएगा।`,
        }
      : {
          subject: "Verify your FixLocal email",
          text: `Hi ${v.name || "there"},\n\nConfirm your email to start using FixLocal:\n${v.link}\n\nThis link expires in 48 hours.`,
        };
  },
  reset(lang: Lang, v: { link: string }): Mail {
    return lang === "hi"
      ? {
          subject: "अपना FixLocal पासवर्ड बदलें",
          text: `किसी ने इस खाते का पासवर्ड बदलने को कहा है।\n\nनया पासवर्ड यहाँ चुनें:\n${v.link}\n\nयह लिंक 1 घंटे में खत्म हो जाएगा। अगर यह आपने नहीं किया, तो इस ईमेल को अनदेखा करें।`,
        }
      : {
          subject: "Reset your FixLocal password",
          text: `Someone asked to reset the password for this account.\n\nChoose a new password here:\n${v.link}\n\nThis link expires in 1 hour. If this wasn't you, you can ignore this email.`,
        };
  },
  existingAccount(lang: Lang, v: { name?: string | null; login: string; forgot: string }): Mail {
    return lang === "hi"
      ? {
          subject: "किसी ने आपके ईमेल से साइन अप करने की कोशिश की",
          text:
            `नमस्ते ${v.name || ""},\n\nकिसी ने अभी इस ईमेल पते से FixLocal खाता बनाने की कोशिश की, लेकिन आपका खाता पहले से है।\n\n` +
            `अगर यह आप थे, तो यहाँ लॉग इन करें:\n${v.login}\n\nपासवर्ड भूल गए? यहाँ बदलें:\n${v.forgot}\n\nअगर यह आप नहीं थे, तो कुछ करने की ज़रूरत नहीं है; कुछ नहीं बदला है।`,
        }
      : {
          subject: "Someone tried to sign up with your email",
          text:
            `Hi ${v.name || "there"},\n\nSomeone just tried to create a FixLocal account with this email address, ` +
            `but you already have one.\n\nIf it was you, log in here:\n${v.login}\n\n` +
            `Forgot your password? Reset it here:\n${v.forgot}\n\nIf it wasn't you, you can ignore this email; nothing has changed.`,
        };
  },
  notification(lang: Lang, v: { title: string; body: string; link?: string | null; settings: string }): Mail {
    const title = localizeTitle(lang, v.title);
    return lang === "hi"
      ? {
          subject: `FixLocal: ${title}`.slice(0, 200),
          text: `${v.body}\n\n${v.link ? `FixLocal खोलें: ${v.link}\n\n` : ""}ये ईमेल आप सेटिंग्स में बंद कर सकते हैं: ${v.settings}`,
        }
      : {
          subject: `FixLocal: ${title}`.slice(0, 200),
          text: `${v.body}\n\n${v.link ? `Open FixLocal: ${v.link}\n\n` : ""}You can turn these emails off in Settings: ${v.settings}`,
        };
  },
  digest(lang: Lang, v: { items: { title: string; where: string; link: string; alertName: string }[]; alerts: string; settings: string }): Mail {
    const n = v.items.length;
    const lines = v.items.map((i) => `• ${i.title}${i.where ? ` (${i.where})` : ""}\n  ${i.link}`).join("\n");
    return lang === "hi"
      ? {
          subject: `FixLocal: पिछले 24 घंटों में आपके अलर्ट से ${n} नए काम मिले`,
          text: `नमस्ते,\n\nपिछले 24 घंटों में ये काम आपके जॉब अलर्ट से मिलते हैं:\n\n${lines}\n\nअलर्ट बदलें या इंस्टेंट पर स्विच करें: ${v.alerts}\nईमेल बंद करें: ${v.settings}`,
        }
      : {
          subject: `FixLocal: ${n} new job${n === 1 ? "" : "s"} matched your alerts in the last 24 hours`,
          text: `Hi,\n\nThese jobs posted in the last 24 hours match your job alerts:\n\n${lines}\n\nChange your alerts or switch to instant: ${v.alerts}\nTurn these emails off: ${v.settings}`,
        };
  },
};

/** One short text (SMS / WhatsApp) line: "FixLocal: <title>. <link>". */
export function textMessage(lang: Lang, title: string, link?: string | null): string {
  const t = localizeTitle(lang, title);
  return `FixLocal: ${t}${link ? ` ${link}` : ""}`.slice(0, 300);
}

export const otpText = (lang: Lang, code: string) =>
  lang === "hi"
    ? `FixLocal: आपका फ़ोन वेरिफ़िकेशन कोड ${code} है। यह 10 मिनट तक मान्य है। इसे किसी से साझा न करें।`
    : `FixLocal: your phone verification code is ${code}. It is valid for 10 minutes. Don't share it with anyone.`;
