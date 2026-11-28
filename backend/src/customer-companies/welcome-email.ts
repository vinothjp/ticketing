import { renderLetter } from '../lib/letter-email';

/**
 * The email a client's customer admin gets when their client account is set up
 * (New Client form) or when they are made its admin later (Edit Client's
 * Customer admin card).
 *
 * Written in the plain letter layout every email uses (`lib/letter-email.ts`):
 * who set the account up and for which company, the sign-in details as the
 * details table, what this person can do as the company's admin, and a
 * security line. The password is always included, labelled *Temporary
 * password*, with where to change it — for a new login it is the one typed on
 * the form, and a linked existing login is reset to the one typed when linking.
 */
export interface WelcomeEmailInput {
  providerName: string;
  companyName: string;
  /** Full name when known — a new login made on the New Client form has none. */
  recipientName: string | null;
  username: string;
  email: string;
  /** The portal's base URL (FRONTEND_URL); without it the email carries no link. */
  portalUrl: string | null;
  /** An existing login linked to the client, rather than a new one created for it. */
  existingLogin: boolean;
  /** The temporary password typed on the form (a linked login was reset to it). */
  temporaryPassword: string;
}

export function buildWelcomeEmail(i: WelcomeEmailInput) {
  const provider = i.providerName;
  const company = i.companyName;
  const loginUrl = i.portalUrl ? `${i.portalUrl.replace(/\/$/, '')}/login` : null;

  const subject = `[Account Created] - ${company} Support Portal`;

  const intro = i.existingLogin
    ? `You have been made the administrator of ${company}'s account on our support portal.\n` +
      'Your existing login now opens it, with the temporary password given below.'
    : `We are pleased to inform you that a support portal account has been created for ${company}, and you have been set up as its administrator.\n` +
      'You can now raise and track your support requests with us online.';

  const { html, text } = renderLetter({
    greetName: i.recipientName,
    fallbackGreeting: 'Customer',
    intro,
    table: {
      heading: 'Sign-in Details',
      rows: [
        ['Company', company],
        ['Portal URL', loginUrl],
        ['Username', i.username],
        ['Email', i.email],
        ['Temporary Password', i.temporaryPassword],
      ],
    },
    sections: [{
      title: "As your company's administrator, you can",
      body: [
        'Raise support tickets for your products and follow each one through to resolution',
        'Add your colleagues under My Team, so they can raise tickets too',
        'Review and approve the tickets your team raises before they reach us',
        'See your products, support hours and coverage in one place',
      ],
    }],
    outro:
      'Please change your password after you first sign in: click your name at the top right and choose Change Password.\n' +
      'Your username must be typed exactly as shown above, capitals included, or you may sign in with your email address instead. ' +
      'If you forget your password, use Forgot password on the sign-in page.\n\n' +
      `Please keep your password confidential — ${provider} will never ask you for it. If you were not expecting this email, please let us know.`,
    link: { label: 'Sign in to the Portal', url: loginUrl },
    thanks: `Welcome aboard. We look forward to supporting ${company}.`,
    orgName: provider,
  });

  return { subject, html, text };
}
