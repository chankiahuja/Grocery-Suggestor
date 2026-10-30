package com.pantrypal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class FrontendRoutingTest {
    @Autowired MockMvc mvc;

    @Test void clientRoutesForwardToReact() throws Exception {
        for (String path : new String[]{"/", "/login", "/signup", "/dashboard", "/inventory", "/shopping-lists", "/shopping-lists/12"}) {
            mvc.perform(get(path)).andExpect(status().isOk()).andExpect(forwardedUrl("/index.html"));
        }
    }

    @Test void missingApisAndAssetsAreNotReplacedWithHtml() throws Exception {
        mvc.perform(get("/api/does-not-exist")).andExpect(status().isNotFound());
        mvc.perform(get("/assets/does-not-exist.js")).andExpect(status().isNotFound());
        mvc.perform(get("/api/healthz")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
    }

    @Test void unknownPageUrlsReachTheReactLoginGate() throws Exception {
        mvc.perform(get("/unknown/deep/page").accept("text/html"))
            .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("text/html"));
        mvc.perform(get("/assets/missing")).andExpect(status().isNotFound());
        mvc.perform(get("/brand/missing")).andExpect(status().isNotFound());
    }
}
