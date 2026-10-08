'use strict';

export const FEEDBACK_TYPES = [
    { value: 'question', label: 'I have a question' },
    { value: 'issue',    label: 'Something isn\'t working' },
    { value: 'idea',     label: 'I have an idea' },
    { value: 'other',    label: 'Something else' },
];

export const FEEDBACK_TYPE_VALUES = FEEDBACK_TYPES.map(t => t.value);

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const MAX_PER_HOUR = 5;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
