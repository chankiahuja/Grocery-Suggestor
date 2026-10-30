import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, Leaf } from "lucide-react";
import { useCompletePreview } from "@/lib/preview-access";
import {
  DEMO_OTP,
  OTP_LIFETIME_MS,
  RESEND_COOLDOWN_MS,
  mobileError,
  emailError,
  otpError,
} from "@/lib/demo-auth";

export default function Auth() {
  const completePreview = useCompletePreview();
  const [location, navigate] = useLocation();
  const signup = location === "/signup";
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [method, setMethod] = useState<"mobile" | "email">("mobile");
  const isEmail = method === "email";
  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [nameError, setNameError] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const identifierInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const base = import.meta.env?.BASE_URL ?? "/";
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function reset() {
    setStep("mobile");
    setOtp("");
    setError("");
    setStatus("");
    setExpiresAt(0);
    setResendAt(0);
  }
  function identifierError(value: string) {
    const message = isEmail ? emailError(value) : mobileError(value);
    if (!message && isEmail && identifierInput.current?.validity.typeMismatch) {
      return "Enter a valid email address, such as you@example.com.";
    }
    return message;
  }
  useEffect(() => {
    reset();
    setIdentifier("");
    setFullName("");
    setNameError("");
  }, [location]);
  useEffect(() => {
    if (step !== "otp") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);
  useEffect(() => {
    if (step === "mobile") {
      if (signup && !fullName) nameInput.current?.focus();
      else identifierInput.current?.focus();
    }
    if (step === "otp") otpInput.current?.focus();
  }, [step, location, method]);

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
              : signup
                ? "A little more together."
                : "Welcome home."}
          </h2>
          <p className="auth-subtitle">
            {step === "otp"
              ? `Confirm your ${isEmail ? "email address" : "mobile number"} to continue.`
              : signup
                ? "Create your account. Make room for simpler days."
                : "Your email or mobile. No password to remember."}
          </p>
          {step === "mobile" && (
            <>
              <nav className="auth-account-tabs" aria-label="Account options">
                <Link href="/login" aria-current={!signup ? "page" : undefined}>
                  Sign in
                </Link>
                <Link href="/signup" aria-current={signup ? "page" : undefined}>
                  Create account
                </Link>
              </nav>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  const missingName = signup && !fullName.trim();
                  setNameError(missingName ? "Enter your name." : "");
                  const message = identifierError(identifier);
                  setError(message);
                  if (missingName) {
                    nameInput.current?.focus();
                    return;
                  }
                  if (message) {
                    identifierInput.current?.focus();
                    return;
                  }
                  setIdentifier(identifier.trim());
                  issueDemoCode();
                  setStep("otp");
                }}
              >
                {signup && (
                  <div className="auth-field">
                    <label htmlFor="auth-name">Your name</label>
                    <div className="auth-input-wrap">
                      <input
                        ref={nameInput}
                        id="auth-name"
                        name="fullName"
                        type="text"
                        autoComplete="name"
                        placeholder="What should we call you?"
                        maxLength={100}
                        required
                        value={fullName}
                        aria-invalid={!!nameError}
                        aria-describedby="auth-name-error"
                        onBlur={() =>
                          setNameError(
                            fullName.trim() ? "" : "Enter your name.",
                          )
                        }
                        onChange={(event) => {
                          setFullName(event.target.value);
                          setNameError("");
                        }}
                      />
                    </div>
                    <p
                      id="auth-name-error"
                      className="auth-error"
                      aria-live="polite"
                    >
                      {nameError}
                    </p>
                  </div>
                )}
                <div
                  className="auth-tabs auth-methods"
                  role="group"
                  aria-label="Choose mobile number or email"
                >
                  {(["mobile", "email"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={method === option}
                      onClick={() => {
                        if (option === method) return;
                        reset();
                        setIdentifier("");
                        setMethod(option);
                      }}
                    >
                      {option === "email" ? "Email address" : "Mobile number"}
                    </button>
                  ))}
                </div>
                <div className="auth-field">
                  <label htmlFor="auth-mobile">
                    {isEmail ? "Email address" : "Mobile number"}
                  </label>
                  <div
                    className={`auth-input-wrap${isEmail ? "" : " auth-has-prefix"}`}
                  >
                    {!isEmail && <span className="auth-prefix">+91</span>}
                    <input
                      ref={identifierInput}
                      id="auth-mobile"
                      name={method}
                      type={isEmail ? "email" : "tel"}
                      inputMode={isEmail ? "email" : "numeric"}
                      autoComplete={isEmail ? "email" : "tel-national"}
                      placeholder={isEmail ? "you@example.com" : "9876543210"}
                      required
                      value={identifier}
                      aria-invalid={!!error}
                      aria-describedby="auth-mobile-hint auth-error"
                      onBlur={() => setError(identifierError(identifier))}
                      onChange={(event) => {
                        setIdentifier(event.target.value);
                        setError("");
                      }}
                    />
                  </div>
                  <p className="auth-hint" id="auth-mobile-hint">
                    {isEmail
                      ? "We'll use a one-time code to confirm your email."
                      : "India · Enter your 10-digit mobile number."}
                  </p>
                  <p className="auth-error" id="auth-error" aria-live="polite">
                    {error}
                  </p>
                </div>
                <button className="auth-submit" type="submit">
                  Get verification code <ArrowUpRight size={18} />
                </button>
                <p className="auth-new-account">
                  {signup
                    ? "Verify your email or mobile to create your account."
                    : "Sign in with a one-time code. No password needed."}
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
                setIdentifier("");
                setFullName("");
                setNameError("");
                completePreview();
                navigate("/dashboard", { replace: true });
              }}
            >
              <div className="auth-number-summary">
                <span>
                  {isEmail
                    ? identifier
                    : `+91 ${identifier.slice(0, 5)} ${identifier.slice(5)}`}
                </span>
                <button
                  className="auth-text-button"
                  type="button"
                  onClick={reset}
                >
                  {isEmail ? "Change email" : "Change number"}
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
                      `A fresh demo code is ready: ${DEMO_OTP}. No ${isEmail ? "email" : "SMS"} was sent.`,
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
          <aside className="auth-demo-notice">
            <strong>Interactive preview</strong>
            <p>
              No SMS or email is sent. Use demo code <b>{DEMO_OTP}</b> on the
              next screen. Real verification is not connected; no account or
              authenticated session is created.
            </p>
          </aside>
        </div>
        <footer className="auth-form-footer">
          <span>© Pantry Pal · A little more in order.</span>
          <Link href="/login">Sign in to explore ↗</Link>
        </footer>
      </section>
    </main>
  );
}
