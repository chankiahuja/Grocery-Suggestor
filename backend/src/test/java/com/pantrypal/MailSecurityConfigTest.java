package com.pantrypal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.ApplicationArguments;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class MailSecurityConfigTest {
    private final ApplicationArguments arguments = mock(ApplicationArguments.class);

    @Test
    void externalSmtpRequiresCredentialsAuthenticationAndBothTlsFlags() {
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "user", "password", true, true, true)).isTrue();
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "", "password", true, true, true)).isFalse();
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "user", "", true, true, true)).isFalse();
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "user", "password", false, true, true)).isFalse();
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "user", "password", true, true, false)).isFalse();
        assertThat(MailSecurityConfig.isConfigured(
            "smtp.example.test", 2525, "user", "password", true, false, true)).isFalse();
    }

    @Test
    void localMailpitDoesNotRequireExternalCredentialsOrTls() {
        assertThat(MailSecurityConfig.isConfigured(
            "localhost", 1025, "", "", false, false, false)).isTrue();
    }

    @Test
    void startupValidationRejectsAuthenticatedExternalSmtpWhenEitherTlsFlagIsFalse() {
        var config = new MailSecurityConfig();

        assertThatThrownBy(() -> config.validateExternalSmtpConfiguration(
            "smtp.example.test", 2525, "user", true, false, true).run(arguments))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> config.validateExternalSmtpConfiguration(
            "smtp.example.test", 2525, "user", true, true, false).run(arguments))
            .isInstanceOf(IllegalStateException.class);
    }
}
