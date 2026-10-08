'use strict';

import crypto from 'crypto';
import { FEEDBACK_TYPE_VALUES, MESSAGE_MIN, MESSAGE_MAX, EMAIL_RE, MAX_PER_HOUR } from '../../Misc/constants.js';
import { verifyTurnstileServer } from '../../Misc/turnstile.js';

/**
 * Factory that returns a Next.js API route handler for feedback submissions.
 *
 * Designed to be app-agnostic: auth, session resolution, and the Supabase
 * client are injected by the caller so Howler has no hard dependency on any
 * specific auth library or ORM.
 *
 * ---
 * @param {object}   cfg
 *
 * @param {function} cfg.getSession
 *   async (req, res) => session | null
 *   Resolves the current server session. Example:
 *     (req, res) => getServerSession(req, res, authOptions)
 *
 * @param {function} cfg.getIdentity
 *   async (session) => { email: string, userId: string|null, roles: string|null } | null
 *   Extracts a normalised identity from the session. Return null for unauthenticated.
 *
 * @param {object}   cfg.supabase
 *   A Supabase client initialised with the service-role key (bypasses RLS).
 *
 * @param {object}   [cfg.mailer]
 *   Object with async notify(row) method. Defaults to the bundled FeedbackMailer.
 *   Pass null to disable email notifications.
 *
 * @param {object}   [cfg.options]
 * @param {string}   [cfg.options.notifyEmail]      Destination for admin notifications.
 * @param {string}   [cfg.options.ipSalt]           Salt for IP hashing (required for production).
 * @param {string}   [cfg.options.turnstileSecret]  Turnstile secret key. Omit to skip verification.
 * @param {number}   [cfg.options.maxPerHour=5]     Rate-limit ceiling per hashed IP.
 * @param {string}   [cfg.options.tableName='feedback'] Target Supabase table.
 *
 * ---
 * Usage (in pages/api/feedback.js):
 *
 *   import { createFeedbackHandler } from '@vx-howler/API/Feedback/Submit';
 *   import FeedbackMailer from '@vx-howler/API/Feedback/Mailer';
 *   import { getServerSession } from 'next-auth/next';
 *   import { authOptions } from '@/pages/api/auth/[...nextauth]';
 *   import { createClient } from '@supabase/supabase-js';
 *
 *   const supabase = createClient(
 *     process.env.NEXT_PUBLIC_SUPABASE_URL,
 *     process.env.SUPABASE_SERVICE_ROLE_KEY,
 *     { auth: { persistSession: false } }
 *   );
 *
 *   export default createFeedbackHandler({
 *     getSession:  (req, res) => getServerSession(req, res, authOptions),
 *     getIdentity: async (session) => ({
 *       email:  session.user.email,
 *       userId: session.user.id ?? null,
 *       roles:  session.user.image?.role ?? null,
 *     }),
 *     supabase,
 *     mailer: FeedbackMailer,
 *     options: {
 *       notifyEmail:     process.env.FEEDBACK_NOTIFY_EMAIL,
 *       ipSalt:          process.env.FEEDBACK_IP_SALT,
 *       turnstileSecret: process.env.TURNSTILE_SECRET_KEY,
 *     },
 *   });
 */
export function createFeedbackHandler({ getSession, getIdentity, supabase, mailer, options = {} }) {
    const {
        notifyEmail,
        ipSalt          = '',
        turnstileSecret = process.env.TURNSTILE_SECRET_KEY,
        maxPerHour      = MAX_PER_HOUR,
        tableName       = 'feedback',
    } = options;

    return async function feedbackHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { type, message, email, pageUrl, website, turnstileToken } = req.body ?? {};

        // Honeypot — bots fill the hidden field; pretend success, save nothing
        if (website) return res.status(200).json({ ok: true });

        // Type validation
        if (!FEEDBACK_TYPE_VALUES.includes(type))
            return res.status(400).json({ error: 'Choose a type.' });

        // Message validation
        const text = typeof message === 'string' ? message.trim() : '';
        if (text.length < MESSAGE_MIN || text.length > MESSAGE_MAX)
            return res.status(400).json({
                error: `Message must be ${MESSAGE_MIN} to ${MESSAGE_MAX} characters.`,
            });

        // Client IP (never stored raw — hashed below)
        const rawIp  = _clientIp(req);
        const ipHash = crypto
            .createHash('sha256')
            .update(rawIp + ipSalt)
            .digest('hex');

        // Resolve session → identity
        const session  = await getSession(req, res);
        const identity = session ? await getIdentity(session) : null;
        const isAnonymous = !identity?.email;

        let senderEmail;
        let userId = null;
        let roles  = null;

        if (identity?.email) {
            // Logged-in: identity comes from the server session — never trust the client body
            senderEmail = identity.email;
            userId      = identity.userId ?? null;
            roles       = identity.roles  ?? null;
        } else {
            // Visitor: email from body + Turnstile
            if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()))
                return res.status(400).json({ error: 'Enter a valid email so we can reply.' });
            senderEmail = email.trim().toLowerCase();

            if (turnstileSecret) {
                const passed = await verifyTurnstileServer(turnstileToken, rawIp, turnstileSecret);
                if (!passed)
                    return res.status(400).json({ error: 'Bot check failed. Please try again.' });
            }
        }

        // Rate limit — max N submissions per hour per hashed IP
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await supabase
            .from(tableName)
            .select('id', { count: 'exact', head: true })
            .eq('ip_hash', ipHash)
            .gte('created_at', since);
        if ((count ?? 0) >= maxPerHour)
            return res.status(429).json({ error: 'Too many messages. Try again in an hour.' });

        // Persist
        const row = {
            type,
            message:      text,
            user_id:      userId,
            email:        senderEmail,
            is_anonymous: isAnonymous,
            roles,
            page_url:     typeof pageUrl === 'string' ? pageUrl.slice(0, 500) : null,
            user_agent:   (req.headers['user-agent'] ?? '').slice(0, 300),
            ip_hash:      ipHash,
        };

        const { error: dbError } = await supabase.from(tableName).insert(row);
        if (dbError) {
            console.error('[feedback] insert failed', dbError.code);
            return res.status(500).json({ error: 'Could not save your message. Please try again.' });
        }

        // Email notification — best-effort: DB row is already saved; never fail the request
        if (mailer && notifyEmail) {
            mailer.notify({ ...row, notifyEmail }).catch((e) =>
                console.error('[feedback] notify failed', e?.message)
            );
        }

        return res.status(200).json({ ok: true });
    };
}

function _clientIp(req) {
    const fwd   = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
    return (first || req.socket?.remoteAddress || '').trim();
}
