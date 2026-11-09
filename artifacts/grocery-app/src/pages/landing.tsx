import { ArrowUpRight, Leaf } from "lucide-react";
import { Link } from "wouter";

export default function Landing() {
  const base = import.meta.env?.BASE_URL ?? "/";

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <Link href="/" aria-label="Pantry Pal home">
          <img
            src={`${base}brand/pantry-pal-logo.svg`}
            alt="Pantry Pal"
            width="208"
            height="50"
          />
        </Link>
        <nav aria-label="Main navigation">
          <a className="landing-about-link" href="#how-it-works">How it works</a>
          <Link className="landing-sign-in" href="/login">Sign in</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><span /> YOUR HOME, IN SYNC</div>
            <h1 id="landing-heading">Your home.<br /><em>A little more in order.</em></h1>
            <p>Track groceries, cleaning supplies and personal care. See what&apos;s running low and plan your next shop.</p>
            <div className="landing-actions">
              <Link className="landing-button" href="/signup">Create account <ArrowUpRight size={16} /></Link>
            </div>
            <p className="landing-access-note">Sign in with a one-time code by email.</p>
            <Link className="landing-demo-link" href="/login">Explore the sample dashboard <ArrowUpRight size={14} /></Link>
          </div>
          <div className="landing-visual">
            <img
              src={`${base}brand/household.png`}
              alt="Pantry staples, toiletries and cleaning essentials arranged on a sunlit household shelf"
              width="1024"
              height="1024"
            />
          </div>
        </section>

        <section id="how-it-works" className="landing-how-it-works" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <div className="landing-feature-grid">
            <article><span className="landing-feature-number">01</span><h3>Home inventory</h3><p>See what you have and what&apos;s running low.</p></article>
            <article><span className="landing-feature-number">02</span><h3>Shopping list</h3><p>Put everything you need to restock on one list.</p></article>
            <article><span className="landing-feature-number">03</span><h3>Wishlist</h3><p>Save items for later and move them to your list when ready.</p></article>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span><Leaf size={13} /> Thoughtfully stocked. Simply lived.</span>
        <Link href="/contact">Contact &amp; Feedback</Link>
        <span>© Pantry Pal · A little more in order.</span>
      </footer>
    </div>
  );
}
