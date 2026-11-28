/**
 * The one look every system email has (client reference): a plain business
 * letter — Arial 13px, dark text on white, no banner, card or button — with at
 * most one details table drawn as a thin black grid.
 *
 *   Dear <name>,
 *   <intro paragraphs>
 *   <Details table>           e.g. "Ticket Details"
 *   <titled sections>         e.g. "Issue Description", "Resolution Details"
 *   <closing paragraphs>
 *   <Link label>: <url>
 *   <thanks line>
 *   Best Regards,
 *   <Organization> Support Team
 *
 * The wording of the ticket emails comes from the team lead's templates
 * (`tickets/ticket-email.ts`); every other sender (welcome, test connection,
 * password reset, contract reminders…) writes its own words into this shape.
 * All input is plain text and is escaped here.
 */
export interface LetterEmail {
  /** Who the letter is to; blank greets `fallbackGreeting` (default "Team"). */
  greetName?: string | null;
  fallbackGreeting?: string;
  /** Opening paragraphs; a blank line starts a new paragraph, a single newline a new line. */
  intro: string;
  /** One details table, e.g. "Ticket Details". Rows with a blank value are left out. */
  table?: { heading: string; rows: [string, string | null | undefined][] };
  /** Titled blocks under the table; an array body renders as a bullet list. */
  sections?: { title: string; body: string | string[] | null | undefined }[];
  /** Closing paragraphs, after the sections. */
  outro?: string;
  /** "View Ticket: https://…" — omitted when there is no URL. */
  link?: { label: string; url: string | null | undefined };
  /** A thank-you line before the sign-off. */
  thanks?: string;
  /** Default "Best Regards". */
  signOff?: string;
  /** The tenant's name; the letter is signed "<orgName> Support Team". */
  orgName?: string | null;
}

export const escapeHtml = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Indus Support Team", or plain "Support Team" when the organization is unknown. */
export const supportTeam = (orgName?: string | null) =>
  orgName?.trim() ? `${orgName.trim()} Support Team` : 'Support Team';

/** FRONTEND_URL joined to an app path, or null when the URL isn't configured. */
export function portalLink(path: string): string | null {
  const base = process.env.FRONTEND_URL?.trim().replace(/\/$/, '');
  return base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : null;
}

const TEXT = 'font-size:13px;color:#222;';
const P = `margin:0 0 12px;${TEXT}`;
const CELL = `border:1px solid #000;padding:6px 8px;${TEXT}vertical-align:top;`;

const paragraphs = (s: string | undefined) =>
  (s ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="${P}">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');

const blank = (v: string | string[] | null | undefined) =>
  Array.isArray(v) ? !v.some((x) => x?.trim()) : !v?.trim();

export function renderLetter(l: LetterEmail): { html: string; text: string } {
  const greeting = `Dear ${l.greetName?.trim() || l.fallbackGreeting || 'Team'},`;
  const rows = (l.table?.rows ?? []).filter((r): r is [string, string] => !!r[1]?.trim());
  const sections = (l.sections ?? []).filter((s) => !blank(s.body));
  const url = l.link?.url?.trim() || null;
  const signOff = l.signOff ?? 'Best Regards';
  const team = supportTeam(l.orgName);

  const table = l.table && rows.length
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #000;margin:0 0 12px;">
        <tr><td colspan="2" style="${CELL}font-weight:bold;">${escapeHtml(l.table.heading)}</td></tr>
        ${rows.map(([k, v]) => `<tr><td style="${CELL}width:26%;">${escapeHtml(k)}</td><td style="${CELL}">${escapeHtml(v)}</td></tr>`).join('')}
      </table>`
    : '';

  const section = (s: { title: string; body: string | string[] | null | undefined }) =>
    Array.isArray(s.body)
      ? `<p style="${P}margin-bottom:4px;"><b>${escapeHtml(s.title)}</b></p>
         <ul style="margin:0 0 12px;padding-left:22px;${TEXT}">${s.body.filter((x) => x?.trim()).map((x) => `<li style="margin:0 0 2px;">${escapeHtml(x)}</li>`).join('')}</ul>`
      : `<p style="${P}"><b>${escapeHtml(s.title)}</b><br/><span style="white-space:pre-wrap;">${escapeHtml(s.body)}</span></p>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;${TEXT}line-height:1.5;">
    <p style="${P}">${escapeHtml(greeting)}</p>
    ${paragraphs(l.intro)}
    ${table}
    ${sections.map(section).join('')}
    ${paragraphs(l.outro)}
    ${url ? `<p style="${P}">${escapeHtml(l.link!.label)}: <a href="${escapeHtml(url)}" style="color:#1a0dab;">${escapeHtml(url)}</a></p>` : ''}
    ${paragraphs(l.thanks)}
    <p style="${P}">${escapeHtml(signOff)},<br/>${escapeHtml(team)}</p>
  </div>`;

  const text = [
    greeting,
    '',
    l.intro.trim(),
    ...(l.table && rows.length ? ['', l.table.heading, ...rows.map(([k, v]) => `- ${k}: ${v}`)] : []),
    ...sections.flatMap((s) => ['', `${s.title}:`, ...(Array.isArray(s.body) ? s.body.filter((x) => x?.trim()).map((x) => `- ${x}`) : [String(s.body).trim()])]),
    ...(l.outro?.trim() ? ['', l.outro.trim()] : []),
    ...(url ? ['', `${l.link!.label}: ${url}`] : []),
    ...(l.thanks?.trim() ? ['', l.thanks.trim()] : []),
    '',
    `${signOff},`,
    team,
  ].join('\n');

  return { html, text };
}
