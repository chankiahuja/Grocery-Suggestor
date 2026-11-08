/** UI preview rules only. These do not authenticate users or establish sessions. */
export const DEMO_OTP = "123456";
export const OTP_LIFETIME_MS = 5 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;

export function emailError(value: string): string {
  if (!value.trim()) return "Enter your email address.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? ""
    : "Enter a valid email address, such as you@example.com.";
}

export function mobileError(value: string, countryCode = "+91"): string {
  if (!value.trim()) return "Enter your mobile number.";
  const digits = value.trim();
  if (!/^[0-9]+$/.test(digits))
    return "Enter digits only, without the country code or spaces.";
  if (countryCode === "+91")
    return digits.length === 10 ? "" : "Enter a 10-digit Indian mobile number.";
  return digits.length >= 4 && digits.length <= 14
    ? ""
    : "Enter a mobile number with 4 to 14 digits.";
}

export function otpError(
  value: string,
  expiresAt: number,
  now = Date.now(),
): string {
  const code = value.trim();
  if (!code) return "Enter the verification code.";
  if (!/^[0-9]{6}$/.test(code)) return "Enter a 6-digit verification code.";
  if (now >= expiresAt)
    return "This demo code has expired. Request another code.";
  if (code !== DEMO_OTP)
    return "That code does not match. For this preview, use 123456.";
  return "";
}
