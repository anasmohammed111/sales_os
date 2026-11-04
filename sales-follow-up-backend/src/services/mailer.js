const nodemailer = require('nodemailer');

// Messages captured when MAIL_TRANSPORT=memory (tests)
const outbox = [];

let transport = null;

/** SMTP when SMTP_HOST is set; otherwise no transport (mail is not sent). */
const getTransport = () => {
    if (transport) return transport;
    if (!process.env.SMTP_HOST) return null;

    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return transport;
};

/** Sends an email. Resolves { sent: boolean }; never logs message bodies. */
const sendMail = async ({ to, subject, text, html }) => {
    const message = {
        from: process.env.MAIL_FROM || 'Sales Follow-up OS <no-reply@localhost>',
        to,
        subject,
        text,
        html,
    };

    if (process.env.MAIL_TRANSPORT === 'memory') {
        outbox.push(message);
        return { sent: true };
    }

    const smtp = getTransport();
    if (!smtp) return { sent: false };

    await smtp.sendMail(message);
    return { sent: true };
};

module.exports = { sendMail, outbox };
