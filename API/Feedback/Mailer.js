'use strict';

import nodemailer from 'nodemailer';

const esc = (s) =>
    String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

/**
 * Sends feedback notification emails via Brevo SMTP.
 * Mirrors the SpaceMailer pattern — reads the same env vars the project already defines.
 *
 * Required env vars (already present in .env):
 *   BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_USER, BREVO_SMTP_PASS
 *   BREVO_FROM_EMAIL, BREVO_FROM_NAME
 *
 * Additional env var:
 *   FEEDBACK_NOTIFY_EMAIL — where admin notifications are delivered
 */
class FeedbackMailer {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host:       process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
            port:       parseInt(process.env.BREVO_SMTP_PORT || '587', 10),
            secure:     false,
            requireTLS: true,
            auth: {
                user: process.env.BREVO_SMTP_USER || '',
                pass: process.env.BREVO_SMTP_PASS || '',
            },
        });
        this.fromLabel = `"${process.env.BREVO_FROM_NAME || 'Monkey Library'}" <${process.env.BREVO_FROM_EMAIL || ''}>`;
    }

    /**
     * @param {object} opts
     * @param {string}      opts.type
     * @param {string}      opts.message
     * @param {string}      opts.email         sender email (reply-to)
     * @param {string|null} opts.roles
     * @param {string|null} opts.page_url
     * @param {boolean}     opts.is_anonymous
     * @param {string}      opts.notifyEmail   destination address
     */
    async notify({ type, message, email, roles, page_url, is_anonymous, notifyEmail }) {
        if (!notifyEmail) return;

        const subject = `[Feedback] ${esc(type)}: ${message.slice(0, 60)}`;
        const html = `
            <p><b>Type:</b> ${esc(type)}</p>
            <p><b>From:</b> ${esc(email)} ${is_anonymous ? '(visitor)' : '(logged in)'}</p>
            ${roles    ? `<p><b>Roles:</b> ${esc(roles)}</p>`        : ''}
            ${page_url ? `<p><b>Page:</b> ${esc(page_url)}</p>`      : ''}
            <hr/>
            <p style="white-space:pre-wrap">${esc(message)}</p>
        `;

        await this.transporter.sendMail({
            from:    this.fromLabel,
            to:      notifyEmail,
            replyTo: email,
            subject,
            html,
        });
    }
}

export default new FeedbackMailer();
