// Congo-Brazzaville numbers: 9 digits starting with 0 (06 123 45 67), country code 242.

// Any format -> "242061234567", or null if it doesn't look like a phone number
export function phoneDigits(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('0')) digits = '242' + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// "242061234567" -> "+242 06 123 45 67"
export function formatPhone(digits: string) {
  const m = digits.match(/^242(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+242 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${digits}`;
}
