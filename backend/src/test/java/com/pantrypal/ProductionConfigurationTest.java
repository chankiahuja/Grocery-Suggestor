package com.pantrypal;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductionConfigurationTest {
    @Test
    void acceptsSecureCookiesAndStableOtpSecret() {
        assertThatCode(() -> ProductionConfiguration
            .validate(true, "0123456789abcdef0123456789abcdef", "test-user", "test-password", true, true, true))
            .doesNotThrowAnyException();
    }

    @Test
    void acceptsExplicitlyOptionalSmtpWithoutCredentials() {
        assertThatCode(() -> ProductionConfiguration
            .validate(true, "0123456789abcdef0123456789abcdef", "", "", false, false, false))
            .doesNotThrowAnyException();
    }

    @Test
    void rejectsDisabledSecureCookies() {
        assertThatThrownBy(() -> ProductionConfiguration
            .validate(false, "0123456789abcdef0123456789abcdef", "test-user", "test-password", true, true, true))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Production requires AUTH_COOKIE_SECURE=true.");
    }

    @Test
    void rejectsMissingOrShortOtpSecret() {
        assertThatThrownBy(() -> ProductionConfiguration
            .validate(true, "short", "test-user", "test-password", true, true, true))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Production requires AUTH_OTP_SECRET to contain at least 32 bytes.");
    }

    @Test
    void rejectsMissingSmtpWhenRequiredAndInsecurePartialConfiguration() {
        assertThatThrownBy(() -> ProductionConfiguration
            .validate(true, "0123456789abcdef0123456789abcdef", "", "", true, true, true))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Production requires SMTP credentials, authentication, and STARTTLS.");

        assertThatThrownBy(() -> ProductionConfiguration
            .validate(true, "0123456789abcdef0123456789abcdef", "test-user", "", true, true, false))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Production requires SMTP credentials, authentication, and STARTTLS.");
    }
}
