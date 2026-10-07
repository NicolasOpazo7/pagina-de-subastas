const nodemailer = require('nodemailer');
const configured = () =>
  Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM && process.env.APP_URL);
async function sendReset(email, token) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
  });
  const link = new URL(`/#/reset?token=${token}`, process.env.APP_URL).href;
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Recupera tu acceso a Aurum Subastas',
    text: `Solicitaste recuperar tu acceso. Este enlace es de un solo uso y caduca en 30 minutos:\n${link}\n\nSi no solicitaste este cambio, ignora este correo.`,
  });
  transport.close();
}
module.exports = { configured, sendReset };
