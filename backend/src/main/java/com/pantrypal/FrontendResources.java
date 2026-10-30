package com.pantrypal;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
public class FrontendResources implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**").addResourceLocations("classpath:/static/")
            .resourceChain(true).addResolver(new PathResourceResolver() {
                @Override
                protected Resource getResource(String path, Resource location) throws IOException {
                    Resource existing = super.getResource(path, location);
                    if (existing != null) return existing;
                    // Only page URLs fall back to React; missing APIs and assets retain 404s.
                    if (path.equals("api") || path.startsWith("api/") || path.startsWith("assets/")
                        || path.startsWith("brand/") || path.contains(".")) return null;
                    return super.getResource("index.html", location);
                }
            });
    }
}
