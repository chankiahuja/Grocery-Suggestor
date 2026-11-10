package com.pantrypal;

import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("production")
public class ProductionConfiguration {
    public ProductionConfiguration(
            @Value("${pantrypal.auth.cookie-secure:true}") boolean secureCookie,
            @Value("${pantrypal.auth.otp-secret:}") String otpSecret,
            @Value("${spring.mail.username:}") String mailUsername,
            @Value("${spring.mail.password:}") String mailPassword,
            @Value("${spring.mail.properties.mail.smtp.auth:false}") boolean smtpAuth,
            @Value("${spring.mail.properties.mail.smtp.starttls.enable:false}") boolean startTls,
            @Value("${pantrypal.smtp-required:true}") boolean smtpRequired) {
        validate(secureCookie, otpSecret, mailUsername, mailPassword, smtpAuth, startTls, smtpRequired);
    }

    static void validate(
            boolean secureCookie,
            String otpSecret,
            String mailUsername,
            String mailPassword,
            boolean smtpAuth,
            boolean startTls,
            boolean smtpRequired) {
        if (!secureCookie) {
            throw new IllegalStateException("Production requires AUTH_COOKIE_SECURE=true.");
        }
        if (otpSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("Production requires AUTH_OTP_SECRET to contain at least 32 bytes.");
        }
        if (mailUsername.isBlank() && mailPassword.isBlank() && !smtpRequired) {
            return;
        }
        if (mailUsername.isBlank() || mailPassword.isBlank() || !smtpAuth || !startTls) {
            throw new IllegalStateException(
                "Production requires SMTP credentials, authentication, and STARTTLS.");
        }
    }
}
