package com.pantrypal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/** Delivery transport only: codes are generated and verified by AuthService. */
@Component
public class OtpMailSender {
    private final JavaMailSender sender;
    private final String from;
    public OtpMailSender(JavaMailSender sender, @Value("${pantrypal.auth.mail-from}") String from) {
        this.sender = sender;
        this.from = from;
    }
    public void send(String email, String code, long lifetimeSeconds) {
        var message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("Your PantryPal verification code");
        message.setText("Your PantryPal code is: " + code + "\n\nIt expires in " + lifetimeSeconds
            + " seconds and can be used once. If you did not request it, ignore this email.");
        sender.send(message);
    }
}
