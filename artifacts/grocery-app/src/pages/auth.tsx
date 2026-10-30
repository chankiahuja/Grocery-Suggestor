import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, Leaf } from "lucide-react";
import {
  DEMO_OTP,
  OTP_LIFETIME_MS,
  RESEND_COOLDOWN_MS,
  mobileError,
  otpError,
} from "@/lib/demo-auth";

export default function Auth() {
  const [location] = useLocation();
  const signup = location === "/signup";
  const [step, setStep] = useState<"mobile" | "otp" | "success">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const mobileInput = useRef<HTMLInputElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const successPanel = useRef<HTMLDivElement>(null);
  const base = import.meta.env?.BASE_URL ?? "/";
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function reset() {
    setStep("mobile");
    setOtp("");
    setError("");
    setStatus("");
    setExpiresAt(0);
  }
  useEffect(() => {
    reset();
    setMobile("");
  }, [location]);
  useEffect(() => {
    if (step !== "otp") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);
  useEffect(() => {
    if (step === "mobile") mobileInput.current?.focus();
    if (step === "otp") otpInput.current?.focus();
    if (step === "success") successPanel.current?.focus();
  }, [step, location]);

  function issueDemoCode() {
    const timestamp = Date.now();
    setNow(timestamp);
    setExpiresAt(timestamp + OTP_LIFETIME_MS);
    setResendAt(timestamp + RESEND_COOLDOWN_MS);
    setOtp("");
    setError("");
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Pantry Pal">
        <Link href="/" aria-label="Pantry Pal home">
          <img
            className="auth-logo"
            src={`${base}brand/pantry-pal-logo.svg`}
            alt="Pantry Pal"
            width="208"
            height="58"
          />
        </Link>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">A little more in order</span>
          <h1>
            Your home.
            <br />A little more
            <br />
            together.
          </h1>
          <p>
            From the laundry shelf to the breakfast cupboard. Keep the little
            things in order, and make room for everyday life.
          </p>
        </div>
        <img
          className="auth-story-image"
          src={`${base}brand/household.png`}
          alt="Household essentials and pantry staples on a sunlit shelf"
        />
        <div className="auth-story-footer">
          <Leaf size={14} /> Thoughtfully stocked. Simply lived.
        </div>
      </section>
      <section className="auth-form-side" aria-labelledby="auth-heading">
        <div className="auth-topline">
          <Link href="/" className="auth-mobile-logo">
            <img
              src={`${base}brand/pantry-pal-logo.svg`}
              alt="Pantry Pal"
              width="157"
              height="44"
            />
          </Link>
          <span>A simpler way home.</span>
        </div>
        <div className="auth-form-wrap">
          <img
            className="auth-tiny-mark"
            src={`${base}brand/pantry-pal-icon.svg`}
            alt=""
            width="38"
            height="38"
          />
          <div className="auth-eyebrow">Your home, in sync</div>
          <h2 id="auth-heading">
            {step === "otp"
              ? "A little check. Then home."
              : step === "success"
                ? "Make room for the everyday."
                : signup
                  ? "Make yourself at home."
                  : "Welcome home."}
          </h2>
          <p className="auth-subtitle">
            {step === "otp"
              ? "Confirm your mobile number to continue."
              : step === "success"
                ? "Your household essentials, a little more together."
                : "One mobile number. A little less to remember."}
          </p>
          {step === "mobile" && (
            <>
              <nav className="auth-tabs" aria-label="Account options">
                <Link href="/login" aria-current={!signup ? "page" : undefined}>
                  Sign in
                </Link>
                <Link href="/signup" aria-current={signup ? "page" : undefined}>
                  Sign up
                </Link>
              </nav>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  const message = mobileError(mobile);
                  setError(message);
                  if (message) {
                    mobileInput.current?.focus();
                    return;
                  }
                  setMobile(mobile.trim());
                  issueDemoCode();
                  setStep("otp");
                }}
              >
                <div className="auth-field">
                  <label htmlFor="auth-mobile">Mobile number</label>
                  <div className="auth-input-wrap auth-has-prefix">
                    <span className="auth-prefix">+91</span>
                    <input
                      ref={mobileInput}
                      id="auth-mobile"
                      name="mobile"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="9876543210"
                      required
                      value={mobile}
                      aria-invalid={!!error}
                      aria-describedby="auth-mobile-hint auth-error"
                      onBlur={() => setError(mobileError(mobile))}
                      onChange={(event) => {
                        setMobile(event.target.value);
                        setError("");
                      }}
                    />
                  </div>
                  <p className="auth-hint" id="auth-mobile-hint">
                    India · Enter your 10-digit mobile number.
                  </p>
                  <p className="auth-error" id="auth-error" aria-live="polite">
                    {error}
                  </p>
                </div>
                <button className="auth-submit" type="submit">
                  Get verification code <ArrowUpRight size={18} />
                </button>
                <p className="auth-new-account">
                  One step for sign-in and sign-up. No password needed.
                </p>
              </form>
            </>
          )}
          {step === "otp" && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const message = otpError(otp, expiresAt);
                setError(message);
                if (message) {
                  otpInput.current?.focus();
                  return;
                }
                setExpiresAt(0);
                setOtp("");
                setMobile("");
                setStep("success");
              }}
            >
              <div className="auth-number-summary">
                <span>
                  +91 {mobile.slice(0, 5)} {mobile.slice(5)}
                </span>
                <button
                  className="auth-text-button"
                  type="button"
                  onClick={reset}
                >
                  Change number
                </button>
              </div>
              <div className="auth-field">
                <label htmlFor="auth-otp">Verification code</label>
                <div className="auth-input-wrap">
                  <input
                    ref={otpInput}
                    id="auth-otp"
                    name="otp"
                    className="auth-otp-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                    required
                    value={otp}
                    aria-invalid={!!error}
                    aria-describedby="auth-otp-hint auth-error"
                    onChange={(event) => {
                      setOtp(event.target.value);
                      setError("");
                    }}
                  />
                </div>
                <p className="auth-hint" id="auth-otp-hint">
                  Enter the 6-digit code.
                </p>
                <p className="auth-error" id="auth-error" aria-live="polite">
                  {error}
                </p>
              </div>
              <button className="auth-submit" type="submit">
                Verify &amp; continue <ArrowUpRight size={18} />
              </button>
              <div className="auth-resend-row">
                <span>Need another code?</span>
                <button
                  className="auth-text-button"
                  type="button"
                  disabled={remaining > 0}
                  onClick={() => {
                    if (Date.now() < resendAt) return;
                    issueDemoCode();
                    setStatus(
                      `A fresh demo code is ready: ${DEMO_OTP}. No SMS was sent.`,
                    );
                    otpInput.current?.focus();
                  }}
                >
                  {remaining ? `Resend in ${remaining}s` : "Resend code"}
                </button>
              </div>
              <p className="auth-resend-status" role="status">
                {status}
              </p>
            </form>
          )}
          {step !== "success" ? (
            <aside className="auth-demo-notice">
              <strong>Interactive preview</strong>
              <p>
                No SMS is sent. Use demo code <b>{DEMO_OTP}</b> on the next
                screen. Real phone verification is not connected.
              </p>
            </aside>
          ) : (
            <div
              ref={successPanel}
              className="auth-success"
              tabIndex={-1}
              role="status"
            >
              <strong>You’re ready to explore.</strong>
              <p>
                The demo code was accepted. This preview has not verified your
                phone or created an account.
              </p>
              <Link href="/">
                Step into your home <ArrowUpRight size={16} />
              </Link>
              <button
                className="auth-text-button"
                type="button"
                onClick={reset}
              >
                Start again
              </button>
            </div>
          )}
        </div>
        <footer className="auth-form-footer">
          <span>© Pantry Pal · A little more in order.</span>
          <Link href="/">Explore the demo ↗</Link>
        </footer>
      </section>
    </main>
  );
}
