package com.pantrypal;

import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.mail.MailSenderAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import static org.assertj.core.api.Assertions.*;

class OtpMailTransportTest {
    @Test
    @Timeout(20)
    void configuredReadTimeoutBoundsAnUnresponsiveSmtpServer() throws Exception {
        try (var server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10_000);
            var release = new CountDownLatch(1);
            var executor = Executors.newSingleThreadExecutor();
            var connection = executor.submit(() -> {
                try (var socket = server.accept()) {
                    // Accept TCP but never send the SMTP greeting.
                    release.await(15, TimeUnit.SECONDS);
                }
                return null;
            });
            try {
                new ApplicationContextRunner()
                    .withInitializer(new ConfigDataApplicationContextInitializer())
                    .withConfiguration(AutoConfigurations.of(MailSenderAutoConfiguration.class))
                    .withPropertyValues(
                        "spring.config.location=file:src/main/resources/application.yml",
                        "spring.mail.host=127.0.0.1", "spring.mail.port=" + server.getLocalPort(),
                        "spring.mail.username=", "spring.mail.password=",
                        "spring.mail.properties.mail.smtp.auth=false",
                        "spring.mail.properties.mail.smtp.starttls.enable=false",
                        "spring.mail.properties.mail.smtp.starttls.required=false")
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        var sender = context.getBean(JavaMailSenderImpl.class);
                        var properties = sender.getJavaMailProperties();
                        // Values come from application.yml, not test overrides.
                        for (String key : new String[] {"connectiontimeout", "timeout", "writetimeout"}) {
                            assertThat(properties.getProperty("mail.smtp." + key)).isEqualTo("5000");
                        }
                        var mail = new OtpMailSender(sender, "PantryPal <no-reply@pantrypal.test>");
                        assertThatThrownBy(() -> mail.send("test@example.com", "654321", 300))
                            .isInstanceOf(MailException.class)
                            .hasRootCauseInstanceOf(SocketTimeoutException.class);
                    });
                release.countDown();
                connection.get(5, TimeUnit.SECONDS);
            } finally {
                release.countDown();
                server.close();
                executor.shutdown();
                assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            }
        }
    }
}
