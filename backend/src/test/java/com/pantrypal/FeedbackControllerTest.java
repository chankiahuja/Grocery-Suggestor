package com.pantrypal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = {
    "pantrypal.support.email=support@example.test",
    "pantrypal.support.response-time=We aim to respond within two business days."
})
class FeedbackControllerTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean JavaMailSender mailSender;

    @BeforeEach
    void resetRateLimits() {
        jdbc.update("DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'feedback-ip:%'");
        reset(mailSender);
    }

    @Test
    void contactConfigurationIsPublicAndContainsOnlyConfiguredAddress() throws Exception {
        MvcResult result = mvc.perform(get("/api/feedback/config"))
            .andExpect(status().isOk()).andReturn();
        JsonNode config = json.readTree(result.getResponse().getContentAsString());
        assertThat(config.get("supportEmail").asText()).isEqualTo("support@example.test");
        assertThat(config.get("responseTime").asText()).isEqualTo("We aim to respond within two business days.");
    }

    @Test
    void hidesSupportAddressWhenExternalSmtpCredentialsAreMissing() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "", "", true, true, false);

        assertThat(controller.config().supportEmail()).isNull();
        assertThat(controller.config().responseTime()).isNull();
        verifyNoInteractions(mailSender);
    }

    @Test
    void hidesSupportAddressWhenExternalSmtpUsernameIsMissing() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "", "protected-test-password", true, true, true);

        assertThat(controller.config().supportEmail()).isNull();
        verifyNoInteractions(mailSender);
    }

    @Test
    void incompleteExternalSmtpReturnsUnavailableWithoutSendingMail() throws Exception {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "brevo-login", "", true, true, false);
        var isolatedMvc = MockMvcBuilders.standaloneSetup(controller).build();

        isolatedMvc.perform(get("/api/feedback/config"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.supportEmail").doesNotExist())
            .andExpect(jsonPath("$.responseTime").doesNotExist());
        isolatedMvc.perform(post("/api/feedback")
                .contentType("application/json")
                .content("{\"category\":\"other\",\"message\":\"A message\"}"))
            .andExpect(status().isServiceUnavailable());
        verifyNoInteractions(mailSender);
    }

    @Test
    void acceptsCompleteExternalSmtpConfiguration() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "brevo-login", "protected-test-password", true, true, true);

        assertThat(controller.config().supportEmail()).isEqualTo("support@example.test");
        assertThat(controller.config().responseTime()).isEqualTo("two days");
    }

    @Test
    void rejectsExternalSmtpWhenAuthenticationIsDisabled() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "brevo-login", "protected-test-password", false, true, true);

        assertThat(controller.config().supportEmail()).isNull();
        verifyNoInteractions(mailSender);
    }

    @Test
    void rejectsExternalSmtpWhenStarttlsIsNotRequired() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "brevo-login", "protected-test-password", true, true, false);

        assertThat(controller.config().supportEmail()).isNull();
        verifyNoInteractions(mailSender);
    }

    @Test
    void rejectsExternalSmtpWhenStarttlsIsNotEnabled() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "smtp.example.test", 2525, "brevo-login", "protected-test-password", true, false, true);

        assertThat(controller.config().supportEmail()).isNull();
        verifyNoInteractions(mailSender);
    }

    @Test
    void localMailpitRemainsAvailableWithoutExternalCredentialsOrTls() {
        var controller = new FeedbackController(
            mailSender, mock(AuthRateLimiter.class), "support@example.test", "two days", "PantryPal <from@example.test>",
            "localhost", 1025, "", "", false, false, false);

        assertThat(controller.config().supportEmail()).isEqualTo("support@example.test");
        assertThat(controller.config().responseTime()).isEqualTo("two days");
    }

    @Test
    void acceptsAnonymousSubmissionOnlyWithCsrfAndSendsCategorizedMail() throws Exception {
        var browser = new AnonymousBrowser();
        browser.start();

        browser.submit("""
            {"category":"idea","subject":"A useful improvement","message":"Please add this feature.","email":"reply@example.test"}
            """, 200);

        var captor = org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mailSender).send(captor.capture());
        var message = captor.getValue();
        assertThat(message.getTo()).containsExactly("support@example.test");
        assertThat(message.getSubject()).isEqualTo("[PantryPal] A useful improvement");
        assertThat(message.getReplyTo()).isEqualTo("reply@example.test");
        assertThat(message.getText()).contains("Category: Suggest an idea", "Please add this feature.");
    }

    @Test
    void rejectsInvalidInputAndDoesNotSendMail() throws Exception {
        var browser = new AnonymousBrowser();
        browser.start();
        browser.submit("""
            {"category":"unexpected","message":"This should not be sent."}
            """, 400);
        verifyNoInteractions(mailSender);
    }

    @Test
    void rejectsInvalidReplyAddressAndOversizedMessage() throws Exception {
        var browser = new AnonymousBrowser();
        browser.start();
        browser.submit("""
            {"category":"other","message":"A question","email":"not-an-email"}
            """, 400);
        browser.submit(json.writeValueAsString(java.util.Map.of(
            "category", "other",
            "message", "x".repeat(2001)
        )), 400);
        verifyNoInteractions(mailSender);
    }

    @Test
    void appliesSubmissionCooldownAndDoesNotSendDuplicateMail() throws Exception {
        var browser = new AnonymousBrowser();
        browser.start();
        String body = """
            {"category":"other","message":"A question"}
            """;
        browser.submit(body, 200);
        browser.submit(body, 429);
        verify(mailSender, times(1)).send(any(SimpleMailMessage.class));
    }

    @Test
    void logsOnlyMailExceptionClassAndReturnsGenericMailFailure(CapturedOutput output) throws Exception {
        var browser = new AnonymousBrowser();
        browser.start();
        doThrow(new MailSendException("private smtp diagnostic"))
            .when(mailSender).send(any(SimpleMailMessage.class));

        String response = browser.submit("""
            {"category":"problem","subject":"private feedback subject","message":"private feedback message","email":"private-reply@example.test"}
            """, 503);
        assertThat(response).contains("could not be sent").doesNotContain("private smtp diagnostic");
        assertThat(output).contains("Feedback email delivery failed: MailSendException")
            .doesNotContain("private smtp diagnostic", "private feedback subject", "private feedback message", "private-reply@example.test");
    }

    @Test
    void rejectsUnsafeRequestWithoutCsrfToken() throws Exception {
        mvc.perform(post("/api/feedback").contentType("application/json")
                .content("""
                    {"category":"other","message":"A message"}
                    """))
            .andExpect(status().isForbidden());
        verifyNoInteractions(mailSender);
    }

    private final class AnonymousBrowser {
        private Cookie cookie;
        private String csrf;

        void start() throws Exception {
            MvcResult result = mvc.perform(get("/api/auth/session"))
                .andExpect(status().isOk()).andReturn();
            JsonNode session = json.readTree(result.getResponse().getContentAsString());
            csrf = session.get("csrfToken").asText();
            cookie = result.getResponse().getCookie("PANTRYPAL_SESSION");
        }

        String submit(String body, int expectedStatus) throws Exception {
            var request = post("/api/feedback")
                .cookie(cookie)
                .header("X-CSRF-TOKEN", csrf)
                .contentType("application/json")
                .content(body)
                .with(servletRequest -> {
                    servletRequest.setRemoteAddr("192.0.2.44");
                    return servletRequest;
                });
            MvcResult result = mvc.perform(request)
                .andExpect(status().is(expectedStatus)).andReturn();
            return result.getResponse().getContentAsString();
        }
    }
}
