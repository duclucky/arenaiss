import nodemailer from 'nodemailer';

import type { EmailLoginSender } from './managed-identity.ts';

export class SmtpEmailLoginSender implements EmailLoginSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(input: { host: string; port: number; secure: boolean; user: string; pass: string; from: string }) {
    if (!input.host || !Number.isInteger(input.port) || input.port < 1 || input.port > 65_535 || !input.user || !input.pass || !input.from) {
      throw new Error('SMTP configuration is invalid');
    }
    this.transport = nodemailer.createTransport({
      host: input.host, port: input.port, secure: input.secure, auth: { user: input.user, pass: input.pass },
    });
    this.from = input.from;
  }

  private readonly from: string;

  async sendLoginCode(email: string, code: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: 'Your Arena ISS sign-in code',
      text: `Your Arena ISS sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
    });
  }
}
