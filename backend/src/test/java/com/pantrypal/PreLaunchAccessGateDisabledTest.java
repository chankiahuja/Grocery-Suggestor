package com.pantrypal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "pantrypal.prelaunch-gate.enabled=false")
@AutoConfigureMockMvc
class PreLaunchAccessGateDisabledTest {
    @Autowired MockMvc mvc;

    @Test
    void normalPublicAndSessionRoutesRemainUnchangedWhenGateIsDisabled() throws Exception {
        mvc.perform(get("/")).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        mvc.perform(get("/api/auth/session"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authenticated").value(false))
            .andExpect(header().doesNotExist("WWW-Authenticate"));
        mvc.perform(get("/api/inventory"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Sign in to continue"))
            .andExpect(header().doesNotExist("WWW-Authenticate"));
    }
}
