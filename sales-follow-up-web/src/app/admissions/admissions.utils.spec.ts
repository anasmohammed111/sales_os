import { dayKey, money, outstandingLine, whatsappLink } from './admissions.utils';

describe('admissions utils', () => {
  it('works out the calendar day in the module timezone, not the browser one', () => {
    // 20:00 UTC on 3 Nov is already 4 Nov in India (UTC+5:30)
    const instant = new Date('2026-11-03T20:00:00Z');
    expect(dayKey(instant, 'Asia/Kolkata')).toBe('2026-11-04');
    expect(dayKey(instant, 'Europe/Prague')).toBe('2026-11-03');
  });

  it('builds WhatsApp links, adding India’s code to ten-digit numbers', () => {
    expect(whatsappLink('98765 43210')).toBe('https://wa.me/919876543210');
    expect(whatsappLink('+420 777 123 456')).toBe('https://wa.me/420777123456');
    expect(whatsappLink('')).toBe('');
  });

  it('formats money per currency and never sums across currencies', () => {
    expect(money(150050, 'INR')).toBe('INR 1,500.50');
    expect(
      outstandingLine([
        { currency: 'INR', dueMinor: 100000, paidMinor: 40000, outstandingMinor: 60000 },
        { currency: 'EUR', dueMinor: 50000, paidMinor: 50000, outstandingMinor: 0 },
        { currency: 'CZK', dueMinor: 1000, paidMinor: 0, outstandingMinor: 1000 },
      ])
    ).toBe('INR 600.00, CZK 10.00');
  });
});
