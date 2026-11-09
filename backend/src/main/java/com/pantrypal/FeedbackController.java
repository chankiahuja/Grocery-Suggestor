package com.pantrypal;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/feedback")
public class FeedbackController {
    private static final Logger log = LoggerFactory.getLogger(FeedbackController.class);

    public record Submission(String category, String subject, String message, String email) {}
    public record ContactConfig(String supportEmail, String responseTime) {}

    private static final int MESSAGE_MAX_LENGTH = 2000;
    private static final int SUBJECT_MAX_LENGTH = 120;
    private static final int EMAIL_MAX_LENGTH = 254;
    private static final int RESPONSE_TIME_MAX_LENGTH = 120;
    private static final String EMAIL_PATTERN = "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";
    private final String supportEmail;
    private final String responseTime;
    private final String from;
    private final JavaMailSender mailSender;
    private final AuthRateLimiter rateLimiter;

    public FeedbackController(
        JavaMailSender mailSender,
        AuthRateLimiter rateLimiter,
        @Value("${pantrypal.support.email:}") String supportEmail,
        @Value("${pantrypal.support.response-time:}") String responseTime,
        @Value("${pantrypal.auth.mail-from}") String from
    ) {
        this.mailSender = mailSender;
        this.rateLimiter = rateLimiter;
        this.supportEmail = supportEmail.trim();
        this.responseTime = responseTime.trim();
        if (!this.supportEmail.isEmpty() && !isValidEmail(this.supportEmail)) {
            throw new IllegalArgumentException("PANTRYPAL_SUPPORT_EMAIL must be a valid email address");
        }
        if (this.responseTime.length() > RESPONSE_TIME_MAX_LENGTH
            || this.responseTime.contains("\r") || this.responseTime.contains("\n")) {
            throw new IllegalArgumentException("PANTRYPAL_SUPPORT_RESPONSE_TIME must be a single line of at most 120 characters");
        }
        this.from = from;
    }

    @GetMapping("/config")
    public ContactConfig config() {
        return new ContactConfig(supportEmail.isEmpty() ? null : supportEmail, responseTime.isEmpty() ? null : responseTime);
    }

    @PostMapping
    public Map<String, Boolean> submit(@RequestBody Submission body, HttpServletRequest request) {
        validate(body);
        if (!isValidEmail(supportEmail)) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Support is not configured yet. Please try again later.");
        }

        rateLimiter.claim("feedback-ip", request.getRemoteAddr(), 5, 10_000);
        String category = switch (body.category()) {
            case "problem" -> "Report a problem";
            case "idea" -> "Suggest an idea";
            case "other" -> "Other";
            default -> throw new IllegalStateException("Validated feedback category was not recognized");
        };
        var mail = new SimpleMailMessage();
        mail.setFrom(from);
        mail.setTo(supportEmail);
        mail.setSubject("[PantryPal] " + (body.subject() == null || body.subject().isBlank() ? category : body.subject().trim()));
        mail.setText("Category: " + category + "\n"
            + (body.email() == null || body.email().isBlank() ? "" : "Reply email: " + body.email().trim() + "\n")
            + "\nMessage:\n" + body.message().trim());
        if (body.email() != null && !body.email().isBlank()) mail.setReplyTo(body.email().trim());

        try {
            mailSender.send(mail);
        } catch (MailException failure) {
            log.warn("Feedback email delivery failed: {}", failure.getClass().getSimpleName());
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Your message could not be sent. Please try again or use the support email link.");
        }
        return Map.of("accepted", true);
    }

    private static void validate(Submission body) {
        if (body == null) throw badRequest("Enter a message");
        if (body.category() == null || !body.category().matches("problem|idea|other")) {
            throw badRequest("Choose a message category");
        }
        if (body.message() == null || body.message().isBlank()) throw badRequest("Enter a message");
        if (body.message().length() > MESSAGE_MAX_LENGTH) throw badRequest("Message must be 2000 characters or fewer");
        if (body.subject() != null && (body.subject().length() > SUBJECT_MAX_LENGTH
            || body.subject().contains("\r") || body.subject().contains("\n"))) {
            throw badRequest("Subject must be 120 characters or fewer and fit on one line");
        }
        if (body.email() != null) {
            String email = body.email().trim();
            if (email.isEmpty() || email.length() > EMAIL_MAX_LENGTH || !isValidEmail(email)) {
                throw badRequest("Enter a valid reply email address");
            }
        }
    }

    private static boolean isValidEmail(String email) {
        return email != null && email.length() <= EMAIL_MAX_LENGTH && email.matches(EMAIL_PATTERN);
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
