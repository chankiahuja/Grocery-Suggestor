package com.pantrypal;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Serve React's entry point for client routes without intercepting API or asset requests. */
@Controller
public class FrontendController {
    @GetMapping({"/", "/login", "/signup", "/inventory", "/shopping-lists", "/shopping-lists/{id}"})
    public String frontend() {
        return "forward:/index.html";
    }
}
