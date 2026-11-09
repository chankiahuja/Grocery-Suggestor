package com.pantrypal;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
public class LoginMailConfig {
    @Bean
    ThreadPoolTaskExecutor loginMailExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(128);
        executor.setThreadNamePrefix("pantry-login-mail-");
        executor.setDaemon(true);
        // Never perform SMTP on the request thread when the queue is full.
        return executor;
    }
}
