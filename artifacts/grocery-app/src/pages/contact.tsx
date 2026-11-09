import { ArrowLeft, LifeBuoy, Mail } from "lucide-react";
import { Link } from "wouter";
import { useGetFeedbackConfig } from "@workspace/api-client-react";
import { FeedbackForm } from "@/components/feedback-form";
import { useSessionAccess } from "@/lib/preview-access";

export default function Contact() {
  const { account } = useSessionAccess();
  const config = useGetFeedbackConfig();
  const base = import.meta.env?.BASE_URL ?? "/";
  const supportEmail = config.data?.supportEmail;
  const responseTime = config.data?.responseTime;

  return (
    <div className="contact-shell">
      <header className="contact-header">
        <Link href="/" aria-label="Pantry Pal home">
          <img src={`${base}brand/pantry-pal-logo.svg`} alt="Pantry Pal" width="208" height="50" />
        </Link>
        <Link className="contact-back-link" href={account ? "/dashboard" : "/"}>
          <ArrowLeft size={16} aria-hidden="true" /> {account ? "Back to PantryPal" : "Back to home"}
        </Link>
      </header>
      <main className="contact-main">
        <div className="contact-heading">
          <span className="contact-eyebrow"><LifeBuoy size={15} aria-hidden="true" /> CONTACT &amp; FEEDBACK</span>
          <h1>We&apos;re here to help</h1>
          <p>Questions, a problem to report, or an idea to share? Send us a note and we&apos;ll take a look.</p>
        </div>
        <div className="contact-grid">
          <section className="contact-form-card" aria-labelledby="contact-form-heading">
            <h2 id="contact-form-heading">Send a message</h2>
            <p className="contact-card-intro">Your message and optional reply email are sent to PantryPal support. Please don&apos;t include passwords, one-time codes, or pantry details.</p>
            <FeedbackForm initialEmail={account?.email ?? ""} />
          </section>
          <aside className="contact-support-card" aria-labelledby="support-card-heading">
            <div className="contact-support-icon"><Mail size={21} aria-hidden="true" /></div>
            <h2 id="support-card-heading">Contact support</h2>
            {config.isLoading ? (
              <p role="status">Checking support contact details…</p>
            ) : supportEmail ? (
              <>
                <a className="contact-support-email" href={`mailto:${supportEmail}`}>{supportEmail}</a>
                <p>Share only the information needed to help with your request. We use your reply email only to respond.</p>
                {responseTime && <p className="contact-response-time">{responseTime}</p>}
              </>
            ) : (
              <p role={config.isError ? "alert" : undefined}>
                {config.isError
                  ? "Support contact details are temporarily unavailable. Please try again later."
                  : "A support email address has not been configured yet. Please try again later."}
              </p>
            )}
          </aside>
        </div>
      </main>
      <footer className="contact-footer">
        <span>PantryPal support will never ask for your password or one-time code.</span>
        <Link href={account ? "/dashboard" : "/"}>Return to PantryPal</Link>
      </footer>
    </div>
  );
}
