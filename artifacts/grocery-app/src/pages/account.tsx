import { useRef, useState } from "react";
import { Link } from "wouter";
import { deleteAccount, getAccountDeletionStatus, requestEmailCode, verifyEmailCode } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { useSessionAccess } from "@/lib/preview-access";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AccountSettings() {
  const session = useSessionAccess();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  async function begin() {
    if (busy.current) return;
    busy.current = true; setChecking(true); setOpen(true); setError(""); setNotice(""); setRecent(false); setChallenge(""); setCode("");
    try { setRecent((await getAccountDeletionStatus({ signal: AbortSignal.timeout(10_000) })).recentAuthentication); }
    catch { setError("We couldn't check your sign-in. Close this dialog and try again."); }
    finally { busy.current = false; setChecking(false); }
  }
  async function send() {
    if (busy.current || !session.account) return;
    if (Date.now() < resendAt) { setError("Wait for the resend cooldown before requesting another code."); return; }
    busy.current = true; setPending(true); setError(""); setNotice("");
    try {
      const result = await requestEmailCode({ email: session.account.email, intent: "login" }, { signal: AbortSignal.timeout(15_000) });
      setChallenge(result.challengeId); setResendAt(Date.parse(result.resendAt)); setCode("");
      setNotice("Code requested. Check your email inbox. Wait for the resend cooldown before requesting another.");
    } catch { setError("We couldn't request a code. Wait briefly and try again."); }
    finally { busy.current = false; setPending(false); }
  }
  async function verify() {
    if (busy.current || !session.account) return;
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your email."); return; }
    busy.current = true; setPending(true); setError("");
    try {
      const result = await verifyEmailCode({ email: session.account.email, challengeId: challenge, code }, { signal: AbortSignal.timeout(15_000) });
      session.signedIn(result); setRecent(true); setChallenge(""); setCode(""); setNotice("Email verified. Review the confirmation before deleting your account.");
    } catch { setError("Verification could not be confirmed. Check the code or request another after the cooldown."); }
    finally { busy.current = false; setPending(false); }
  }
  async function remove() {
    if (busy.current || !recent) return;
    busy.current = true; setPending(true); setError("");
    try {
      await deleteAccount({ signal: AbortSignal.timeout(20_000) });
      try { localStorage.removeItem(`pantrypal-seen-notifications:${session.account?.id}`); } catch { /* Storage may be disabled. */ }
      try { window.sessionStorage.setItem("pantrypal-deletion-confirmed", "1"); } catch { /* Navigation still signs out if storage is unavailable. */ }
      session.signedIn({ authenticated: false, account: null, csrfToken: "" });
      window.location.replace(import.meta.env?.BASE_URL ?? "/");
    } catch (failure) {
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 403) {
        setRecent(false); setChallenge(""); setCode("");
      }
      setError("Deletion could not be confirmed. Your account may have been deleted if the connection was interrupted. Check your sign-in before retrying, or contact support.");
    } finally { busy.current = false; setPending(false); }
  }
  return <Layout>
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="rounded-2xl border bg-card p-6">
        <h1 className="text-2xl font-semibold">Account settings</h1>
        <p className="mt-3 break-all">{session.account?.email ?? "Demo preview"}</p>
        <p className="mt-3"><Link href="/privacy" className="underline">Privacy notice</Link></p>
      </section>
      <section className="rounded-2xl border border-destructive/30 bg-card p-6" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="text-xl font-semibold">Delete account</h2>
        <p className="my-4">Permanently remove your account and its associated data from PantryPal's active application database. You cannot undo this action.</p>
        <p className="mb-4 text-sm">Support emails and backups require separate handling. Read the <Link href="/privacy" className="underline">privacy notice</Link> for these limits.</p>
        {session.demo ? <p>Account deletion is unavailable in the demo preview.</p> : <Button ref={trigger} variant="destructive" onClick={() => void begin()}>Delete account</Button>}
      </section>
    </div>
    <Dialog open={open} onOpenChange={value => { if (!busy.current) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Delete your PantryPal account?</DialogTitle>
          <DialogDescription>This permanently deletes your account, pantry items, adjustment history and shopping lists from the active application database. All sessions will be signed out. You can't undo this action.</DialogDescription>
        </DialogHeader>
        {checking ? <p role="status">Checking your sign-in…</p> : !recent && <div className="space-y-3">
          <p>Verify a fresh email code for {session.account?.email} before deleting your account.</p>
          <Button variant="outline" disabled={pending} onClick={() => void send()}>{challenge ? "Request another code" : "Request verification code"}</Button>
          {challenge && <>
            <label htmlFor="delete-code" className="block">Verification code</label>
            <Input id="delete-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? "delete-error" : undefined} onChange={event => setCode(event.target.value)} />
            <Button disabled={pending} onClick={() => void verify()}>Verify email</Button>
          </>}
        </div>}
        {notice && <p role="status">{notice}</p>}
        {error && <p id="delete-error" role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={pending || checking} onClick={() => setOpen(false)}>Keep my account</Button>
          <Button variant="destructive" disabled={!recent || pending || checking} onClick={() => void remove()}>{pending && recent ? "Deleting your account…" : "Delete account"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </Layout>;
}
