package com.pantrypal;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "pantrypal.prelaunch-gate.enabled=true",
    "pantrypal.prelaunch-gate.username=validation-operator",
    "pantrypal.prelaunch-gate.password=Correct-Horse-Battery-2026!"
})
@AutoConfigureMockMvc
class PreLaunchAccessGateTest {
    @Autowired MockMvc mvc;

    @Test void healthCheckRemainsPublic() throws Exception {
        mvc.perform(get("/api/healthz")).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test void anonymousFrontendAndApiAccessIsBlocked() throws Exception {
        mvc.perform(get("/")).andExpect(status().isUnauthorized());
        mvc.perform(get("/index.html")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/session")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/code")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/verify")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/feedback/config")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/feedback")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/inventory")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/inventory")).andExpect(status().isUnauthorized());
    }

    @Test void invalidCredentialsAreRejectedWithoutSecretDisclosure() throws Exception {
        var invalid = basic("validation-operator", "wrong-password");
        mvc.perform(get("/").header("Authorization", invalid))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", "Basic realm=\"PantryPal pre-launch validation\", charset=\"UTF-8\""))
            .andExpect(content().string(""));
    }

    @Test void validOperatorCredentialsPermitNormalValidationAccess() throws Exception {
        var valid = basic("validation-operator", "Correct-Horse-Battery-2026!");
        mvc.perform(get("/").header("Authorization", valid))
            .andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/index.html").header("Authorization", valid))
            .andExpect(status().isOk());
        mvc.perform(get("/api/auth/session").header("Authorization", valid))
            .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test void gateConfigurationFailsSafelyWhenCredentialsAreMissingOrWeak() {
        assertThatThrownBy(() -> PreLaunchAccessGateConfiguration.validate("", "long-enough-password-123"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> PreLaunchAccessGateConfiguration.validate("ops:validation", "long-enough-password-123"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> PreLaunchAccessGateConfiguration.validate("operator", "short"))
            .isInstanceOf(IllegalStateException.class);
    }

    private static String basic(String username, String password) {
        return "Basic " + Base64.getEncoder().encodeToString(
            (username + ":" + password).getBytes(StandardCharsets.UTF_8));
    }
}
