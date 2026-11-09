import { useRef, useState } from "react";
import { Link } from "wouter";
import { useGetFeedbackConfig, useSubmitFeedback, type FeedbackSubmission } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const categories = [
  { value: "problem", label: "Report a problem" },
  { value: "idea", label: "Suggest an idea" },
  { value: "other", label: "Other" },
] as const;

function mailtoHref(address: string, category: string, subject: string, message: string, email: string) {
  const body = [
    `Category: ${categories.find(item => item.value === category)?.label ?? "Other"}`,
    email.trim() ? `Reply email: ${email.trim()}` : "",
    "",
    message.trim(),
  ].filter((line, index) => line || index < 3).join("\n");
  const params = new URLSearchParams({ subject: subject.trim() || "PantryPal feedback", body });
  return `mailto:${address}?${params.toString()}`;
}

export function FeedbackForm({ initialEmail = "", compact = false }: { initialEmail?: string; compact?: boolean }) {
  const supportConfig = useGetFeedbackConfig();
  const submission = useSubmitFeedback();
  const [category, setCategory] = useState<FeedbackSubmission["category"]>("problem");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [emailError, setEmailError] = useState("");
  const pendingRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || submission.isPending) return;
    if (!message.trim()) {
      setMessageError("Enter a message.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setMessageError("");
    setEmailError("");
    const data: FeedbackSubmission = {
      category,
      message: message.trim(),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    pendingRef.current = true;
    try {
      await submission.mutateAsync({ data });
      setMessage("");
      setSubject("");
      setSent(true);
    } catch {
      // Keep every field intact so the user can retry or use the mail link.
    } finally {
      pendingRef.current = false;
    }
  }

  if (sent) {
    return (
      <div className="feedback-success" role="status">
        <h3>Message sent</h3>
        <p>Thanks for reaching out. Your message was accepted by PantryPal support.</p>
        <div className="feedback-actions">
          <Button type="button" variant="outline" onClick={() => setSent(false)}>Send another message</Button>
          {!compact && <Button asChild variant="link"><Link href="/">Return to PantryPal</Link></Button>}
        </div>
      </div>
    );
  }

  const mailto = supportConfig.data?.supportEmail
    ? mailtoHref(supportConfig.data.supportEmail, category, subject, message, email)
    : undefined;
  const supportUnavailable = supportConfig.data !== undefined && !supportConfig.data.supportEmail;

  return (
    <form className={`feedback-form${compact ? " is-compact" : ""}`} onSubmit={event => void submit(event)} noValidate>
      <div className="feedback-field">
        <label htmlFor={`feedback-category-${compact ? "quick" : "full"}`}>Category</label>
        <select
          id={`feedback-category-${compact ? "quick" : "full"}`}
          value={category}
          onChange={event => setCategory(event.target.value as FeedbackSubmission["category"])}
          disabled={submission.isPending}
        >
          {categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      {!compact && (
        <div className="feedback-field">
          <label htmlFor="feedback-subject">Subject <span>(optional)</span></label>
          <input id="feedback-subject" value={subject} maxLength={120} onChange={event => setSubject(event.target.value)} disabled={submission.isPending} />
        </div>
      )}
      <div className="feedback-field">
        <label htmlFor={`feedback-message-${compact ? "quick" : "full"}`}>Message <span className="feedback-required">Required</span></label>
        <textarea
          id={`feedback-message-${compact ? "quick" : "full"}`}
          value={message}
          maxLength={2000}
          rows={compact ? 5 : 8}
          required
          aria-invalid={Boolean(messageError)}
          aria-describedby={`feedback-message-hint-${compact ? "quick" : "full"}${messageError ? ` feedback-message-error-${compact ? "quick" : "full"}` : ""}`}
          disabled={submission.isPending}
          placeholder={compact ? "What would you like us to know?" : "Tell us what happened or what you have in mind."}
          onBlur={() => {
            if (!message.trim()) setMessageError("Enter a message.");
          }}
          onChange={event => {
            setMessage(event.target.value);
            if (event.target.value.trim()) setMessageError("");
          }}
        />
        {messageError && <span id={`feedback-message-error-${compact ? "quick" : "full"}`} className="feedback-validation-error">{messageError}</span>}
        <div className="feedback-field-meta">
          <span id={`feedback-message-hint-${compact ? "quick" : "full"}`}>Please don&apos;t include passwords, one-time codes, or pantry contents.</span>
          <span aria-live="polite">{message.length}/2000</span>
        </div>
      </div>
      <div className="feedback-field">
        <label htmlFor={`feedback-email-${compact ? "quick" : "full"}`}>
          {compact ? "Reply email" : "Contact email"} <span>(optional)</span>
        </label>
        <input
          id={`feedback-email-${compact ? "quick" : "full"}`}
          type="email"
          value={email}
          maxLength={254}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? `feedback-email-error-${compact ? "quick" : "full"}` : undefined}
          onChange={event => {
            setEmail(event.target.value);
            if (!event.target.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.target.value.trim())) setEmailError("");
          }}
          onBlur={() => {
            if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) setEmailError("Enter a valid email address.");
          }}
          disabled={submission.isPending}
          autoComplete="email"
          placeholder="you@example.com"
        />
        {emailError && <span id={`feedback-email-error-${compact ? "quick" : "full"}`} className="feedback-validation-error">{emailError}</span>}
        <p className="feedback-hint">We&apos;ll use this address only to reply to your message.</p>
      </div>
      {submission.isError && (
        <div className="feedback-error" role="alert">
          <p>Your message could not be sent. Your text is still here; please retry after a short wait{mailto ? " or email support directly." : "."}</p>
          {mailto && <a href={mailto}>Email support instead</a>}
        </div>
      )}
      {!supportConfig.isLoading && !supportConfig.data?.supportEmail && (
        <p className="feedback-hint" role={supportConfig.isError ? "alert" : undefined}>
          {supportConfig.isError
            ? "Support contact details are unavailable right now."
            : "Online support is not configured yet. You can still prepare a message, but it cannot be sent yet."}
        </p>
      )}
      <Button className="feedback-submit" type="submit" disabled={submission.isPending || supportUnavailable}>
        {submission.isPending ? "Sending…" : submission.isError ? "Try again" : compact ? "Send feedback" : "Send message"}
      </Button>
      <p className="feedback-privacy">PantryPal support will never ask for your password or one-time code.</p>
    </form>
  );
}
