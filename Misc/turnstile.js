'use strict';

/**
 * Client-side: injects the Turnstile script once and returns a promise that
 * resolves when window.turnstile is ready. Safe to call multiple times.
 */
export function loadTurnstile() {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') return resolve();
        if (window.turnstile) return resolve();
        const existing = document.getElementById('cf-turnstile-script');
        if (existing) {
            existing.addEventListener('load', () => resolve());
            return;
        }
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => resolve();
        document.head.appendChild(s);
    });
}

/**
 * Server-side: verifies a Turnstile token against the Cloudflare siteverify API.
 * Returns true on success, false on any failure (network, bad token, missing secret).
 *
 * @param {string|undefined} token  - token from the client widget callback
 * @param {string}           ip     - client IP (passed as remoteip for extra validation)
 * @param {string}           secret - TURNSTILE_SECRET_KEY
 */
export async function verifyTurnstileServer(token, ip, secret) {
    if (!token || !secret) return false;
    try {
        const body = new URLSearchParams({ secret, response: token, remoteip: ip });
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body,
        });
        const data = await res.json();
        return data.success === true;
    } catch {
        return false;
    }
}
