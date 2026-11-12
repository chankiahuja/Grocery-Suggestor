package com.pantrypal;

import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.mail.MailSenderAutoConfiguration;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.core.io.ClassPathResource;
import static org.assertj.core.api.Assertions.*;

class OtpMailTransportTest {
    @Test
    void testAndProductionConfigurationRemainSeparate() throws Exception {
        var loader = new YamlPropertySourceLoader();
        var test = loader.load("test", new ClassPathResource("application.yml")).get(0);
        var production = loader.load("production", new ClassPathResource("production-config/application.yml")).get(0);
        assertThat(test.getProperty("spring.datasource.url").toString()).startsWith("jdbc:h2:mem:pantry;");
        for (String key : new String[] {"connectiontimeout", "timeout", "writetimeout"}) {
            String property = "spring.mail.properties.mail.smtp." + key;
            assertThat(test.getProperty(property)).isNull();
            assertThat(production.getProperty(property)).hasToString("5000");
        }
    }

    @Test
    void productionEnablesSmtpServerIdentityChecking() throws Exception {
        var loader = new YamlPropertySourceLoader();
        var production = loader.load("production", new ClassPathResource("application-production.yml")).get(0);

        assertThat(production.getProperty("spring.mail.port")).hasToString("${MAIL_PORT:2525}");
        assertThat(production.getProperty("spring.mail.properties.mail.smtp.auth")).isEqualTo(true);
        assertThat(production.getProperty("spring.mail.properties.mail.smtp.starttls.enable")).isEqualTo(true);
        assertThat(production.getProperty("spring.mail.properties.mail.smtp.starttls.required")).isEqualTo(true);
        assertThat(production.getProperty("spring.mail.properties.mail.smtp.ssl.checkserveridentity"))
            .isEqualTo(true);
    }

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
                        "spring.config.location=classpath:/production-config/application.yml",
                        "spring.mail.host=127.0.0.1", "spring.mail.port=" + server.getLocalPort(),
                        "spring.mail.username=", "spring.mail.password=",
                        "spring.mail.properties.mail.smtp.auth=false",
                        "spring.mail.properties.mail.smtp.starttls.enable=false",
                        "spring.mail.properties.mail.smtp.starttls.required=false")
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        var sender = context.getBean(JavaMailSenderImpl.class);
                        var properties = sender.getJavaMailProperties();
                        // This is a build-time copy of production application.yml,
                        // not the same-named test configuration or timeout overrides.
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
