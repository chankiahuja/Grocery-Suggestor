import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackForm } from "@/components/feedback-form";

export function QuickFeedbackDialog({ email, open, onOpenChange }: {
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="feedback-dialog">
        <DialogHeader>
          <DialogTitle>Share feedback</DialogTitle>
          <DialogDescription>A quick note helps us make PantryPal better. For a detailed support request, use the <Link className="feedback-inline-link" href="/contact">Contact &amp; Feedback page</Link>.</DialogDescription>
        </DialogHeader>
        <FeedbackForm initialEmail={email} compact />
      </DialogContent>
    </Dialog>
  );
}
