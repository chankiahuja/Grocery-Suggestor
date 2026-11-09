package com.pantrypal;

import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class MailSecurityConfig {
    @Bean
    ApplicationRunner validateExternalSmtpConfiguration(
            @Value("${spring.mail.host:}") String host,
            @Value("${spring.mail.port:0}") int port,
            @Value("${spring.mail.username:}") String username,
            @Value("${spring.mail.properties.mail.smtp.auth:false}") boolean smtpAuth,
            @Value("${spring.mail.properties.mail.smtp.starttls.enable:false}") boolean startTlsEnabled,
            @Value("${spring.mail.properties.mail.smtp.starttls.required:false}") boolean startTlsRequired) {
        return (ApplicationArguments args) -> {
            if (isLocalMailpit(host, port)) {
                return;
            }

            if (!username.isBlank() && smtpAuth && !startTlsEnabled && !startTlsRequired) {
                throw new IllegalStateException(
                        "External SMTP authentication requires STARTTLS. Set MAIL_STARTTLS=true or use the local Mailpit default.");
            }
        };
    }

    private static boolean isLocalMailpit(String host, int port) {
        String normalized = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        return normalized.isEmpty()
                || "localhost".equals(normalized)
                || "127.0.0.1".equals(normalized)
                || "::1".equals(normalized)
                || "mailpit".equals(normalized)
                || port == 1025 && ("localhost".equals(normalized) || "mailpit".equals(normalized) || "127.0.0.1".equals(normalized) || "::1".equals(normalized));
    }
}
