import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { FEEDBACK_TYPES, MESSAGE_MIN, MESSAGE_MAX } from '../Misc/constants.js';
import { loadTurnstile } from '../Misc/turnstile.js';

/**
 * FeedbackForm
 *
 * Self-contained feedback / support form. Handles three user states:
 *   - Authenticated  → no email field; identity comes from the session
 *   - Visitor        → email field + Cloudflare Turnstile bot check
 *   - Free user      → same as visitor unless parent passes isAuthenticated=true
 *
 * Props
 * ─────
 * @param {string}   [apiEndpoint='/api/feedback']
 *   Route that handles the POST. Must accept the shape described in Submit.js.
 *
 * @param {string}   [turnstileSiteKey]
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY. Required for visitor submissions.
 *   Defaults to process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY (available client-side).
 *
 * @param {Array}    [types]
 *   Override the default message type options. Each item: { value, label }.
 *
 * @param {string}   [className]
 *   Additional CSS class applied to the outer <form> / wrapper element.
 *
 * @param {function} [onSuccess]
 *   Called after a successful submission. Receives no arguments.
 *   Useful when the form is mounted inside a modal that should close on success.
 *
 * @param {string}   [successEmail]
 *   Override the reply-to address shown in the success state.
 *   Defaults to the session email (logged-in) or the typed email (visitor).
 *
 * ---
 * Minimal usage:
 *   import FeedbackForm from '@vx-howler/Components/FeedbackForm';
 *   <FeedbackForm />
 *
 * Inside a modal with a close callback:
 *   <FeedbackForm onSuccess={() => setOpen(false)} />
 */
export default function FeedbackForm({
    apiEndpoint  = '/api/feedback',
    turnstileSiteKey,
    types        = FEEDBACK_TYPES,
    className    = '',
    onSuccess,
    successEmail,
}) {
    const siteKey = turnstileSiteKey || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const { data: session, status } = useSession();
    const loggedIn = status === 'authenticated' && !!session?.user?.email;
    const sessionEmail = session?.user?.email ?? null;

    const [type,    setType]    = useState(types[0]?.value ?? 'question');
    const [message, setMessage] = useState('');
    const [email,   setEmail]   = useState('');
    const [website, setWebsite] = useState(''); // honeypot
    const [token,   setToken]   = useState('');
    const [uiState, setUiState] = useState('idle'); // 'idle' | 'sending' | 'sent'
    const [error,   setError]   = useState('');

    const tsContainerRef = useRef(null);
    const tsWidgetId     = useRef(null);

    // Inject and render the Turnstile widget for visitors only
    useEffect(() => {
        if (status === 'loading' || loggedIn || !tsContainerRef.current || !siteKey) return;
        let cancelled = false;

        loadTurnstile().then(() => {
            if (cancelled || !tsContainerRef.current || !window.turnstile || tsWidgetId.current) return;
            tsWidgetId.current = window.turnstile.render(tsContainerRef.current, {
                sitekey:           siteKey,
                callback:          (t) => setToken(t),
                'expired-callback': () => setToken(''),
            });
        });

        return () => { cancelled = true; };
    }, [status, loggedIn, siteKey]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setUiState('sending');

        try {
            const res = await fetch(apiEndpoint, {
                method:  'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    type,
                    message,
                    email:          loggedIn ? undefined : email,
                    pageUrl:        window.location.href,
                    website,
                    turnstileToken: token,
                }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Something went wrong.');

            setUiState('sent');
            onSuccess?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
            setUiState('idle');
            if (!loggedIn && window.turnstile) {
                window.turnstile.reset(tsWidgetId.current);
                setToken('');
            }
        }
    }

    const replyEmail = successEmail ?? (loggedIn ? sessionEmail : email);

    // ── Success state ────────────────────────────────────────────────────────
    if (uiState === 'sent') {
        return (
            <div role="status" className={`--feedback-sent ${className}`.trim()}>
                <p>
                    Message sent. We'll reply to <strong>{replyEmail}</strong>.
                </p>
            </div>
        );
    }

    const canSend =
        uiState !== 'sending' &&
        message.trim().length >= MESSAGE_MIN &&
        (loggedIn || (EMAIL_RE_CLIENT.test(email) && (!siteKey || token)));

    // ── Form ─────────────────────────────────────────────────────────────────
    return (
        <form
            onSubmit={handleSubmit}
            className={`--feedback-form ${className}`.trim()}
            noValidate
        >
            {/* Type selector */}
            <div className="--feedback-field">
                <label htmlFor="feedback-type" className="--feedback-label">
                    What's this about?
                </label>
                <select
                    id="feedback-type"
                    className="--feedback-select"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                >
                    {types.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </div>

            {/* Identity row */}
            {loggedIn ? (
                <p className="--feedback-from">
                    Sending as <strong>{sessionEmail}</strong>
                </p>
            ) : (
                <div className="--feedback-field">
                    <label htmlFor="feedback-email" className="--feedback-label">
                        Your email (so we can reply)
                    </label>
                    <input
                        id="feedback-email"
                        type="email"
                        className="--feedback-input"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
            )}

            {/* Message */}
            <div className="--feedback-field">
                <label htmlFor="feedback-message" className="--feedback-label">
                    Message
                    <span className="--feedback-char-count">
                        {message.length}/{MESSAGE_MAX}
                    </span>
                </label>
                <textarea
                    id="feedback-message"
                    className="--feedback-textarea"
                    required
                    rows={6}
                    maxLength={MESSAGE_MAX}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what happened or what you need. If something broke, include what you clicked before it happened."
                />
            </div>

            {/* Honeypot — hidden from people, screen readers, and keyboard navigation */}
            <div aria-hidden="true" className="--feedback-honeypot">
                <label>
                    Website
                    <input
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                    />
                </label>
            </div>

            {/* Turnstile widget (visitors only) */}
            {!loggedIn && siteKey && (
                <div className="--feedback-turnstile" ref={tsContainerRef} />
            )}

            {/* Inline error */}
            {error && (
                <p role="alert" className="--feedback-error">
                    {error}
                </p>
            )}

            <button
                type="submit"
                className="--feedback-submit"
                disabled={!canSend}
            >
                {uiState === 'sending' ? 'Sending…' : 'Send message'}
            </button>
        </form>
    );
}

// Lightweight email check client-side (full validation happens server-side)
const EMAIL_RE_CLIENT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
